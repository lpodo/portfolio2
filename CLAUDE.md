# Portfolio Terminal 2 — CLAUDE.md

## Project overview

PWA stock portfolio tracker. Single-file frontend (`index.html`, ~4200 lines of vanilla HTML/JS/CSS) + Cloudflare Worker backend (`worker.js`). No build tools, no npm, no frameworks.

- **Frontend**: GitHub Pages → `lpodo.github.io/portfolio2`
- **Backend**: Cloudflare Workers → `portfolio2.lpodolskiy.workers.dev`
- **Cloud storage**: JSONBin.io (client-side AES-GCM encrypted)
- **Price source**: Yahoo Finance (proxied through the worker)

## Repository structure

```
index.html      # Entire frontend app (~4200 lines)
worker.js       # Cloudflare Worker — Yahoo Finance proxy
sw.js           # Service Worker — offline caching
manifest.json   # PWA manifest
wrangler.toml   # Cloudflare project config
icon-*.png      # PWA icons: 16, 32, 192, 512
README.md       # User-facing docs
```

## Tech stack

- **No build step** — edit and deploy directly
- **Cloudflare Workers** — serverless, `wrangler deploy` to publish
- **GitHub Pages** — static hosting, push to deploy
- **localStorage** — all primary data, no server-side DB
- **JSONBin.io** — cross-device cloud backup (REST API, optional)

## Worker endpoints

All require `X-API-Token: TOKEN` header (token stored as Cloudflare Secret `API_TOKEN`).

| Endpoint | Returns |
|---|---|
| `GET /api/quote?ticker=AAPL` | `{ price, priceType, marketState, regularMarketPrice, previousClose, priceTimestamp, currency, exchangeName, shortName }` |
| `GET /api/history?ticker=AAPL&range=1mo` | `{ ticker, currency, points: [{t, c}] }` — daily closes only |
| `GET /api/profile?ticker=AAPL` | `{ sector, industry, country }` |
| `GET /api/debug?ticker=AAPL` | Same as `/api/quote` |
| `GET /api/debug1?ticker=AAPL` | Raw Yahoo 1d meta |
| `GET /api/debug2?ticker=AAPL` | Last candles + pre/post windows |

Valid `range` values for `/api/history`: `5d`, `1mo`, `3mo`, `6mo`, `1y`.

`/api/quote` two-step algorithm:
1. Fast `interval=1d` request → if in active regular session with trades → return immediately (`priceType: "regular"`, one request)
2. Otherwise → second request `interval=1m&range=5d&includePrePost=true` → find last non-null candle → compare to `regularMarketPrice` → set `priceType: "regular"` or `"extended"`

GBp (pence) normalization: LSE stocks reported in pence are auto-converted to GBP (÷100) in both `/api/quote` and `/api/history`.

## localStorage keys

| Key | Content |
|---|---|
| `pt_portfolios` | All equity portfolios + positions |
| `pt_bonds_db` | Bond definitions |
| `pt_bond_portfolios` | Bond portfolios + positions |
| `pt_current` | Active portfolio ID |
| `pt_finnhub` | Cloudflare Worker URL |
| `pt_token` | API token |
| `pt_sort`, `pt_wl_sort` | Sort state |
| `pt_jbkey` | JSONBin master key |
| `pt_jbbin` | JSONBin bin ID |
| `pt_cloud_ts` | Cloud sync timestamp (conflict prevention) |
| `pt_enc_key` | AES-GCM encryption password |
| `pt_close_mode` | Close column: `prev` / `reg` |
| `pt_current_mode` | Current column: `cur` / `reg` |
| `pt_chart_sel_{portfolioId}` | Per-portfolio POSITIONS chart ticker selection |
| `chart_hist_{ticker}_{range}` | Historical price cache (daily TTL) |
| `pt_agg_active`, `pt_agg_archive` | Aggregation mode state |
| `pt_movers_limit` | TOP MOVERS display limit |

## Key data structures

**Position:**
```json
{
  "id": 1234567890,
  "ticker": "EOG",
  "qty": 8,
  "entry": 134.00,
  "current": 140.75,
  "sold": false,
  "currency": "USD",
  "shortName": "EOG Resources, Inc.",
  "priceType": "regular",
  "marketState": "REGULAR",
  "regularMarketPrice": 140.75,
  "previousClose": 138.82,
  "category": "Energy",
  "region": "US",
  "sector": "Energy"
}
```

**Portfolio:**
```json
{
  "name": "OIL & GAS",
  "currencyCode": "USD",
  "watchlist": false,
  "archive": false,
  "positions": []
}
```

**Backup file** (`portfolio-backup-YYYY-MM-DD.json`):
```json
{ "version": 1, "date": "...", "portfolios": { ... } }
```

**JSONBin cloud payload** (plaintext): `{ portfolios, bondsDb, bondPortfolios }`  
Encrypted: `{ "encrypted": "<base64>" }`

## View modes

Available via ⋮ dropdown menu in each portfolio:

- **P&L** — default, full position details
- **WEIGHTS** — ticker / value / weight %
- **MARKET** — ticker / close / current / Δ%; CLOSE and CURRENT headers are clickable menus
- **TOP MOVERS** — positions sorted by absolute Δ%; available in portfolios, watchlists, and Summary
- **CHART** — historical chart; PORTFOLIO/POSITIONS toggle; 5D/1MO/3MO/6MO/1Y ranges
- **ANALYTICS** — breakdown by CATEGORY / REGION / SECTOR / CURRENCY

Watchlist portfolios: MARKET and CHART only.  
Archive portfolios: P&L and WEIGHTS only.

## Service Worker

Cache name: `portfolio-v260` (in `sw.js` line 1).  
**Must increment on every deploy** to invalidate old cache.

Cached on install: `./index.html`, `./manifest.json`, `./icon-192.png`

Never cached (API requests): `workers.dev`, `jsonbin.io`, `finnhub.io`, `financialmodelingprep.com`

## Deploy checklist

1. **Increment cache version** in `sw.js` → `portfolio-vNNN`
2. Commit and push → GitHub Pages auto-deploys `index.html`, `sw.js`, etc.
3. For worker changes: `wrangler deploy` from repo root

## Known discrepancies between README and code

| # | README says | Code does |
|---|---|---|
| 1 | `/api/history` returns `{t, o, h, l, c, v}` (OHLCV) | Returns `{t, c}` only (timestamp + close) |
| 2 | `/api/quote` accepts optional `?simple=1` | Not implemented in `worker.js` |
| 3 | `/api/quote` response fields listed without `exchangeName` | Worker always returns `exchangeName` |
| 4 | Service Worker excludes `workers.dev`, `jsonbin.io`, `finnhub.io` | Also excludes `financialmodelingprep.com` |
| 5 | All 4 icons listed in manifest | SW only caches `icon-192.png`; 512/32/16 not cached |

## Development notes

- All JS is embedded in `index.html` — no separate JS files
- FX rates: 5-minute in-memory cache, in-flight deduplication
- Aggregation is **display-only** — source positions unchanged
- Position clipboard: cut (delete) saves to in-memory clipboard; paste (⧉ button) restores — cleared on reload
- Chart history cache: daily TTL, auto-purged on new write
- Cloud conflict prevention: timestamp-based — save blocked if cloud is newer than `pt_cloud_ts`
- `cloudSave` triggered only on structural changes, never on price updates
