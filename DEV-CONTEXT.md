# Portfolio Terminal 2 — Developer Context

This document captures implementation decisions, current state, known issues and important nuances for continuing development.

---

## Project State

**Current version:** `portfolio-v310` (in `sw.js` cache string — must increment on every deploy)

**Files:**
- `index.html` — entire frontend (~4600 lines, single file, no build step)
- `worker.js` — Cloudflare Worker backend
- `sw.js` — Service Worker (cache versioning)
- `wrangler.toml` — Cloudflare deployment config
- `manifest.json` — PWA manifest
- `README.md` — feature documentation
- `SETUP.md` — setup guide for new users
- `DEV-CONTEXT.md` — this file

**Deployment:**
- Frontend: GitHub Pages (auto-deploys on push to `main`)
- Worker: Cloudflare Workers (auto-deploys via GitHub integration)
- gh-pusher.html: standalone tool to push files to GitHub from browser

---

## Architecture Decisions

### Single-file frontend
No frameworks, no build tools. Everything in one `index.html`. This is intentional — maximum portability, no dependencies, easy to inspect. The tradeoff is a large file (~250KB), but GitHub Pages CDN handles it well.

### Deployment via gh-pusher
`gh-pusher.html` is a standalone HTML tool that calls GitHub Contents API directly from the browser. The template is at `gh-pusher-template.html` (user uploads it each session). The escape function handles backticks, `${`, backslashes, and `</script>` tags. Generated pusher files are typically 200–250KB.

**Important:** `</script>` in file content must be escaped as `<\/script>` inside JS template literals to prevent the browser from ending the script tag early.

### Service Worker caching
SW uses a named cache (`portfolio-vXXX`). On install, old caches are deleted and new files are fetched. `skipWaiting()` and `clients.claim()` ensure immediate activation.

**Known issue:** GitHub Pages CDN sometimes serves stale `index.html` for 10-30 minutes after a push. sw.js (small file) propagates faster. This can cause the SW to cache old index.html. No reliable fix — user must wait or use incognito mode.

**Solution attempted:** `cache: 'no-store'` in SW install fetch — this doesn't help against CDN cache (server-side). Reverted to simple `c.addAll()`.

---

## Key Global Variables

```javascript
var portfolios = {};          // all equity portfolios { id: { name, positions, currencyCode, watchlist, archive } }
var currentPortfolioId;       // active portfolio id
var positions = [];           // shortcut: currentPortfolio().positions
var viewMode = 'main';        // current view: main/weight/market/movers/chart/analytics/summary/summary-*/archive-summary
var editId = null;            // id of position being edited
var expandedId = null;        // id of position with expanded attributes row
var sortKey = null;           // active sort column for P&L (active portfolios)
var sortDir = 1;              // sort direction 1=asc, -1=desc
var archiveSortKey = null;    // sort state for archive portfolios
var archiveSortDir = 1;
var closeMode = 'prev';       // market view close column: 'prev' or 'reg'
var currentMode = 'cur';      // market view current column: 'cur' or 'reg'
var editingPortfolioId = null;// portfolio being renamed in switcher
var movePosId = null;         // position id pending move
```

---

## Sort State

Sort is per portfolio type (not per portfolio):
- `getSortKey()` / `getSortDir()` — read correct state based on `_isArc()`
- `setSortState(key, dir)` — writes to `pt_sort` (active) or `pt_sort_arc` (archive)
- `_isArc()` checks `portfolios[currentPortfolioId].archive`
- Third click on a column header resets sort to insertion order (sortKey = null)

---

## View Mode Routing

`viewMode` values and their contexts:
- `main` — P&L (active/archive/watchlist)
- `weight` — WEIGHTS
- `market` — MARKET
- `movers` — TOP MOVERS
- `chart` — CHART
- `analytics` — ANALYTICS
- `summary` — P&L in summary context
- `summary-market` — MARKET in summary
- `summary-movers` — TOP MOVERS in summary
- `summary-chart` — CHART in summary
- `summary-analytics` — ANALYTICS in summary
- `archive-summary` — archive summary

`setView(mode)` handles routing from the ⋮ menu. `switchPortfolio(id)` resets summary modes to their base equivalents (e.g. `summary-movers` → `movers`). `switchToSummary()` maps portfolio modes to summary modes (e.g. `movers` → `summary-movers`).

**Menu visibility rules:**
- Archive: shows P&L, WEIGHT, ANALYTICS only
- Watchlist: shows MARKET, TOP MOVERS, CHART only
- Regular/Summary: shows all
- `vmMovers` visibility: hidden for archive, shown for all others

---

## Chart Implementation

### Data flow
`loadChartData(range)` → fetches history per ticker → builds daily value map → renders single line.
`loadPositionsChartData(range, selectedTickers)` → fetches per ticker → aligns to common x-axis → renders multi-line.

### Common x-axis alignment
All position lines use `allDates` (union of all tickers' dates) as x-axis. Newer tickers have `null` values before their IPO date. Lines are rendered as multiple polyline segments (split on null values). This was a major bug fix — before, each line used its own date range which caused newer stocks to appear stretched across the full chart width.

### Today's point
After loading history, `addTodayPoint(points, p)` appends a current-price point if `dateKey(p.priceTimestamp) !== dateKey(lastPoint.t)`. Uses `getChartCurrentPrice(p)` which respects `currentMode` — consistent with market view.

### 1D range
Uses `interval=5m` (~78 intraday points). No caching. No forward-fill. No today's point (already current). X-axis shows HH:MM in local time. Blocked in PORTFOLIO and SUMMARY modes.

### Cache
`chart_hist_{ticker}_{range}` — daily TTL. Cleared by the ↻ button in legend (which also refreshes prices first via `Promise.all`).

---

## Cloud Storage

### JSONBin
Direct browser → JSONBin. API key in localStorage (`pt_jbkey`). Bin ID auto-created on first save (`pt_jbbin`).

### Cloudflare KV
Browser → Worker (`/api/kv` GET/PUT) → KV namespace. KV Key in localStorage (`pt_kv_key`). KV namespace bound as `PORTFOLIO_KV` in wrangler.toml (name only, no ID — ID configured in Cloudflare Dashboard, persists across deployments).

**Important wrangler.toml insight:** `binding = "PORTFOLIO_KV"` without `id` works because Cloudflare merges the declaration from wrangler.toml with the Dashboard binding configuration. The ID never appears in the public repo.

### CORS fix
Worker OPTIONS handler must include `PUT` in `Allow-Methods` and `X-KV-Key, Content-Type` in `Allow-Headers`. Without this, PUT requests from the browser fail with CORS preflight error.

### Encryption
AES-GCM 256-bit, client-side. PBKDF2 key derivation (100K iterations). Random salt + IV per save. Cloud stores `{ encrypted: "base64..." }`. Worker never sees plaintext.

### Error handling
Cloud load errors show specific messages (not just "error") + status overlay on startup. Overlay disappears on success (800ms), stays on error, dismissable by tap anywhere.

---

## Partial Sell

`sellPosition(id)` shows a custom modal (not `prompt()`). Modal positioned at top (`padding-top: 60px`) to avoid keyboard overlap.

Logic in `confirmSell(id)`:
- Full sell: `positions.map()` → mark sold
- Partial sell: `positions.reduce()` → replace original with two records (sold portion + remainder)

Floating point safety: `Math.round((pos.qty - qtyInput) * 1e10) / 1e10` to avoid `0.1 + 0.2 = 0.30000000000000004` issues.

---

## Price Alerts

Stored as `pos.alerts = [{ condition: '>' | '<', value: number, triggered: boolean }]`.

- Checked in `refreshPrice()` after price update
- `triggered` is recalculated on every refresh, not persisted to cloud
- Yellow dot `●` shown after ticker in P&L when any alert is triggered
- Expanded row shows alerts with ✕ delete buttons
- Edit form shows existing alerts + add row (`>/<` select + price input + ADD button)
- `addAlert(posId)` and `deleteAlert(posId, alertIdx)` functions

---

## Position Attribute Inheritance

When adding a position (via form or CSV import), the app searches ALL portfolios (including archive and watchlist) for the same ticker. If found with category/region/sector values, those are copied to the new position.

Functions: `doAddPosition()` and the CSV import loop both implement this lookup.

---

## Archive & Move

`moveToArchive(posId, archivePid)` — creates a new position object in archive. Must explicitly copy `category`, `region`, `sector`, `note`, `alerts` — originally these were missing (bug fixed).

`moveToPortfolio(posId, targetPid)` — same issue, same fix. Also copies `previousClose`, `regularMarketPrice`, `marketState`, `priceType`.

---

## Known Issues / Pending

- **Cloud overlay** shows only when cloud is configured (fix applied in v306)
- **Settings panel** is scrollable (`max-height: 85vh; overflow-y: auto`) — was previously cut off on short screens, hiding the CLOUD STORAGE section entirely
- `pt_sort_arc` localStorage key name (note: underscore, not hyphen) 
- `expandedId` and `editId` are reset together on portfolio switch

---

## Things Not to Break

1. **Version string** in `sw.js` must change on every deploy
2. **`</script>` escaping** in gh-pusher template literals
3. **CORS headers** in worker OPTIONS handler must include `PUT` and `X-KV-Key, Content-Type`
4. **KV namespace binding** in wrangler.toml must stay as name-only (no id) — the id lives in Cloudflare Dashboard
5. **`addTodayPoint`** uses `getChartCurrentPrice(p)` (respects currentMode) — not `p.current` directly
6. **Common x-axis** in `renderMultiChart` — all lines must have same length values array (with nulls for missing dates)
7. **Sort functions** must use `getSortKey()` / `getSortDir()` — not global `sortKey` / `sortDir` directly

