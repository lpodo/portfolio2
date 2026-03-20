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

    if (url.pathname === '/api/debug') {
      const ticker = url.searchParams.get('ticker') || 'EOG';
      const r = await fetchQuote(ticker);
      return json(r);
    }

    if (url.pathname !== '/api/quote') {
      return json({ error: 'Not found' }, 404);
    }

    const ticker = url.searchParams.get('ticker');
    if (!ticker) return json({ error: 'ticker is required' }, 400);

    try {
      const result = await fetchQuote(ticker);
      if (result.error) return json(result, 404);
      return json(result);
    } catch (err) {
      return json({ error: err.message || 'Failed to fetch quote' }, 500);
    }
  }
};

async function fetchQuote(ticker) {
  // Step 1: fast request - 1d interval, no pre/post
  const baseUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`;
  const r1 = await fetch(baseUrl + '?interval=1d&range=1d', { headers: yahooHeaders() });
  if (!r1.ok) return { error: `Yahoo HTTP ${r1.status}` };

  const d1 = await r1.json();
  const meta = d1?.chart?.result?.[0]?.meta;
  if (!meta || !meta.regularMarketPrice) return { error: `Ticker not found: ${ticker}` };

  // Determine market state
  const now = Math.floor(Date.now() / 1000);
  const preStart  = meta.currentTradingPeriod?.pre?.start;
  const preEnd    = meta.currentTradingPeriod?.pre?.end;
  const regStart  = meta.currentTradingPeriod?.regular?.start;
  const regEnd    = meta.currentTradingPeriod?.regular?.end;
  const postStart = meta.currentTradingPeriod?.post?.start;
  const postEnd   = meta.currentTradingPeriod?.post?.end;

  let marketState = meta.marketState || null;
  if (!marketState) {
    if (preStart && preEnd && now >= preStart && now < preEnd)       marketState = 'PRE';
    else if (regStart && regEnd && now >= regStart && now < regEnd)  marketState = 'REGULAR';
    else if (postStart && postEnd && now >= postStart && now < postEnd) marketState = 'POST';
    else marketState = 'CLOSED';
  }

  // Step 2: if extended hours — fetch 1m candles to get pre/post price
  let price = meta.regularMarketPrice;
  let priceType = 'regular';

  if (marketState === 'PRE' || marketState === 'POST' || marketState === 'POSTPOST') {
    const r2 = await fetch(baseUrl + '?interval=1m&range=1d&includePrePost=true', { headers: yahooHeaders() });
    if (r2.ok) {
      const d2 = await r2.json();
      const result2 = d2?.chart?.result?.[0];
      const timestamps = result2?.timestamp || [];
      const closes = result2?.indicators?.quote?.[0]?.close || [];

      if (marketState === 'PRE') {
        for (let i = timestamps.length - 1; i >= 0; i--) {
          const t = timestamps[i];
          if (preStart && preEnd && t >= preStart && t < preEnd && closes[i]) {
            price = closes[i];
            priceType = 'pre-market';
            break;
          }
        }
      } else {
        for (let i = timestamps.length - 1; i >= 0; i--) {
          const t = timestamps[i];
          if (postStart && postEnd && t >= postStart && t < postEnd && closes[i]) {
            price = closes[i];
            priceType = 'post-market';
            break;
          }
        }
      }
    }
  }

  return {
    ticker: meta.symbol || ticker,
    price,
    priceType,
    marketState,
    regularMarketPrice: meta.regularMarketPrice,
    preMarketPrice: priceType === 'pre-market' ? price : null,
    postMarketPrice: priceType === 'post-market' ? price : null,
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
