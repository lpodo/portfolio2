# Portfolio Terminal

## What it is

A PWA stock portfolio tracker. Minimalist, no dependencies, works from any device.

## Hosting & Access

* **GitHub Pages**: `lpodo.github.io/portfolio`
* **Repository**: `lpodo/portfolio`
* **PWA**: installed on Android as an app (icon on home screen)

## Stack

* Pure HTML/JS/CSS — **single file `index.html`**, no frameworks or build tools
* Additional PWA files: `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png`
* No npm, webpack, React — maximum portability

## Price Sources

* **Finnhub API** — real-time stock prices, free, no rate limits
  * Endpoint: `https://finnhub.io/api/v1/quote?symbol={ticker}&token={key}`
  * Price field: `data.c`
  * Key stored in `localStorage` under `pt_finnhub`
* **Extended hours** — no reliable free source exists:
  * Polygon: $29/month
  * Alpaca paid: $9/month
  * Alpha Vantage: blocks CORS requests from browser (confirmed)
  * Yahoo Finance: intentionally blocks browser requests from any domain

## Data Storage

* **localStorage** — primary on-device cache, key `pt_portfolios` (multi-portfolio), legacy `pt_v3` auto-migrated on first launch
* **JSONBin.io** — cloud storage for cross-device sync
  * Master Key: `localStorage['pt_jbkey']`
  * Bin ID: `localStorage['pt_jbbin']`
  * Bin is created automatically on first save
  * On app open — auto-loads from cloud if keys are present
  * "Migrate" button — moves local data to cloud
* Sort state saved in `localStorage['pt_sort']`

## Position Structure

```json
{
  "id": 1234567890,
  "ticker": "EOG",
  "qty": 8,
  "entry": 134.00,
  "current": 135.72
}
```

## Features

* Add position: ticker + quantity + entry price + current price (optional)
* Inline edit (✎) and delete (✕)
* Price update: FETCH button per row or ↻ Refresh All (parallel requests)
* Sort by any column (TICKER, QTY, ENTRY, CURRENT, P&L $, P&L %) — click header to sort, click again to reverse, persists across sessions
* P&L $ calculated for full position: `(current - entry) × qty`
* P&L % calculated per share: `(current - entry) / entry × 100`
* Summary row after table: VALUE (total current value), P&L (total), RETURN (%)
* Multiple portfolios — tap portfolio name in header to switch, add, rename, or delete
* Add form at the bottom, below the table
* TICKER field: `type="search"` + `autocapitalize="characters"` — fix for Android numeric keyboard

## Settings (bottom panel)

* Slides up from bottom via ⚙ SETTINGS button
* Finnhub API Key
* JSONBin Master Key + Bin ID (with OK button to load from cloud)
* "Migrate local data to cloud" button

## PWA

* `manifest.json`: all paths relative (`./`), `start_url: "."`, `scope: "."`
* `sw.js`: caches `index.html`, `manifest.json`, `icon-192.png`; network-first for finnhub/jsonbin
* Service worker registered at the end of `index.html`
* **Increment cache version in `sw.js` (`portfolio-v2`, `portfolio-v3`, etc.) with every deploy**

## What We Don't Do (decisions are final)

* No CORS proxies — unreliable (corsproxy.io, allorigins go down)
* No Polygon — paid ($29/month) for snapshot endpoint
* No Alpha Vantage — blocks CORS requests from browser (confirmed)
* No Yahoo Finance — blocks all browser requests regardless of domain
* No frameworks — complicates PWA and deployment
* No request delays — Finnhub has no rate limits on free tier

## How to Start a New Dev Session

1. Paste the contents of this file
2. Paste the contents of the current `index.html` from the repository
3. Describe what needs to be changed
