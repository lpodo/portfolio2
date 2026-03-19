export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    return res.status(200).end();
  }

  res.setHeader('Access-Control-Allow-Origin', '*');

  const { ticker } = req.query;
  if (!ticker) {
    return res.status(400).json({ error: 'ticker is required' });
  }

  try {
    // Direct Yahoo Finance fetch - no library, no crumb
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d&includePrePost=true`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Origin': 'https://finance.yahoo.com',
        'Referer': 'https://finance.yahoo.com/',
      }
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `Yahoo HTTP ${response.status}` });
    }

    const data = await response.json();
    const meta = data?.chart?.result?.[0]?.meta;

    if (!meta || !meta.regularMarketPrice) {
      return res.status(404).json({ error: `Ticker not found: ${ticker}` });
    }

    const marketState = meta.currentTradingPeriod ? 'KNOWN' : 'CLOSED';
    let price = meta.regularMarketPrice;
    let priceType = 'regular';

    if (meta.preMarketPrice && meta.preMarketTime > meta.regularMarketTime) {
      price = meta.preMarketPrice;
      priceType = 'pre-market';
    } else if (meta.postMarketPrice && meta.postMarketTime > meta.regularMarketTime) {
      price = meta.postMarketPrice;
      priceType = 'post-market';
    }

    return res.status(200).json({
      ticker: meta.symbol || ticker,
      price: price,
      priceType: priceType,
      regularMarketPrice: meta.regularMarketPrice,
      preMarketPrice: meta.preMarketPrice || null,
      postMarketPrice: meta.postMarketPrice || null,
      currency: meta.currency || null,
      exchangeName: meta.fullExchangeName || meta.exchangeName || null,
      shortName: meta.shortName || null,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to fetch quote' });
  }
}
