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

    // Debug — returns extended hours price extraction
    if (url.pathname === '/api/debug') {
      const ticker = url.searchParams.get('ticker') || 'EOG';
      const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1m&range=1d&includePrePost=true`;
      const response = await fetch(yahooUrl, { headers: yahooHeaders() });
      const data = await response.json();
      const result = data?.chart?.result?.[0];
      const meta = result?.meta || {};
      const timestamps = result?.timestamp || [];
      const closes = result?.indicators?.quote?.[0]?.close || [];
      const preStart = meta.currentTradingPeriod?.pre?.start;
      const preEnd = meta.currentTradingPeriod?.pre?.end;
      const postStart = meta.currentTradingPeriod?.post?.start;
      const postEnd = meta.currentTradingPeriod?.post?.end;
      // Find last pre-market close
      let prePrice = null, postPrice = null;
      for (let i = timestamps.length - 1; i >= 0; i--) {
        const t = timestamps[i];
        if (t >= preStart && t < preEnd && closes[i]) { prePrice = closes[i]; break; }
      }
      for (let i = timestamps.length - 1; i >= 0; i--) {
        const t = timestamps[i];
        if (t >= postStart && t < postEnd && closes[i]) { postPrice = closes[i]; break; }
      }
      return json({
        marketState: meta.marketState,
        regularMarketPrice: meta.regularMarketPrice,
        preMarketPrice: prePrice,
        postMarketPrice: postPrice,
        totalDataPoints: timestamps.length,
        preStart, preEnd, postStart, postEnd,
        firstTimestamp: timestamps[0],
        lastTimestamp: timestamps[timestamps.length - 1],
      });
    }

    if (url.pathname !== '/api/quote') {
      return json({ error: 'Not found' }, 404);
    }

    const ticker = url.searchParams.get('ticker');
    if (!ticker) return json({ error: 'ticker is required' }, 400);

    try {
      // Use 1m interval to get pre/post market candles
      const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1m&range=1d&includePrePost=true`;
      const response = await fetch(yahooUrl, { headers: yahooHeaders() });
      if (!response.ok) return json({ error: `Yahoo HTTP ${response.status}` }, response.status);

      const data = await response.json();
      const result = data?.chart?.result?.[0];
      const meta = result?.meta;

      if (!meta || !meta.regularMarketPrice) {
        return json({ error: `Ticker not found: ${ticker}` }, 404);
      }

      const timestamps = result?.timestamp || [];
      const closes = result?.indicators?.quote?.[0]?.close || [];
      const preStart = meta.currentTradingPeriod?.pre?.start;
      const preEnd = meta.currentTradingPeriod?.pre?.end;
      const postStart = meta.currentTradingPeriod?.post?.start;
      const postEnd = meta.currentTradingPeriod?.post?.end;

      // Extract latest pre/post market price from candle data
      let prePrice = null, postPrice = null;
      for (let i = timestamps.length - 1; i >= 0; i--) {
        const t = timestamps[i];
        if (!prePrice && preStart && preEnd && t >= preStart && t < preEnd && closes[i]) {
          prePrice = closes[i];
        }
        if (!postPrice && postStart && postEnd && t >= postStart && t < postEnd && closes[i]) {
          postPrice = closes[i];
        }
        if (prePrice && postPrice) break;
      }

      // Determine market state by current time vs trading periods
      const now = Math.floor(Date.now() / 1000);
      let marketState = meta.marketState || null;
      if (!marketState) {
        const regStart = meta.currentTradingPeriod?.regular?.start;
        const regEnd = meta.currentTradingPeriod?.regular?.end;
        if (preStart && preEnd && now >= preStart && now < preEnd) marketState = 'PRE';
        else if (regStart && regEnd && now >= regStart && now < regEnd) marketState = 'REGULAR';
        else if (postStart && postEnd && now >= postStart && now < postEnd) marketState = 'POST';
        else marketState = 'CLOSED';
      }

      let price = meta.regularMarketPrice;
      let priceType = 'regular';

      if (marketState === 'PRE' && prePrice) {
        price = prePrice;
        priceType = 'pre-market';
      } else if ((marketState === 'POST' || marketState === 'POSTPOST') && postPrice) {
        price = postPrice;
        priceType = 'post-market';
      }

      return json({
        ticker: meta.symbol || ticker,
        price,
        priceType,
        marketState: marketState,
        regularMarketPrice: meta.regularMarketPrice,
        preMarketPrice: prePrice,
        postMarketPrice: postPrice,
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
