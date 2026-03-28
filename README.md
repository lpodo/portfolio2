# Portfolio Terminal 2

## What it is

A PWA stock portfolio tracker with a Cloudflare Worker backend. Supports all major exchanges, extended hours (pre/post market), and cross-device sync via JSONBin.

## Hosting & Access

- **GitHub Pages**: `lpodo.github.io/portfolio2` — frontend
- **Cloudflare Workers**: `portfolio2.lpodolskiy.workers.dev` — price backend
- **Repository**: `lpodo/portfolio2`
- **PWA**: installable on Android/iOS as home screen app

## Stack

- Pure HTML/JS/CSS — **single file `index.html`**, no frameworks or build tools
- **Cloudflare Worker** (`worker.js`) — serverless proxy to Yahoo Finance, bypasses CORS
- PWA files: `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png`, `icon-32.png`, `icon-16.png`
- No npm, webpack, React — maximum portability

## Price Source

Yahoo Finance via Cloudflare Worker — free, all major exchanges, extended hours.

**Algorithm:**

1. Fast request `interval=1d` → get `regularMarketPrice`, `regularMarketTime`, `currentTradingPeriod`
2. If `now >= regular.start && now < regular.end && regularMarketTime >= regular.start` → return `regularMarketPrice`, `priceType: "regular"` (one request)
3. Otherwise → second request `interval=1m&range=5d&includePrePost=true` → find last non-null candle
4. If `lastCandle.price ≈ regularMarketPrice` → `priceType: "regular"` 
5. Otherwise → `priceType: "extended"` 

**Market state** is determined from `currentTradingPeriod` windows vs `now` and returned in every response.

**Worker endpoints:**
- `/api/quote?ticker=AAPL&token=TOKEN` — production quote
- `/api/debug?ticker=AAPL&token=TOKEN` — processed result (same logic)
- `/api/debug1?ticker=AAPL&token=TOKEN` — raw meta from Yahoo 1d request
- `/api/debug2?ticker=AAPL&token=TOKEN` — last candles + pre/post windows from 5d request

All endpoints require `?token=` parameter matching `API_TOKEN` env variable in Cloudflare.

## Security

The worker is protected by a secret token stored as a Cloudflare environment variable `API_TOKEN`. Every request must include `?token=TOKEN`. To rotate the token: update `API_TOKEN` in Cloudflare → Settings → Variables and Secrets, then update in the app settings.

## Exchange Support

| Exchange | Ticker format | Example |
|---|---|---|
| NYSE / NASDAQ | no suffix | `EOG`, `AAPL` |
| LSE (London) | `.L` | `CJPU.L` |
| Xetra (Germany) | `.DE` | `CEBZ.DE` |
| Euronext Paris | `.PA` | `AIR.PA` |
| Euronext Amsterdam | `.AS` | `ASML.AS` |
| Tokyo | `.T` | `7203.T` |
| Milan | `.MI` | `ENI.MI` |
| Oslo | `.OL` | `EQNR.OL` |

## Data Storage

- **localStorage** — primary on-device storage
  - `pt_portfolios` — all portfolios and positions
  - `pt_current` — active portfolio ID
  - `pt_finnhub` — Cloudflare Worker URL (legacy key name)
  - `pt_token` — API token for Cloudflare Worker
  - `pt_sort` — sort state
  - `pt_jbkey` — JSONBin master key
  - `pt_jbbin` — JSONBin bin ID
- **JSONBin.io** — cloud sync for cross-device access

## Position Structure

```json
{
  "id": 1234567890,
  "ticker": "EOG",
  "qty": 8,
  "entry": 134.00,
  "current": 140.75,
  "priceType": "regular",
  "marketState": "REGULAR"
}
```

Note: `qty: 0` is allowed — used for watchlist candidates. Shows `—` in QTY and P&L $ columns, only P&L % is calculated.

## Portfolio Structure

```json
{
  "name": "OIL & GAS",
  "currency": "$",
  "positions": []
}
```

## Features

- Multiple portfolios — tap name in header to switch, add, rename, delete
- Currency symbol per portfolio — set at creation, editable via rename
- Watchlist mode — add position with qty=0 to track price dynamics without holding
- Add position: ticker + qty (0 allowed) + entry price + current price (optional)
- Inline edit (✎) and delete (✕)
- Price update: ↻ per row or Refresh All (parallel, single cloud save after all done)
- Sort by any column — persists across sessions
- P&L $ for full position: `(current - entry) × qty`
- P&L % per share: `(current - entry) / entry × 100`
- Market state indicator after P&L %:
  - No icon — regular session
  - 🌙 blue — pre-market or post-market
  - ✦ gray — market closed
- Summary: VALUE, P&L, RETURN

## Cloud Sync (Settings panel)

- **↓ SYNC FROM CLOUD** — pull latest data from JSONBin to current device
- **↑ OVERWRITE CLOUD** — push local data to JSONBin (destructive)
- Auto-save to cloud on every structural change (add/edit/delete position)
- Single cloud save after Refresh All completes
- Auto-load from cloud on app open

## Service Worker

Caches app shell for offline use. API requests are **never cached**:
- `workers.dev` — Cloudflare Worker (prices)
- `jsonbin.io` — cloud storage
- `finnhub.io` — legacy

**IMPORTANT: increment cache version string in `sw.js` on every deploy** (e.g. `portfolio-v35` → `portfolio-v36`).

## How to Start a New Dev Session

1. Paste this README
2. Paste current `index.html` from repository
3. Paste current `worker.js` from repository
4. Describe what needs to be changed

## Unused Files (legacy, safe to delete)

- `api/quote.js` — Vercel serverless function (replaced by Cloudflare Worker)
- `vercel.json` — Vercel configuration
- `server.js` — Express server for Railway
- `package.json` — npm dependencies for Railway/Vercel
