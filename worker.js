// Portfolio Terminal 2 — Cloudflare Worker

// Crumb cache (in-memory, per isolate, shared across requests)
let crumbCache = { crumb: null, cookie: null, expires: 0 };
const CRUMB_TTL_MS = 30 * 60 * 1000;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'X-API-Token, X-KV-Key, Content-Type',
        }
      });
    }

    // Token check — must be in X-API-Token header
    const token = request.headers.get('X-API-Token') || '';
    const validToken = env.API_TOKEN || '';
    if (!validToken || token !== validToken) {
      return json({ error: 'Forbidden' }, 403);
    }

    const ticker = url.searchParams.get('ticker') || 'EOG';

    // Debug: processed result (same logic as /api/quote)
    if (url.pathname === '/api/debug') {
      const result = await getQuote(ticker);
      return json(result);
    }

    // Debug1: raw meta from fast 1d request
    if (url.pathname === '/api/debug1') {
      const r = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`,
        { headers: yahooHeaders() }
      );
      const d = await r.json();
      const meta = d?.chart?.result?.[0]?.meta || {};
      return json({ status: r.status, meta });
    }

    // Debug2: last candles + pre/post windows
    if (url.pathname === '/api/debug2') {
      const r = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1m&range=5d&includePrePost=true`,
        { headers: yahooHeaders() }
      );
      const d = await r.json();
      const result = d?.chart?.result?.[0];
      const meta = result?.meta || {};
      const timestamps = result?.timestamp || [];
      const closes = result?.indicators?.quote?.[0]?.close || [];

      const preStart  = meta.currentTradingPeriod?.pre?.start;
      const preEnd    = meta.currentTradingPeriod?.pre?.end;
      const postStart = meta.currentTradingPeriod?.post?.start;
      const postEnd   = meta.currentTradingPeriod?.post?.end;

      const lastCandles = [];
      for (let i = Math.max(0, timestamps.length - 30); i < timestamps.length; i++) {
        if (closes[i] != null) lastCandles.push({ t: timestamps[i], price: closes[i] });
      }

      const preCandles = [], postCandles = [];
      for (let i = 0; i < timestamps.length; i++) {
        const t = timestamps[i];
        if (preStart && preEnd && t >= preStart && t < preEnd && closes[i] != null)
          preCandles.push({ t, price: closes[i] });
        if (postStart && postEnd && t >= postStart && t < postEnd && closes[i] != null)
          postCandles.push({ t, price: closes[i] });
      }

      return json({
        status: r.status,
        totalPoints: timestamps.length,
        currentTradingPeriod: meta.currentTradingPeriod,
        regularMarketPrice: meta.regularMarketPrice,
        lastCandles,
        preCandles: preCandles.slice(-10),
        postCandles: postCandles.slice(-10),
      });
    }

    // KV endpoints.
    //
    // A record is stored under two prefixed keys:
    //   data:<key>    the blob the client sends (encrypted when a key is set)
    //   alerts:<key>  alerts in plaintext, so the scheduled handler can read
    //                 them without pulling — or decrypting — the whole record
    //
    // The split is invisible to the client: GET stitches both back together,
    // PUT takes the record apart. Records written before the split live under
    // the bare key; GET falls back to it and the next PUT migrates them.
    const dataKeyFor   = (k) => 'data:' + k;
    const alertsKeyFor = (k) => 'alerts:' + k;

    if (url.pathname === '/api/kv') {
      const kvKey = request.headers.get('X-KV-Key');
      if (!kvKey) return json({ error: 'X-KV-Key required' }, 400);
      if (!env.PORTFOLIO_KV) return json({ error: 'KV not configured' }, 503);

      if (request.method === 'GET') {
        let { value, metadata } = await env.PORTFOLIO_KV.getWithMetadata(dataKeyFor(kvKey));
        if (value === null) {
          // Pre-split record.
          ({ value, metadata } = await env.PORTFOLIO_KV.getWithMetadata(kvKey));
        }
        if (value === null) return json({ error: 'not_found' }, 404);

        let record;
        try { record = JSON.parse(value); }
        catch { return json({ error: 'corrupt_record' }, 500); }

        const alertsRaw = await env.PORTFOLIO_KV.get(alertsKeyFor(kvKey));
        if (alertsRaw !== null) {
          try { record.alerts = JSON.parse(alertsRaw); } catch {}
        }
        return json({ data: record, updatedAt: metadata?.updatedAt || null });
      }

      if (request.method === 'PUT') {
        const body = await request.text();
        const now = new Date().toISOString();

        let record;
        try { record = JSON.parse(body); }
        catch { return json({ error: 'invalid_json' }, 400); }

        const alerts = record.alerts;
        delete record.alerts;

        // Alerts first: it's the smaller write, so if the pair is interrupted
        // the larger blob is the one left behind, not the alerts.
        // No alerts field means "this build doesn't know about alerts" — leave
        // the key alone. Clearing them is expressed as an empty items object.
        if (alerts !== undefined) {
          await env.PORTFOLIO_KV.put(alertsKeyFor(kvKey), JSON.stringify(alerts));
        }
        await env.PORTFOLIO_KV.put(dataKeyFor(kvKey), JSON.stringify(record), { metadata: { updatedAt: now } });
        // Drop the pre-split copy so there's only one source of truth.
        await env.PORTFOLIO_KV.delete(kvKey);

        return json({ ok: true, updatedAt: now });
      }
    }

    if (url.pathname === '/api/kv/meta') {
      const kvKey = request.headers.get('X-KV-Key');
      if (!kvKey) return json({ error: 'X-KV-Key required' }, 400);
      if (!env.PORTFOLIO_KV) return json({ error: 'KV not configured' }, 503);
      let { metadata } = await env.PORTFOLIO_KV.getWithMetadata(dataKeyFor(kvKey));
      if (!metadata) ({ metadata } = await env.PORTFOLIO_KV.getWithMetadata(kvKey));
      return json({ updatedAt: metadata?.updatedAt || null });
    }

    // Profile endpoint: /api/profile?ticker=NVDA → { sector, industry, country }
    if (url.pathname === '/api/profile') {
      const t = url.searchParams.get('ticker');
      if (!t) return json({ error: 'ticker is required' }, 400);
      try {
        const r = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?interval=1d&range=1d&modules=assetProfile`,
          { headers: yahooHeaders() }
        );
        if (!r.ok) return json({ sector: null, industry: null, country: null });
        const d = await r.json();
        const profile = d?.chart?.result?.[0]?.assetProfile || {};
        return json({
          sector: profile.sector || null,
          industry: profile.industry || null,
          country: profile.country || null
        });
      } catch (err) {
        return json({ sector: null, industry: null, country: null });
      }
    }

    // History endpoint: /api/history?ticker=NVDA&range=1mo
    if (url.pathname === '/api/history') {
      const t = url.searchParams.get('ticker');
      const range = url.searchParams.get('range') || '1mo';
      if (!t) return json({ error: 'ticker is required' }, 400);
      if (!['1d', '5d', '1mo', '3mo', '6mo', '1y', '5y'].includes(range)) return json({ error: 'invalid range' }, 400);
      try {
        const interval = range === '1d' ? '5m' : '1d';
        const extra = range === '1d' ? '&includePrePost=true' : '';
        const r = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?interval=${interval}&range=${range}${extra}`,
          { headers: yahooHeaders() }
        );
        if (!r.ok) return json({ error: `Yahoo HTTP ${r.status}` }, 502);
        const d = await r.json();
        const result = d?.chart?.result?.[0];
        if (!result) return json({ error: `No data for ${t}` }, 404);
        const meta = result.meta || {};
        const timestamps = result.timestamp || [];
        const closes = result.indicators?.quote?.[0]?.close || [];
        const rawCurrency = meta.currency || null;
        const isGBp = rawCurrency === 'GBp';
        const points = [];
        for (let i = 0; i < timestamps.length; i++) {
          if (closes[i] != null) {
            points.push({
              t: timestamps[i],
              c: isGBp ? closes[i] / 100 : closes[i]
            });
          }
        }
        return json({
          ticker: meta.symbol || t,
          currency: isGBp ? 'GBP' : rawCurrency,
          tradingPeriod: meta.currentTradingPeriod || null,
          points
        });
      } catch (err) {
        return json({ error: err.message || 'Failed' }, 500);
      }
    }

    // quoteSummary endpoint: /api/quotesummary?ticker=AAPL&modules=financialData,defaultKeyStatistics
    if (url.pathname === '/api/quotesummary') {
      const t = url.searchParams.get('ticker');
      const modules = url.searchParams.get('modules');
      if (!t || !modules) return json({ error: 'Missing ticker or modules' }, 400);
      try {
        const data = await fetchQuoteSummary(t, modules);
        return json(data);
      } catch (e) {
        return json({ error: String(e?.message || e) }, 500);
      }
    }

    // ISIN lookup: /api/isin?ticker=AAPL
    // STUB — always returns { isin: null }. No free provider supplies ISIN:
    //   - Yahoo doesn't return it in any quoteSummary module
    //   - Business Insider's scrape is unreliable (mismatched/garbage rows)
    //   - Twelve Data gates isin/cusip behind a paid add-on on every tier
    //     (free responses return the literal "request_access_via_add_ons")
    //   - Financial Modeling Prep only returns ISIN on paid plans; the free
    //     tier omits it entirely
    // The frontend keeps the full ISIN pipeline (per-ticker storage, Add/Edit
    // fields, analytics rubric) — users enter ISINs manually. This endpoint
    // stays so the frontend contract is unchanged and a real provider can be
    // wired in later by editing only this handler.
    if (url.pathname === '/api/isin') {
      const t = url.searchParams.get('ticker');
      if (!t) return json({ error: 'ticker is required' }, 400);
      return json({ isin: null });
    }

    // Trading hours: /api/hours?ticker=X — returns just the current trading
    // period (pre/regular/post) and the exchange timezone. Fetched on demand.
    if (url.pathname === '/api/hours') {
      const t = url.searchParams.get('ticker');
      if (!t) return json({ error: 'ticker is required' }, 400);
      try {
        const r = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?interval=1d&range=1d`,
          { headers: yahooHeaders() }
        );
        if (!r.ok) return json({ error: `Yahoo HTTP ${r.status}` }, 502);
        const d = await r.json();
        const meta = d?.chart?.result?.[0]?.meta;
        if (!meta) return json({ error: `No data for ${t}` }, 404);
        return json({
          ticker: meta.symbol || t,
          exchangeName: meta.fullExchangeName || meta.exchangeName || null,
          exchangeTimezoneName: meta.exchangeTimezoneName || null,
          timezone: meta.timezone || null,
          gmtoffset: meta.gmtoffset != null ? meta.gmtoffset : null,
          tradingPeriod: meta.currentTradingPeriod || null
        });
      } catch (err) {
        return json({ error: err.message || 'Failed' }, 500);
      }
    }

    if (url.pathname !== '/api/quote') {
      return json({ error: 'Not found' }, 404);
    }

    const t = url.searchParams.get('ticker');
    if (!t) return json({ error: 'ticker is required' }, 400);

    try {
      const result = await getQuote(t);
      if (result.error) return json(result, 404);
      return json(result);
    } catch (err) {
      return json({ error: err.message || 'Failed to fetch quote' }, 500);
    }
  }
};

async function getQuote(ticker) {
  // Step 1: fast request
  const r1 = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`,
    { headers: yahooHeaders() }
  );
  if (!r1.ok) return { error: `Yahoo HTTP ${r1.status}` };

  const d1 = await r1.json();
  const meta = d1?.chart?.result?.[0]?.meta;
  if (!meta || !meta.regularMarketPrice) return { error: `Ticker not found: ${ticker}` };

  const now = Math.floor(Date.now() / 1000);
  const regular = meta.currentTradingPeriod?.regular;
  // Normalize GBp (pence) to GBP (pounds) — LSE stocks
  const rawCurrency = meta.currency || null;
  if (rawCurrency === 'GBp') {
    meta.currency = 'GBP';
    meta.regularMarketPrice = meta.regularMarketPrice / 100;
    meta.chartPreviousClose = meta.chartPreviousClose ? meta.chartPreviousClose / 100 : null;
  }
  const regularMarketPrice = meta.regularMarketPrice;
  const regularMarketTime = meta.regularMarketTime;

  // Step 2: are we in active regular session with trades?
  if (regular && now >= regular.start && now < regular.end && regularMarketTime >= regular.start) {
    return {
      ticker: meta.symbol || ticker,
      price: regularMarketPrice,
      priceType: 'regular',
      marketState: 'REGULAR',
      priceTimestamp: regularMarketTime,
      regularMarketPrice,
      previousClose: meta.chartPreviousClose || null,
      currency: meta.currency || null,
      exchangeName: meta.fullExchangeName || meta.exchangeName || null,
      shortName: meta.shortName || null,
      instrumentType: meta.instrumentType || null,
    };
  }

  // Determine marketState from currentTradingPeriod
  const tp = meta.currentTradingPeriod;
  let marketState = 'CLOSED';
  if (tp) {
    if (now >= tp.pre.start && now < tp.pre.end)         marketState = 'PRE';
    else if (now >= tp.regular.start && now < tp.regular.end) marketState = 'REGULAR';
    else if (now >= tp.post.start && now < tp.post.end)  marketState = 'POST';
  }

  // Step 3: all other cases — get last candle from extended data
  const r2 = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1m&range=5d&includePrePost=true`,
    { headers: yahooHeaders() }
  );

  if (r2.ok) {
    const d2 = await r2.json();
    const result2 = d2?.chart?.result?.[0];
    const timestamps = result2?.timestamp || [];
    const closes = result2?.indicators?.quote?.[0]?.close || [];

    // Find last non-null candle
    let lastPrice = null;
    let lastTime = null;
    for (let i = timestamps.length - 1; i >= 0; i--) {
      if (closes[i] != null) {
        lastPrice = closes[i];
        lastTime = timestamps[i];
        break;
      }
    }

    if (lastPrice != null) {
      if (rawCurrency === 'GBp') lastPrice = lastPrice / 100;
      const priceType = (Math.abs(lastPrice - regularMarketPrice) < 0.005) ? 'regular' : 'extended';
      return {
        ticker: meta.symbol || ticker,
        price: lastPrice,
        priceType,
        marketState,
        lastCandleTime: lastTime,
        priceTimestamp: lastTime,
        regularMarketPrice,
        previousClose: meta.chartPreviousClose || null,
        currency: meta.currency || null,
        exchangeName: meta.fullExchangeName || meta.exchangeName || null,
        shortName: meta.shortName || null,
        instrumentType: meta.instrumentType || null,
      };
    }
  }

  // Fallback: return regular close
  return {
    ticker: meta.symbol || ticker,
    price: regularMarketPrice,
    priceType: 'regular',
    marketState,
    priceTimestamp: regularMarketTime,
    regularMarketPrice,
    previousClose: meta.chartPreviousClose || null,
    currency: meta.currency || null,
    exchangeName: meta.fullExchangeName || meta.exchangeName || null,
    shortName: meta.shortName || null,
    instrumentType: meta.instrumentType || null,
  };
}

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
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

async function ensureCrumb(force = false) {
  const now = Date.now();
  if (!force && crumbCache.crumb && crumbCache.cookie && now < crumbCache.expires) {
    return crumbCache;
  }

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

  const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: { ...yahooHeaders(), Cookie: cookie },
  });

  if (!crumbRes.ok) {
    const body = await crumbRes.text().catch(() => '');
    throw new Error(`getcrumb failed: HTTP ${crumbRes.status} ${body.slice(0, 200)}`);
  }

  const crumb = (await crumbRes.text()).trim();
  if (!crumb || crumb.length > 64) {
    throw new Error(`Suspicious crumb: "${crumb.slice(0, 80)}"`);
  }

  crumbCache = { crumb, cookie, expires: now + CRUMB_TTL_MS };
  return crumbCache;
}

async function fetchQuoteSummaryRaw(ticker, modules) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { crumb, cookie } = await ensureCrumb(attempt > 0);
    const url =
      `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}` +
      `?modules=${encodeURIComponent(modules)}&crumb=${encodeURIComponent(crumb)}`;

    const res = await fetch(url, { headers: { ...yahooHeaders(), Cookie: cookie } });

    if ((res.status === 401 || res.status === 403) && attempt === 0) continue;

    const body = await res.text();
    let parsed;
    try { parsed = JSON.parse(body); }
    catch { return { _error: 'Yahoo returned non-JSON', _status: res.status, _body: body.slice(0, 500) }; }

    if (!res.ok) return { _error: `Yahoo HTTP ${res.status}`, _status: res.status, _yahoo: parsed };

    return parsed;
  }
  return { _error: 'Auth failed after retry' };
}

// On 404, Yahoo rejects the whole request if ANY module is unsupported for the ticker.
// Fall back to per-module parallel fetches and merge what works.
async function fetchQuoteSummary(ticker, modules) {
  const combined = await fetchQuoteSummaryRaw(ticker, modules);

  if (!combined._error || combined._status !== 404) return combined;

  const moduleList = modules.split(',').map(m => m.trim()).filter(Boolean);
  if (moduleList.length <= 1) return combined;

  const settled = await Promise.allSettled(
    moduleList.map(m => fetchQuoteSummaryRaw(ticker, m))
  );

  const merged = {};
  let anySuccess = false;
  for (let i = 0; i < settled.length; i++) {
    const m = moduleList[i];
    const s = settled[i];
    if (s.status !== 'fulfilled' || s.value._error) continue;
    const moduleData = s.value?.quoteSummary?.result?.[0]?.[m];
    if (moduleData !== undefined) { merged[m] = moduleData; anySuccess = true; }
  }

  return anySuccess
    ? { quoteSummary: { result: [merged], error: null } }
    : combined;
}
