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

    // Debug — returns full raw Yahoo response
    if (url.pathname === '/api/debug') {
      const ticker = url.searchParams.get('ticker') || 'EOG';
      const yahooUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(ticker)}`;
      const response = await fetch(yahooUrl, { headers: yahooHeaders() });
      const text = await response.text();
      return new Response(text, {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    if (url.pathname !== '/api/quote') {
      return json({ error: 'Not found' }, 404);
    }

    const ticker = url.searchParams.get('ticker');
    if (!ticker) return json({ error: 'ticker is required' }, 400);

    try {
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

      if (meta.marketState === 'PRE' && meta.preMarketPrice > 0) {
        price = meta.preMarketPrice;
        priceType = 'pre-market';
      } else if ((meta.marketState === 'POST' || meta.marketState === 'POSTPOST') && meta.postMarketPrice > 0) {
        price = meta.postMarketPrice;
        priceType = 'post-market';
      }

      return json({
        ticker: meta.symbol || ticker,
        price,
        priceType,
        marketState: meta.marketState || null,
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
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
