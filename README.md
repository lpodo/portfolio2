# Portfolio Terminal

## What it is

A PWA stock portfolio tracker with a Cloudflare Worker backend. Supports all major exchanges, extended hours (pre/post market), and cross-device sync via JSONBin.

## Hosting & Access

* **GitHub Pages**: `lpodo.github.io/portfolio2` — frontend
* **Cloudflare Workers**: `portfolio2.lpodolskiy.workers.dev` — price backend
* **Repository**: `lpodo/portfolio2`
* **PWA**: installed on Android as an app (icon on home screen)

## Stack

* Pure HTML/JS/CSS — **single file `index.html`**, no frameworks or build tools
* **Cloudflare Worker** (`worker.js`) — serverless proxy to Yahoo Finance, no CORS issues
* Additional PWA files: `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png`, `icon-32.png`, `icon-16.png`
* No npm, webpack, React — maximum portability

## Price Source

* **Yahoo Finance** via Cloudflare Worker — free, all major exchanges, extended hours
  * Regular session: `regularMarketPrice`
  * Pre-market (4:00–9:30 ET): extracted from 1m candles in pre-market window
  * Post-market (16:00–20:00 ET): extracted from 1m candles in post-market window
  * Extended hours shown with 🌙 indicator in the UI
  * Worker endpoint: `/api/quote?ticker=AAPL`
  * Debug endpoint: `/api/debug?ticker=AAPL`

## Exchange Support

* NYSE / NASDAQ — ✅ real-time
* LSE (e.g. `CJPU.L`) — ✅ works
* Other Yahoo Finance tickers — ✅ use Yahoo format (e.g. `7203.T`, `AIR.PA`)
* Extended hours — ✅ NYSE/NASDAQ only (LSE has no pre/post market)

## Data Storage

* **localStorage** — primary on-device cache, key `pt_portfolios`
* **JSONBin.io** — cloud storage for cross-device sync
  * Master Key: `localStorage['pt_jbkey']`
  * Bin ID: `localStorage['pt_jbbin']`
  * Bin created automatically on first save
  * Auto-loads from cloud on app open if keys present
  * "Migrate" button — moves local data to cloud
* Sort state: `localStorage['pt_sort']`
* Backend URL: `localStorage['pt_finnhub']` (legacy key name, stores Worker URL)

## Position Structure

```json
{
  "id": 1234567890,
  "ticker": "EOG",
  "qty": 8,
  "entry": 134.00,
  "current": 139.76,
  "priceType": "pre-market"
}
```

## Features

* Multiple portfolios — tap name in header to switch, add, rename, delete
* Add position: ticker + qty + entry price + current price (optional)
* Inline edit (✎) and delete (✕)
* Price update: FETCH per row or ↻ Refresh All (parallel requests)
* Sort by any column — persists across sessions
* P&L $ for full position: `(current - entry) × qty`
* P&L % per share: `(current - entry) / entry × 100`
* Extended hours indicator: 🌙 shown after P&L % when price is pre/post market
* Summary row: VALUE, P&L, RETURN

## Settings (bottom panel)

* Backend URL (Cloudflare Worker)
* Finnhub API Key (legacy, not used — backend handles prices)
* JSONBin Master Key + Bin ID
* Migrate local data to cloud

## PWA

* `manifest.json`: relative paths, `start_url: "."`, `scope: "."`
* `sw.js`: caches app shell; network-first for worker/jsonbin requests
* **Increment cache version in `sw.js` with every deploy**

## Cloudflare Worker

* File: `worker.js`
* Config: `wrangler.toml`
* No dependencies — pure fetch, no npm packages
* Deploy: connected to GitHub, auto-deploys on push
* Free tier: 100,000 requests/day

## What We Don't Do

* No CORS proxies — unreliable
* No Vercel for this project — blocks Yahoo Finance requests
* No Railway — no permanent free tier
* No FMP free tier — only AAPL as demo ticker
* No Alpha Vantage — CORS blocked from browser
* No frameworks — complicates PWA and deployment

## How to Start a New Dev Session

1. Paste this README
2. Paste current `index.html` from repository
3. Paste current `worker.js` from repository
4. Describe what needs to be changed
