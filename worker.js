export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
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
  const regularMarketPrice = meta.regularMarketPrice;
  const regularMarketTime = meta.regularMarketTime;

  // Step 2: are we in active regular session with trades?
  if (regular && now >= regular.start && now < regular.end && regularMarketTime >= regular.start) {
    return {
      ticker: meta.symbol || ticker,
      price: regularMarketPrice,
      priceType: 'regular',
      marketState: 'REGULAR',
      regularMarketPrice,
      currency: meta.currency || null,
      exchangeName: meta.fullExchangeName || meta.exchangeName || null,
      shortName: meta.shortName || null,
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
      const priceType = (Math.abs(lastPrice - regularMarketPrice) < 0.001) ? 'regular' : 'extended';
      return {
        ticker: meta.symbol || ticker,
        price: lastPrice,
        priceType,
        marketState,
        lastCandleTime: lastTime,
        regularMarketPrice,
        currency: meta.currency || null,
        exchangeName: meta.fullExchangeName || meta.exchangeName || null,
        shortName: meta.shortName || null,
      };
    }
  }

  // Fallback: return regular close
  return {
    ticker: meta.symbol || ticker,
    price: regularMarketPrice,
    priceType: 'regular',
    marketState,
    regularMarketPrice,
    currency: meta.currency || null,
    exchangeName: meta.fullExchangeName || meta.exchangeName || null,
    shortName: meta.shortName || null,
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
