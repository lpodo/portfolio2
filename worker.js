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

    // Debug endpoint — shows raw Yahoo v7 response fields
    if (url.pathname === '/api/debug') {
      const ticker = url.searchParams.get('ticker') || 'EOG';
      const yahooUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(ticker)}&fields=regularMarketPrice,preMarketPrice,postMarketPrice,marketState,preMarketTime,postMarketTime,regularMarketTime,currency,fullExchangeName,shortName`;
      const response = await fetch(yahooUrl, { headers: yahooHeaders() });
      const data = await response.json();
      const q = data?.quoteResponse?.result?.[0] || {};
      return json({
        marketState: q.marketState,
        regularMarketPrice: q.regularMarketPrice,
        regularMarketTime: q.regularMarketTime,
        preMarketPrice: q.preMarketPrice,
        preMarketTime: q.preMarketTime,
        postMarketPrice: q.postMarketPrice,
        postMarketTime: q.postMarketTime,
        currency: q.currency,
        exchangeName: q.fullExchangeName,
      });
    }

    if (url.pathname !== '/api/quote') {
      return json({ error: 'Not found' }, 404);
    }

    const ticker = url.searchParams.get('ticker');
    if (!ticker) return json({ error: 'ticker is required' }, 400);

    try {
      const yahooUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(ticker)}&fields=regularMarketPrice,preMarketPrice,postMarketPrice,marketState,preMarketTime,postMarketTime,regularMarketTime,currency,fullExchangeName,shortName,symbol`;

      const response = await fetch(yahooUrl, { headers: yahooHeaders() });
      if (!response.ok) return json({ error: `Yahoo HTTP ${response.status}` }, response.status);

      const data = await response.json();
      const q = data?.quoteResponse?.result?.[0];

      if (!q || !q.regularMarketPrice) {
        return json({ error: `Ticker not found: ${ticker}` }, 404);
      }

      let price = q.regularMarketPrice;
      let priceType = 'regular';

      if (q.marketState === 'PRE' && q.preMarketPrice > 0) {
        price = q.preMarketPrice;
        priceType = 'pre-market';
      } else if ((q.marketState === 'POST' || q.marketState === 'POSTPOST') && q.postMarketPrice > 0) {
        price = q.postMarketPrice;
        priceType = 'post-market';
      }

      return json({
        ticker: q.symbol || ticker,
        price,
        priceType,
        marketState: q.marketState || null,
        regularMarketPrice: q.regularMarketPrice,
        preMarketPrice: q.preMarketPrice || null,
        postMarketPrice: q.postMarketPrice || null,
        currency: q.currency || null,
        exchangeName: q.fullExchangeName || null,
        shortName: q.shortName || null,
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
