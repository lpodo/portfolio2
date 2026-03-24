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
**Worker endpoints:**
- `/api/quote?ticker=AAPL` — production quote
- `/api/debug?ticker=AAPL` — processed result (same logic, any ticker)
- `/api/debug1?ticker=AAPL` — raw meta from Yahoo 1d request
- `/api/debug2?ticker=AAPL` — last candles + pre/post windows from 5d request

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
  - `pt_finnhub` — backend URL (legacy key name, stores Cloudflare Worker URL)
  - `pt_sort` — sort state
- **JSONBin.io** — cloud sync for cross-device access
  - `pt_jbkey` — master key
  - `pt_jbbin` — bin ID (created automatically on first save)

## Position Structure

```json
{
  "id": 1234567890,
  "ticker": "EOG",
  "qty": 8,
  "entry": 134.00,
  "current": 140.75,
  "priceType": "regular"
}
```

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
- Add position: ticker + qty + entry price + current price (optional)
- Inline edit (✎) and delete (✕)
- Price update: ↻ per row or Refresh All (parallel)
- Sort by any column — persists across sessions
- P&L $ for full position: `(current - entry) × qty`
- P&L % per share: `(current - entry) / entry × 100`
- Market state indicator after P&L %:
  - No icon — regular session
  - 🌙 — pre-market or post-market
  - ✦ (gray) — market closed
- Summary: VALUE, P&L, RETURN

## Cloud Sync (Settings panel)

- **↓ SYNC FROM CLOUD** — pull latest data from JSONBin to current device
- **↑ OVERWRITE CLOUD** — push local data to JSONBin (destructive — overwrites cloud)
- Auto-save to cloud on every change
- Auto-load from cloud on app open

## Service Worker

Caches app shell for offline use. API requests are **never cached**:
- `workers.dev` — Cloudflare Worker (prices)
- `jsonbin.io` — cloud storage
- `finnhub.io` — legacy

**IMPORTANT: increment cache version string in `sw.js` on every deploy** (e.g. `portfolio-v1` → `portfolio-v2`).

## How to Start a New Dev Session

1. Paste this README
2. Paste current `index.html` from repository
3. Paste current `worker.js` from repository
4. Describe what needs to be changed

## Unused Files (legacy, safe to delete)

These files are leftovers from earlier attempts with Vercel and Railway and are no longer used:

- `api/quote.js` — Vercel serverless function (replaced by Cloudflare Worker)
- `vercel.json` — Vercel configuration
- `server.js` — Express server for Railway
- `package.json` — npm dependencies for Railway/Vercel
