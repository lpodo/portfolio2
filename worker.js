// Portfolio Terminal 2 — Cloudflare Worker

// Crumb cache (in-memory, per isolate, shared across requests)
let crumbCache = { crumb: null, cookie: null, expires: 0 };
const CRUMB_TTL_MS = 30 * 60 * 1000;
// Upstream calls had no timeout at all. That was harmless when each request
// served one ticker, but the scheduler now walks tickers in sequence, so one
// slow response would hold up everything behind it.
const QUOTE_TIMEOUT_MS = 5000;

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
          try {
            const parsed = JSON.parse(alertsRaw);
            // Subscriptions stay server-side: the client neither reads nor
            // sends them, so there's no reason for endpoints to travel out.
            if (parsed && typeof parsed === 'object') delete parsed.subscriptions;
            record.alerts = parsed;
          } catch {}
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
          // Subscriptions are the worker's own: the client never sends them, so
          // writing its payload verbatim would wipe whatever /api/push/subscribe
          // stored — leaving checks with nobody to notify. Carry them over.
          let existingSubs;
          try {
            const prev = JSON.parse(await env.PORTFOLIO_KV.get(alertsKeyFor(kvKey)));
            if (prev && Array.isArray(prev.subscriptions)) existingSubs = prev.subscriptions;
          } catch {}
          const merged = (alerts && typeof alerts === 'object') ? { ...alerts } : {};
          if (existingSubs && !Array.isArray(merged.subscriptions)) merged.subscriptions = existingSubs;
          await env.PORTFOLIO_KV.put(alertsKeyFor(kvKey), JSON.stringify(merged));
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
    // Just the alerts record — the settings are shared across devices, so the
    // settings panel refreshes them on open without pulling the whole blob.
    if (url.pathname === '/api/alerts') {
      const kvKey = request.headers.get('X-KV-Key');
      if (!kvKey) return json({ error: 'X-KV-Key required' }, 400);
      if (!env.PORTFOLIO_KV) return json({ error: 'KV not configured' }, 503);
      const raw = await env.PORTFOLIO_KV.get(alertsKeyFor(kvKey));
      if (raw === null) return json({ alerts: null });
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch {}
      // Subscriptions stay server-side.
      if (parsed && typeof parsed === 'object') delete parsed.subscriptions;
      return json({ alerts: parsed });
    }

    // Web Push: the client asks for the public key rather than embedding a
    // copy, so the pair only ever lives in the worker's config.
    if (url.pathname === '/api/push/key') {
      return json({ key: env.VAPID_PUBLIC_KEY || null });
    }

    // Store (or clear) this device's push subscription. Subscriptions live
    // beside the alerts, in the same plaintext record the scheduler reads.
    if (url.pathname === '/api/push/subscribe') {
      const kvKey = request.headers.get('X-KV-Key');
      if (!kvKey) return json({ error: 'X-KV-Key required' }, 400);
      if (!env.PORTFOLIO_KV) return json({ error: 'KV not configured' }, 503);

      let body;
      try { body = await request.json(); }
      catch { return json({ error: 'invalid_json' }, 400); }

      const alertsKey = 'alerts:' + kvKey;
      let payload = {};
      try { payload = JSON.parse(await env.PORTFOLIO_KV.get(alertsKey)) || {}; } catch {}

      const subs = Array.isArray(payload.subscriptions) ? payload.subscriptions : [];
      // Keyed by endpoint: re-subscribing on the same device replaces its entry
      // instead of piling up duplicates.
      const kept = subs.filter(s => s && s.endpoint !== body.endpoint);
      if (body.subscription) kept.push(body.subscription);

      payload.subscriptions = kept;
      await env.PORTFOLIO_KV.put(alertsKey, JSON.stringify(payload));
      return json({ ok: true, count: kept.length });
    }

    // Temporary: send a notification to every stored subscription on demand,
    // so delivery can be checked before the scheduler drives it.
    if (url.pathname === '/api/push/test') {
      const kvKey = request.headers.get('X-KV-Key');
      if (!kvKey) return json({ error: 'X-KV-Key required' }, 400);
      if (!env.PORTFOLIO_KV) return json({ error: 'KV not configured' }, 503);
      if (!env.VAPID_PRIVATE_KEY) return json({ error: 'VAPID_PRIVATE_KEY not set' }, 503);

      let payload = {};
      try { payload = JSON.parse(await env.PORTFOLIO_KV.get('alerts:' + kvKey)) || {}; } catch {}
      const subs = Array.isArray(payload.subscriptions) ? payload.subscriptions : [];
      if (!subs.length) return json({ error: 'no subscriptions' }, 404);

      const results = [];
      for (const sub of subs) {
        try {
          const r = await sendPush(env, sub, {
            title: 'Portfolio Terminal',
            body: 'Test notification — push is working.',
            tag: 'pt-test'
          });
          let detail = '';
          if (!r.ok) { try { detail = (await r.text()).slice(0, 200); } catch {} }
          results.push({ status: r.status, ok: r.ok, detail });
        } catch (err) {
          results.push({ status: 0, ok: false, detail: 'threw: ' + (err && err.message ? err.message : String(err)) });
        }
      }
      return json({ sent: results.length, results });
    }

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
      // _cost is bookkeeping for the scheduler's request budget, not client data.
      delete result._cost;
      return json(result);
    } catch (err) {
      return json({ error: err.message || 'Failed to fetch quote' }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runAlertChecks(env));
  }
};

// ── Scheduled alert checks ──────────────────────────────────────────────────
// Cron fires on a fixed short interval; the per-user settings decide whether
// this tick actually does anything. Nothing is notified yet — this step only
// records what would fire, so the logic can be verified from KV.

const ALERT_PREFIX = 'alerts:';
const CHECK_PREFIX = 'check:';

async function runAlertChecks(env) {
  if (!env.PORTFOLIO_KV) return;
  const now = new Date();
  const list = await env.PORTFOLIO_KV.list({ prefix: ALERT_PREFIX });

  for (const entry of list.keys) {
    const userKey = entry.name.slice(ALERT_PREFIX.length);
    try { await checkOneUser(env, userKey, now); }
    catch (err) { /* one user's failure must not stop the rest */ }
  }
}

async function checkOneUser(env, userKey, now) {
  const raw = await env.PORTFOLIO_KV.get(ALERT_PREFIX + userKey);
  if (!raw) return;

  let payload;
  try { payload = JSON.parse(raw); } catch { return; }

  const settings = payload.settings || {};
  if (!settings.enabled) return;

  const items = payload.items || {};
  const tickers = Object.keys(items).filter(t => (items[t] || []).length);
  if (!tickers.length) return;

  const tz = settings.tz || 'UTC';
  const local = zonedParts(now, tz);
  const fromHour = numOr(settings.fromHour, 0);
  const toHour = numOr(settings.toHour, 24);
  if (!isInWindow(local.minuteOfDay, fromHour, toHour)) return;

  const stateKey = CHECK_PREFIX + userKey;
  let state = {};
  try { state = JSON.parse(await env.PORTFOLIO_KV.get(stateKey)) || {}; } catch {}

  const every = numOr(settings.everyMinutes, 10);
  const slot = currentSlot(local, fromHour, every);

  // Cloudflare allows 50 subrequests per invocation. Quotes cost one request in
  // an active session and two outside it, so counting tickers rather than
  // requests would waste half the budget during market hours. Walk the ring
  // spending up to QUOTE_BUDGET, keeping the rest for sends and KV writes.
  const QUOTE_BUDGET = 35;
  // State is written at the very end, so an over-long round would lose the
  // cursor and the record of what was already notified — and re-notify next
  // time. Stop on the clock too, the same orderly way as running out of budget.
  const WALK_DEADLINE_MS = 60000;
  const walkStarted = Date.now();

  const total = tickers.length;
  const freshSlot = state.lastSlot !== slot;
  // A new slot means everything is due again; within a slot we carry on with
  // whatever the previous tick didn't reach.
  const remaining = freshSlot ? total : numOr(state.remaining, 0);
  if (remaining <= 0) return;      // slot already fully covered

  let cursor = numOr(state.cursor, 0) % (total || 1);
  const prices = {};
  const quotes = {};
  const visited = [];
  let spent = 0;
  let attempted = 0;

  // Sequential: the cost of each quote is only known after it returns, so the
  // budget can be tracked but not planned.
  while (attempted < remaining
         && spent + 2 <= QUOTE_BUDGET
         && Date.now() - walkStarted < WALK_DEADLINE_MS) {
    const t = tickers[cursor % total];
    try {
      const q = await getQuote(t);
      spent += numOr(q && q._cost, 2);
      // A quote that didn't arrive counts as not visited: leaving it out of
      // `visited` keeps its alerts on their previous state instead of reading
      // as "stopped holding", which would fire again once the price returns.
      if (q && !q.error && typeof q.price === 'number') { prices[t] = q.price; quotes[t] = q; visited.push(t); }
    } catch {
      spent += 2;
    }
    attempted++;
    cursor = (cursor + 1) % total;
  }

  const leftover = remaining - attempted;

  // Movers rank the whole watched list, but the walk covers it a slice at a
  // time — so quotes accumulate across the slot's ticks and are only ranked
  // once nothing is left. Earlier quotes are a few minutes older by then,
  // which doesn't matter for a move measured against yesterday's close.
  const gathered = (freshSlot ? {} : (state.gathered || {}));
  for (const t of visited) {
    const q = quotes[t];
    if (q && typeof q.price === 'number' && typeof q.previousClose === 'number' && q.previousClose !== 0) {
      gathered[t] = { price: q.price, prev: q.previousClose, state: q.marketState || null };
    }
  }

  const holding = [];
  for (const t of visited) {
    const price = prices[t];
    if (typeof price !== 'number') continue;
    for (const a of items[t]) {
      if (!a || !a.id) continue;
      const hit = a.condition === '>' ? price > a.value : price < a.value;
      if (hit) holding.push({ id: a.id, ticker: t, condition: a.condition, value: a.value, price });
    }
  }

  // Which of these weren't already holding last time — the ones to notify.
  // Alerts outside this run's slice keep their previous state: dropping them
  // would look like they stopped holding, and they'd re-notify next time they
  // came round.
  const previously = state.holding || {};
  const pricedIds = {};
  const liveIds = {};
  for (const t of tickers) for (const a of items[t] || []) if (a && a.id) liveIds[a.id] = true;
  for (const t of visited) for (const a of items[t] || []) if (a && a.id) pricedIds[a.id] = true;

  const nowHolding = {};
  for (const id of Object.keys(previously)) {
    // Deleted alerts are dropped here: without the liveIds check their state
    // would be carried forward on every run, since they can never be priced.
    if (!pricedIds[id] && liveIds[id]) nowHolding[id] = true; // untouched this run
  }
  const newlyFired = [];
  for (const h of holding) {
    nowHolding[h.id] = true;
    if (!previously[h.id]) newlyFired.push(h);
  }

  // The reverse transition: held before, priced this run, no longer holds.
  // A deleted alert doesn't qualify — it didn't come back, it's just gone.
  const holdingNow = {};
  for (const h of holding) holdingNow[h.id] = true;
  const released = [];
  for (const t of visited) {
    const price = prices[t];
    if (typeof price !== 'number') continue;
    for (const a of items[t] || []) {
      if (!a || !a.id) continue;
      if (previously[a.id] && !holdingNow[a.id]) {
        released.push({ id: a.id, ticker: t, condition: a.condition, value: a.value, price });
      }
    }
  }

  // Notify only what just crossed — an alert that keeps holding stays quiet
  // until the price moves back and crosses again.
  let sent = 0, failed = 0;
  let sendNote = '';
  if (newlyFired.length || released.length) {
    const subs = Array.isArray(payload.subscriptions) ? payload.subscriptions : [];
    if (!subs.length) sendNote = 'no subscriptions stored';
    else if (!env.VAPID_PRIVATE_KEY) sendNote = 'VAPID_PRIVATE_KEY not set';
    else {
      const dead = [];
      const errors = [];

      // Group by ticker and direction: two thresholds crossing in the same run
      // should read as one event, not two near-identical notifications.
      function groupBy(list) {
        const out = {};
        for (const a of list) {
          const key = a.ticker + a.condition;
          if (!out[key]) out[key] = { ticker: a.ticker, condition: a.condition, price: a.price, values: [] };
          out[key].values.push(a.value);
        }
        return Object.values(out);
      }

      const messages = groupBy(newlyFired).map(g => buildAlertMessage(g, items, quotes, false))
        .concat(groupBy(released).map(g => buildAlertMessage(g, items, quotes, true)));

      for (const message of messages) {
        for (const sub of subs) {
          try {
            const res = await sendPush(env, sub, message);
            if (res.ok) sent++;
            else {
              failed++;
              let detail = '';
              try { detail = (await res.text()).slice(0, 200); } catch {}
              errors.push(`${res.status} ${detail}`);
              // Gone for good — the device uninstalled or reset its subscription.
              if (res.status === 404 || res.status === 410) dead.push(sub.endpoint);
            }
          } catch (err) {
            failed++;
            errors.push('threw: ' + (err && err.message ? err.message : String(err)));
          }
        }
      }
      if (errors.length) sendNote = errors.slice(0, 3).join(' | ');      if (dead.length) {
        // Re-read: this payload was loaded before the fetches and sends, so
        // writing it back wholesale could clobber an alert the app saved in
        // the meantime. Only the subscription list is ours to change here.
        let fresh = payload;
        try { fresh = JSON.parse(await env.PORTFOLIO_KV.get(ALERT_PREFIX + userKey)) || payload; } catch {}
        const current = Array.isArray(fresh.subscriptions) ? fresh.subscriptions : [];
        fresh.subscriptions = current.filter(s => dead.indexOf(s.endpoint) === -1);
        await env.PORTFOLIO_KV.put(ALERT_PREFIX + userKey, JSON.stringify(fresh));
      }
    }
  }

  // Top movers: sent once the slot's walk is complete, after the alerts, on the
  // same grid but at its own coarser step. Ranked by the size of the move
  // regardless of direction — a sharp fall matters as much as a sharp rise.
  let moversSent = 0;
  let moversNote = '';
  const moversEvery = numOr(settings.moversMinutes, 0);
  if (moversEvery > 0 && leftover === 0) {
    const moversSlot = currentSlot(local, fromHour, moversEvery);
    if (state.lastMoversSlot !== moversSlot) {
      const ranked = Object.keys(gathered).map(t => {
        const g = gathered[t];
        return { ticker: t, price: g.price, diff: g.price - g.prev, pct: ((g.price - g.prev) / g.prev) * 100 };
      }).sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct)).slice(0, 10);

      const subs2 = Array.isArray(payload.subscriptions) ? payload.subscriptions : [];
      if (ranked.length && subs2.length && env.VAPID_PRIVATE_KEY) {
        // Same shape as an alert line, so both kinds read alike.
        const lines = ranked.map(r => {
          const sign = r.diff >= 0 ? '+' : '\u2212';
          return `${r.ticker} ${r.price.toFixed(2)} ${sign}${Math.abs(r.diff).toFixed(2)} (${sign}${Math.abs(r.pct).toFixed(2)}%)`;
        }).join('\n');

        // Nothing new to say: a digest identical to the last one sent means the
        // prices haven't moved — a weekend, a holiday, or simply overnight.
        // Comparing the text covers all of those without consulting a calendar,
        // and costs nothing: it's the same string the notification carries.
        if (lines === state.lastMoversBody) {
          moversNote = 'unchanged since last digest';
        } else {
          const message = {
            title: `Top movers \u00B7 ${ranked.length}`,
            body: lines,
            tag: 'pt-movers',
            ticker: null,
            view: 'summary-alerts'
          };
          for (const sub of subs2) {
            try {
              const res = await sendPush(env, sub, message);
              if (res.ok) moversSent++;
            } catch {}
          }
          if (moversSent) state.lastMoversBody = lines;
        }
      }
      state.lastMoversSlot = moversSlot;
    }
  }

  await env.PORTFOLIO_KV.put(stateKey, JSON.stringify({
    lastSlot: slot,
    lastMoversSlot: state.lastMoversSlot,
    lastMoversBody: state.lastMoversBody,
    moversSent,
    moversNote,
    gathered: leftover === 0 ? {} : gathered,
    lastRun: now.toISOString(),
    localTime: `${pad2(local.hour)}:${pad2(local.minute)} ${tz}`,
    checked: total,
    visited: visited.length,
    leftover,
    spent,
    cursor,
    remaining: leftover,
    priced: Object.keys(prices).length,
    sent,
    failed,
    sendNote,
    subs: Array.isArray(payload.subscriptions) ? payload.subscriptions.length : 0,
    holding: nowHolding,
    newlyFired,
    released,
    lastResult: holding
  }));
}

// Slots are counted from the window's start rather than from the previous run,
// so checks land on a stable grid (07:00, 07:10, …) and a late tick can't shift
// everything after it. Seconds are folded in and rounded to the nearest minute,
// so a tick arriving a few seconds early or late still lands in its own slot.
function currentSlot(local, fromHour, everyMinutes) {
  const minutesFromStart = (local.minuteOfDay - fromHour * 60 + 1440) % 1440;
  return Math.floor(minutesFromStart / everyMinutes);
}

// Window bounds are compared in minutes, not whole hours, and the upper bound
// is inclusive: a window ending at 01:00 covers 01:00 exactly, where comparing
// hours would have stretched it to 01:59. Equal bounds mean around the clock;
// a to-hour below the from-hour crosses midnight.
function isInWindow(minuteOfDay, fromHour, toHour) {
  if (fromHour === toHour) return true;
  const from = fromHour * 60, to = toHour * 60;
  // Midnight carries minuteOfDay 0, so a window ending at 24:00 would miss the
  // very moment it names. Read that 0 as the end of the day instead, keeping
  // the end inclusive whether it's written 24:00 or 01:00.
  const m = (toHour === 24 && minuteOfDay === 0) ? 1440 : minuteOfDay;
  return from < to
    ? (m >= from && m <= to)
    : (m >= from || m <= to);
}

// Wall-clock time in an IANA zone, with seconds rounded into the minute count.
// Using the zone name rather than a stored offset keeps the window correct
// across DST changes.
function zonedParts(date, tz) {
  let hour, minute, second;
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const parts = {};
    for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
    hour = parseInt(parts.hour, 10) % 24;
    minute = parseInt(parts.minute, 10);
    second = parseInt(parts.second, 10);
  } catch {
    hour = date.getUTCHours();
    minute = date.getUTCMinutes();
    second = date.getUTCSeconds();
  }
  return { hour, minute, minuteOfDay: (hour * 60 + minute + Math.round(second / 60)) % 1440 };
}

function numOr(v, fallback) { return typeof v === 'number' && isFinite(v) ? v : fallback; }
function pad2(n) { return (n < 10 ? '0' : '') + n; }

async function getQuote(ticker) {
  // Step 1: fast request
  const r1 = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`,
    { headers: yahooHeaders(), signal: AbortSignal.timeout(QUOTE_TIMEOUT_MS) }
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
      _cost: 1,
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
    { headers: yahooHeaders(), signal: AbortSignal.timeout(QUOTE_TIMEOUT_MS) }
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
        _cost: 2,
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
    _cost: 2,
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

// ── Web Push (RFC 8291 payload encryption + RFC 8292 VAPID) ─────────────────
// No libraries: the whole exchange is ECDH + HKDF + AES-128-GCM, all of which
// WebCrypto provides. Each send needs a fresh ephemeral key pair.

function b64uToBytes(s) {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(pad + '==='.slice((pad.length + 3) % 4));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
function bytesToB64u(bytes) {
  let s = '';
  const CH = 8192;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function concatBytes(...parts) {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8
  );
  return new Uint8Array(bits);
}

// VAPID: a short-lived JWT proving the sender holds the private key that
// matches the public key the browser stored at subscribe time.
async function vapidHeader(env, audience) {
  const header = bytesToB64u(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = bytesToB64u(new TextEncoder().encode(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: env.VAPID_SUBJECT || 'mailto:admin@example.com'
  })));
  const signingInput = new TextEncoder().encode(header + '.' + claims);

  const pub = b64uToBytes(env.VAPID_PUBLIC_KEY);
  const jwk = {
    kty: 'EC', crv: 'P-256', ext: true,
    d: env.VAPID_PRIVATE_KEY,
    x: bytesToB64u(pub.subarray(1, 33)),
    y: bytesToB64u(pub.subarray(33, 65))
  };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, signingInput));
  return 'vapid t=' + header + '.' + claims + '.' + bytesToB64u(sig) + ', k=' + env.VAPID_PUBLIC_KEY;
}

// aes128gcm: derive a shared secret with the subscription's public key, expand
// it into a content key and nonce, then encrypt the payload into the body
// format the push service forwards verbatim.
async function encryptPayload(subscription, plaintext) {
  const clientPub = b64uToBytes(subscription.keys.p256dh);
  const authSecret = b64uToBytes(subscription.keys.auth);

  const localPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const localPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', localPair.publicKey));

  const clientKey = await crypto.subtle.importKey('raw', clientPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: clientKey }, localPair.privateKey, 256));

  // The auth secret binds the derivation to this subscription.
  const prkInfo = concatBytes(
    new TextEncoder().encode('WebPush: info\0'), clientPub, localPubRaw
  );
  const ikm = await hkdf(authSecret, shared, prkInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, new TextEncoder().encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, new TextEncoder().encode('Content-Encoding: nonce\0'), 12);

  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // A single record, so the padding delimiter is 0x02 (last record).
  const padded = concatBytes(new TextEncoder().encode(plaintext), new Uint8Array([2]));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, padded));

  // Header: salt(16) | record size(4) | key id length(1) | key id
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concatBytes(salt, rs, new Uint8Array([localPubRaw.length]), localPubRaw, ciphertext);
}

// Builds both kinds of alert notification. A crossing reads "above 200", a
// release "back below 200" — the arrow follows the price so a release can't be
// mistaken for a fresh crossing the other way.
function buildAlertMessage(g, items, quotes, isRelease) {
  const q = quotes[g.ticker] || {};
  const up = g.condition === '>';
  const word = isRelease ? (up ? 'back below' : 'back above') : (up ? 'above' : 'below');
  const mark = (isRelease ? !up : up) ? '\u25B2' : '\u25BC';
  const values = g.values.slice().sort((x, y) => x - y).join(', ');

  // Change since the previous close, when there is one to compare with.
  let delta = '';
  if (typeof q.previousClose === 'number' && q.previousClose !== 0) {
    const diff = g.price - q.previousClose;
    const pct = (diff / q.previousClose) * 100;
    const sign = diff >= 0 ? '+' : '\u2212';
    delta = ` ${sign}${Math.abs(diff).toFixed(2)} (${sign}${Math.abs(pct).toFixed(2)}%)`;
  }

  // The full ladder for this direction only: an opposite-direction threshold
  // ticked here would mean the reverse and read as a contradiction.
  const ladder = (items[g.ticker] || [])
    .filter(a => a && a.condition === g.condition)
    .sort((x, y) => x.value - y.value)
    .map(a => {
      const holds = up ? g.price > a.value : g.price < a.value;
      return `${a.value} ${holds ? '\u2713' : '\u2717'}`;
    })
    .join('  ');

  return {
    title: `${g.ticker} ${word} ${values} ${mark}${g.price.toFixed(2)}${delta}`,
    body: ladder + '\n' + marketStateLabel(q),
    tag: 'pt-alert-' + g.ticker + g.condition,
    ticker: g.ticker,
    // Where a tap should land: alerts and movers are both about prices across
    // portfolios, so the cross-portfolio ALERTS view is the useful place.
    view: 'summary-alerts'
  };
}

// Yahoo's marketState in words. Worth showing, since a price that crossed a
// threshold outside the regular session carries a different weight.
function marketStateLabel(quote) {
  const s = String((quote && quote.marketState) || '').toUpperCase();
  if (s === 'REGULAR') return 'market open';
  if (s === 'PRE') return 'pre-market';
  if (s === 'POST' || s === 'POSTPOST') return 'post-market';
  if (s === 'CLOSED') return 'market closed';
  return s ? s.toLowerCase() : 'market state unknown';
}

async function sendPush(env, subscription, message) {
  const endpoint = new URL(subscription.endpoint);
  const audience = endpoint.origin;
  const body = await encryptPayload(subscription, JSON.stringify(message));
  const auth = await vapidHeader(env, audience);

  return fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': auth,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'TTL': '86400'
    },
    body
  });
}
