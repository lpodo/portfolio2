import YahooFinance from 'yahoo-finance2';

const yf = new YahooFinance({
  fetchOptions: {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
    }
  }
});

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
    const quote = await yf.quote(ticker);

    if (!quote) {
      return res.status(404).json({ error: 'ticker not found' });
    }

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
