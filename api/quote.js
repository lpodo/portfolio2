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

  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'FMP_API_KEY not configured' });
  }

  const base = 'https://financialmodelingprep.com/stable';

  try {
    // 1. Get regular quote
    const quoteRes = await fetch(`${base}/quote?symbol=${encodeURIComponent(ticker)}&apikey=${apiKey}`);
    if (!quoteRes.ok) throw new Error(`Quote HTTP ${quoteRes.status}`);
    const quoteData = await quoteRes.json();
    const quote = Array.isArray(quoteData) ? quoteData[0] : quoteData;

    if (!quote || !quote.price) {
      return res.status(404).json({ error: `Ticker not found: ${ticker}` });
    }

    let price = quote.price;
    let priceType = 'regular';

    // 2. Try aftermarket quote — returns data only during extended hours
    try {
      const amRes = await fetch(`${base}/aftermarket-quote?symbol=${encodeURIComponent(ticker)}&apikey=${apiKey}`);
      if (amRes.ok) {
        const amData = await amRes.json();
        const am = Array.isArray(amData) ? amData[0] : amData;
        if (am && am.price && am.price > 0) {
          price = am.price;
          priceType = 'extended';
        }
      }
    } catch (e) {
      // aftermarket not available — use regular price
    }

    return res.status(200).json({
      ticker: quote.symbol || ticker,
      price: price,
      priceType: priceType,
      regularMarketPrice: quote.price,
      change: quote.change || null,
      changesPercentage: quote.changesPercentage || null,
      currency: null, // FMP stable doesn't return currency in quote
      exchangeName: quote.exchange || null,
      shortName: quote.name || null,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to fetch quote' });
  }
}
