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

    // Debug endpoint — shows raw Yahoo response
    if (url.pathname === '/api/debug') {
      const ticker = url.searchParams.get('ticker') || 'EOG';
      const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d&includePrePost=true`;
      const response = await fetch(yahooUrl, { headers: yahooHeaders() });
      const data = await response.json();
      const meta = data?.chart?.result?.[0]?.meta || {};
      return json({
        marketState: meta.marketState,
        regularMarketPrice: meta.regularMarketPrice,
        regularMarketTime: meta.regularMarketTime,
        preMarketPrice: meta.preMarketPrice,
        preMarketTime: meta.preMarketTime,
        postMarketPrice: meta.postMarketPrice,
        postMarketTime: meta.postMarketTime,
      });
    }

    if (url.pathname !== '/api/quote') {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const ticker = url.searchParams.get('ticker');
    if (!ticker) return json({ error: 'ticker is required' }, 400);

    try {
      // v8 chart with pre/post data
      const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d&includePrePost=true`;

      const response = await fetch(yahooUrl, { headers: yahooHeaders() });

      if (!response.ok) return json({ error: `Yahoo HTTP ${response.status}` }, response.status);

      const data = await response.json();
      const meta = data?.chart?.result?.[0]?.meta;

      if (!meta || !meta.regularMarketPrice) {
        return json({ error: `Ticker not found: ${ticker}` }, 404);
      }

      let price = meta.regularMarketPrice;
      let priceType = 'regular';

      // Check pre-market: time must be more recent than regular market close
      if (meta.preMarketPrice && meta.preMarketPrice > 0 &&
          meta.preMarketTime && meta.regularMarketTime &&
          meta.preMarketTime > meta.regularMarketTime) {
        price = meta.preMarketPrice;
        priceType = 'pre-market';
      }
      // Check post-market
      else if (meta.postMarketPrice && meta.postMarketPrice > 0 &&
               meta.postMarketTime && meta.regularMarketTime &&
               meta.postMarketTime > meta.regularMarketTime) {
        price = meta.postMarketPrice;
        priceType = 'post-market';
      }
      // Fallback: use marketState
      else if (meta.marketState === 'PRE' && meta.preMarketPrice > 0) {
        price = meta.preMarketPrice;
        priceType = 'pre-market';
      }
      else if ((meta.marketState === 'POST' || meta.marketState === 'POSTPOST') && meta.postMarketPrice > 0) {
        price = meta.postMarketPrice;
        priceType = 'post-market';
      }

      return json({
        ticker: meta.symbol || ticker,
        price,
        priceType,
        marketState: meta.marketState,
        regularMarketPrice: meta.regularMarketPrice,
        preMarketPrice: meta.preMarketPrice || null,
        postMarketPrice: meta.postMarketPrice || null,
        currency: meta.currency || null,
        exchangeName: meta.fullExchangeName || meta.exchangeName || null,
        shortName: meta.shortName || null,
      });

    } catch (err) {
      return json({ error: err.message || 'Failed to fetch quote' }, 500);
    }
  }
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
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    }
  });
}
