import yahooFinance from 'yahoo-finance2';

export default async function handler(req, res) {
  // Handle CORS preflight
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
    const quote = await yahooFinance.quote(ticker, {}, { validateResult: false });

    if (!quote) {
      return res.status(404).json({ error: 'ticker not found' });
    }

    // Determine best price based on market state
    // marketState: PRE, REGULAR, POST, CLOSED, PREPRE
    const marketState = quote.marketState || 'CLOSED';
    let price = quote.regularMarketPrice;
    let priceType = 'regular';

    if (marketState === 'PRE' && quote.preMarketPrice) {
      price = quote.preMarketPrice;
      priceType = 'pre-market';
    } else if ((marketState === 'POST' || marketState === 'POSTPOST') && quote.postMarketPrice) {
      price = quote.postMarketPrice;
      priceType = 'post-market';
    }

    return res.status(200).json({
      ticker: quote.symbol,
      price: price,
      priceType: priceType,
      marketState: marketState,
      regularMarketPrice: quote.regularMarketPrice,
      preMarketPrice: quote.preMarketPrice || null,
      postMarketPrice: quote.postMarketPrice || null,
      currency: quote.currency,
      exchangeName: quote.fullExchangeName || quote.exchange,
      shortName: quote.shortName || null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to fetch quote' });
  }
}
