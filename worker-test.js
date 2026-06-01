// Portfolio Terminal 2 — TEST Worker (experimental branch)
// Extended Yahoo Finance access via quoteSummary + crumb auth.
// ** Production worker is untouched. **

// ---- Module-scoped crumb cache (in-memory, per isolate) ----
let crumbCache = { crumb: null, cookie: null, expires: 0 };
const CRUMB_TTL_MS = 30 * 60 * 1000; // 30 minutes

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'X-API-Token, Content-Type',
};

function yahooHeaders() {
  return {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://finance.yahoo.com/',
    'Origin': 'https://finance.yahoo.com',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

// ---- Crumb / cookie flow ----
async function ensureCrumb(force = false) {
  const now = Date.now();
  if (!force && crumbCache.crumb && crumbCache.cookie && now < crumbCache.expires) {
    return crumbCache;
  }

  // 1) Get cookies from fc.yahoo.com (returns 404 but sets cookies)
  const cookieRes = await fetch('https://fc.yahoo.com', {
    headers: yahooHeaders(),
    redirect: 'manual',
  });

  const setCookies =
    typeof cookieRes.headers.getSetCookie === 'function'
      ? cookieRes.headers.getSetCookie()
      : (cookieRes.headers.get('set-cookie')
          ? [cookieRes.headers.get('set-cookie')]
          : []);

  if (!setCookies.length) {
    throw new Error(`No Set-Cookie from fc.yahoo.com (status ${cookieRes.status})`);
  }

  const cookie = setCookies
    .map(c => c.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');

  // 2) Get crumb token using the cookies
  const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: { ...yahooHeaders(), Cookie: cookie },
  });

  if (!crumbRes.ok) {
    const body = await crumbRes.text().catch(() => '');
    throw new Error(`getcrumb failed: HTTP ${crumbRes.status} ${body.slice(0, 200)}`);
  }

  const crumb = (await crumbRes.text()).trim();
  if (!crumb || crumb.length > 64) {
    throw new Error(`Suspicious crumb returned: "${crumb.slice(0, 80)}"`);
  }

  crumbCache = { crumb, cookie, expires: now + CRUMB_TTL_MS };
  return crumbCache;
}

// ---- quoteSummary fetch with one auto-retry on auth errors ----
async function fetchQuoteSummary(ticker, modules) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { crumb, cookie } = await ensureCrumb(attempt > 0);
    const url =
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}` +
      `?modules=${encodeURIComponent(modules)}&crumb=${encodeURIComponent(crumb)}`;

    const res = await fetch(url, { headers: { ...yahooHeaders(), Cookie: cookie } });

    // Retry once with fresh crumb if auth failed
    if ((res.status === 401 || res.status === 403) && attempt === 0) continue;

    const body = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      return { _error: 'Yahoo returned non-JSON', _status: res.status, _body: body.slice(0, 500) };
    }

    if (!res.ok) {
      return { _error: `Yahoo HTTP ${res.status}`, _status: res.status, _yahoo: parsed };
    }

    return parsed;
  }
  return { _error: 'Auth failed after retry' };
}

// ---- Router ----
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // Token check (same convention as prod worker)
    const token = request.headers.get('X-API-Token') || '';
    const validToken = env.API_TOKEN || '';
    if (!validToken || token !== validToken) {
      return json({ error: 'Forbidden' }, 403);
    }

    // GET /api/quotesummary?ticker=AAPL&modules=assetProfile,summaryDetail
    if (url.pathname === '/api/quotesummary') {
      const ticker = url.searchParams.get('ticker');
      const modules = url.searchParams.get('modules');
      if (!ticker || !modules) {
        return json({ error: 'Missing ticker or modules parameter' }, 400);
      }
      try {
        const data = await fetchQuoteSummary(ticker, modules);
        return json(data);
      } catch (e) {
        return json({ error: String(e?.message || e) }, 500);
      }
    }

    // GET /api/debug/crumb[?force=1] — inspect current crumb cache
    if (url.pathname === '/api/debug/crumb') {
      try {
        const force = url.searchParams.get('force') === '1';
        const { crumb, cookie, expires } = await ensureCrumb(force);
        return json({
          crumb,
          cookieLength: cookie.length,
          expiresInSec: Math.round((expires - Date.now()) / 1000),
        });
      } catch (e) {
        return json({ error: String(e?.message || e) }, 500);
      }
    }

    // GET /api/raw?url=<yahoo url> — passthrough for ad-hoc experiments
    if (url.pathname === '/api/raw') {
      const target = url.searchParams.get('url');
      if (!target || !/^https:\/\/(query[12]|finance)\.yahoo\.com/.test(target)) {
        return json({ error: 'url param must start with https://query[12].yahoo.com or https://finance.yahoo.com' }, 400);
      }
      try {
        const { crumb, cookie } = await ensureCrumb();
        const finalUrl = target.includes('crumb=')
          ? target
          : `${target}${target.includes('?') ? '&' : '?'}crumb=${encodeURIComponent(crumb)}`;
        const res = await fetch(finalUrl, { headers: { ...yahooHeaders(), Cookie: cookie } });
        const body = await res.text();
        try {
          return json(JSON.parse(body));
        } catch {
          return new Response(body, {
            status: res.status,
            headers: { 'Content-Type': res.headers.get('content-type') || 'text/plain', ...CORS_HEADERS },
          });
        }
      } catch (e) {
        return json({ error: String(e?.message || e) }, 500);
      }
    }

    // Index page
    if (url.pathname === '/' || url.pathname === '') {
      return json({
        worker: 'portfolio-worker-test',
        routes: [
          'GET /api/quotesummary?ticker=AAPL&modules=assetProfile,summaryDetail',
          'GET /api/debug/crumb[?force=1]',
          'GET /api/raw?url=<yahoo url>',
        ],
        crumbCache: {
          hasCrumb: !!crumbCache.crumb,
          expiresInSec: crumbCache.expires ? Math.round((crumbCache.expires - Date.now()) / 1000) : 0,
        },
      });
    }

    return json({ error: 'Not found', path: url.pathname }, 404);
  },
};
