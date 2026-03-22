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

    const ticker = url.searchParams.get('ticker') || 'EOG';

    // Debug 1: raw meta from fast 1d request
    if (url.pathname === '/api/debug1') {
      const r = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`,
        { headers: yahooHeaders() }
      );
      const d = await r.json();
      const meta = d?.chart?.result?.[0]?.meta || {};
      return json({ status: r.status, meta });
    }

    // Debug 2: last 10 candles from pre and post windows
    if (url.pathname === '/api/debug2') {
      const r = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1m&range=1d&includePrePost=true`,
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

      // Collect last 10 candles from each window
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
        marketState: meta.marketState,
        preCandles: preCandles.slice(-10),
        postCandles: postCandles.slice(-10),
      });
    }

    if (url.pathname !== '/api/quote') {
      return json({ error: 'Not found' }, 404);
    }

    // PRODUCTION QUOTE LOGIC
    const t = url.searchParams.get('ticker');
    if (!t) return json({ error: 'ticker is required' }, 400);

    try {
      // Step 1: fast request
      const r1 = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?interval=1d&range=1d`,
        { headers: yahooHeaders() }
      );
      if (!r1.ok) return json({ error: `Yahoo HTTP ${r1.status}` }, r1.status);
      const d1 = await r1.json();
      const meta = d1?.chart?.result?.[0]?.meta;
      if (!meta || !meta.regularMarketPrice) return json({ error: `Ticker not found: ${t}` }, 404);

      const marketState = meta.marketState || 'CLOSED';

      // Step 2: if not regular session, get extended hours candles
      if (marketState !== 'REGULAR') {
        const r2 = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?interval=1m&range=1d&includePrePost=true`,
          { headers: yahooHeaders() }
        );
        if (r2.ok) {
          const d2 = await r2.json();
          const result2 = d2?.chart?.result?.[0];
          const timestamps = result2?.timestamp || [];
          const closes = result2?.indicators?.quote?.[0]?.close || [];
          const tp = meta.currentTradingPeriod;

          let extPrice = null;
          let extType = null;

          if (marketState === 'PRE') {
            const s = tp?.pre?.start, e = tp?.pre?.end;
            for (let i = timestamps.length - 1; i >= 0; i--) {
              if (s && e && timestamps[i] >= s && timestamps[i] < e && closes[i] != null) {
                extPrice = closes[i]; extType = 'pre-market'; break;
              }
            }
          } else {
            // POST, POSTPOST, CLOSED — look for post-market data
            const s = tp?.post?.start, e = tp?.post?.end;
            for (let i = timestamps.length - 1; i >= 0; i--) {
              if (s && e && timestamps[i] >= s && timestamps[i] < e && closes[i] != null) {
                extPrice = closes[i]; extType = 'post-market'; break;
              }
            }
          }

          if (extPrice != null) {
            return json({
              ticker: meta.symbol || t,
              price: extPrice,
              priceType: extType,
              marketState,
              regularMarketPrice: meta.regularMarketPrice,
              preMarketPrice: extType === 'pre-market' ? extPrice : null,
              postMarketPrice: extType === 'post-market' ? extPrice : null,
              currency: meta.currency || null,
              exchangeName: meta.fullExchangeName || meta.exchangeName || null,
              shortName: meta.shortName || null,
            });
          }
        }
      }

      // Fallback: return regular market price
      return json({
        ticker: meta.symbol || t,
        price: meta.regularMarketPrice,
        priceType: 'regular',
        marketState,
        regularMarketPrice: meta.regularMarketPrice,
        preMarketPrice: null,
        postMarketPrice: null,
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
