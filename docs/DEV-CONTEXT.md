# Portfolio Terminal 2 — Developer Context

Decisions, invariants, and non-obvious behaviour. Reading the code answers everything else.

---

## Project

- Single-file frontend: `index.html` (~9550 lines). No frameworks, no build.
- **Stack constraint: vanilla ES5 only** — `var`/`function`, no arrows / `const` / `let`.
- `fundamentals.js` — Yahoo Finance fundamentals, loaded as a separate script.
- `worker.js` — Cloudflare Worker backend; deploys via GitHub integration.
- `sw.js` — Service Worker.
- Frontend deploys to GitHub Pages on push to `main`.

---

## Service Worker

Stale-while-revalidate strategy. Both fetch paths must bypass the browser HTTP cache, otherwise GitHub Pages' default `Cache-Control: max-age=600` causes the SW to recache stale content:

- **Runtime fetch:** `fetch(e.request, { cache: 'no-cache' })`
- **Install pre-cache:** wrap each URL in `new Request(url, { cache: 'reload' })`

With this, the cache version (`portfolio-vXXX`) does NOT need bumping for routine content updates — stale-while-revalidate picks them up on the second reload. Bump only when the pre-cache URL list in `addAll([...])` changes, or to force-evict a known-bad version.

---

## Context Helpers — Core Pattern

```javascript
SUMMARY_BY_PORTFOLIO_VIEWS    // Σ Summary subviews
ALL_POSITIONS_VIEWS           // active cross-portfolio subviews
REALIZED_ALL_POSITIONS_VIEWS  // archive cross-portfolio subviews

isSummaryByPortfolio()        // viewMode is in the first list
isAllPositions()              // viewMode is in the second
isRealizedAllPositions()      // viewMode is in the third
isCrossPortfolioContext()     // any of the above
isWatchlist()                 // currentPortfolio is watchlist
isArchiveContext()            // currentPortfolio is archive
```

**Rule:** any check that asks "are we in one of these cross-portfolio modes" goes through a helper, not through inline `indexOf(viewMode) !== -1` lists. New viewModes added to the lists are automatically respected everywhere.

---

## View Modes

| Value | Context |
|---|---|
| `main` / `market` / `alerts` / `chart` / `fundamentals` / `weight` / `analytics` | individual portfolio |
| `summary` / `summary-market` / `summary-chart` | Σ Summary (by portfolio) |
| `summary-movers` / `summary-alerts` / `global-weight` / `summary-analytics` | ALL POSITIONS (active+watchlist, by position) |
| `realized-weight` / `realized-analytics` | Realized ALL POSITIONS (archive, by position) |
| `archive-summary` | Σ Summary in realized (aggregates stocks + bonds + cash) |
| `bonds` / `bond-summary` / `cash` | bonds / bond summary / cash |
| `movers` | legacy per-portfolio MARKET; no UI entry, kept for reload compat |

### `switchPortfolio(id)` — viewMode preservation

When switching to an individual portfolio, two cross-portfolio modes map to their individual equivalents:
- `summary-movers → market`
- `summary-alerts → alerts`

Everything else cross-portfolio falls back to `main`. The destination portfolio type then restricts the allowed set (watchlist: `market/movers/chart/alerts`; archive: `main/weight/analytics`; regular: all).

### Reload

All viewModes are preserved on reload EXCEPT `fundamentals → main` (spec'd as ephemeral). Validation falls back to first non-archive portfolio if `currentPortfolioId` is missing.

---

## Title Bar — `setTitleForCurrentView`

Single source of truth for title text AND the `.meta` class toggle on the header button. Never write `portfolioTitle.textContent` directly — `.meta` would go stale.

---

## Alerts — Ticker-Level

Alerts are keyed by ticker (`tickerAlerts = { 'AAPL': [...] }`), not by position. Same ticker held across portfolios / brokers / watchlists shares one alert set. Persisted in `pt_ticker_alerts` and in the cloud payload.

**Cleanup:** after any operation that could orphan a ticker (full sell, delete position, delete agg, rename ticker via edit, delete portfolio), call `cleanupAlertsForTickerIfUnused(ticker)`. It drops the registry entry if no live (non-sold, non-archive) or watchlist positions of that ticker remain. `moveToArchive` does NOT need cleanup — positions are already sold before they move.

**Archive context hides the alerts UI** (expanded row + edit form). Without this, editing a ticker's alert from a closed archive row would silently affect active siblings of the same ticker.

**Dots on sold positions:** all dot render sites use `getAlertDotsHtmlForPosition(p)`, which returns empty string when `p.sold`. The base `getAlertDotsHtml(alerts)` knows nothing about positions.

### ALERTS = strict subset of MARKET

ALERTS is not an independent view — it's MARKET filtered to positions with at least one alert, in three contexts (individual regular, individual watchlist, ALL POSITIONS). Same render, same totals, same sort state. `marketSort` is shared between MARKET and ALERTS; column clicks in one apply to the other.

---

## Sort State

Per-view globals, never per-portfolio:
- `marketSort` — MARKET + ALERTS (all contexts)
- `watchlistSort` — WL views
- `weightSort` — WEIGHTS / global-weight / realized-weight

Per-portfolio P&L sort: always read via `getSortKey()` / `getSortDir()` / `setSortState()`, never the underlying globals. Third click on a header resets to insertion order (key=null).

---

## Cloud Storage

Pattern: every data-mutating function must branch on backend:
```javascript
if (getCloudBackend() === 'kv') cloudSaveKV(); else cloudSave();
```
Calling `cloudSave()` directly silently skips KV users.

There are four write paths: `cloudSaveKV`, `cloudSave` (jsonbin plaintext), `backupData` (export), and the legacy v3 migration. All four must carry the same payload — forgetting a field in one drops data silently for users on that backend or operation.

**KV backend:** Browser → Worker `/api/kv` → KV. Worker CORS OPTIONS must include `PUT` in Allow-Methods and `X-API-Token, X-KV-Key, Content-Type` in Allow-Headers.

**Encryption:** AES-GCM 256, PBKDF2 100K iter, random salt + IV per save. Worker never sees plaintext.

---

## External Fetches

Every `fetch()` to an external service needs an `AbortController` timeout (15s):
```javascript
var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
var timer = controller ? setTimeout(function() { controller.abort(); }, 15000) : null;
// fetch with signal, clear timer in BOTH .then and .catch
```

Bare `fetch()` can hang indefinitely (LB holding connection). Combined with inflight-dedup maps (e.g. `fundInflight`), this permanently blocks a ticker until page reload.

Every `localStorage.setItem` cache writer needs an in-memory fallback to prevent refetch storms when quota is exceeded.

---

## Charts

- All multi-line charts use a common x-axis (`allDates` = union of all tickers' dates). Tickers with newer first dates get `null` for missing days; lines render as polyline segments split on nulls. Without this, newer tickers stretch across the full chart width.
- `addTodayPoint` uses `getChartCurrentPrice(p)` (respects `currentMode`), never `p.current` directly.
- `1D` range uses `interval=5m`, no caching, no today's point.
- Historical cache: `chart_hist_{ticker}_{range}` with daily TTL.

---

## Bonds & Deposits

Share `bondPortfolios` storage; `type: 'bond' | 'deposit'` distinguishes them. Bond positions with `qty=0` are watchlist-style (excluded from totals/counts but show RETURN and ANN.YIELD).

Bond selling is not implemented — bonds are held to maturity only.

`bondsDb` is shared across all bond portfolios. Inline edit uses string `bondId`, not array index.

---

## Position Classification

`category`, `region`, `sector`, `broker` come from dictionaries — free text not allowed. Adding a position searches all portfolios (incl. archive/watchlist) for the same ticker and inherits classification if found.

Broker fallback in display is `'default'` (positions with no broker semantically use the configured default broker), distinct from `'Other'` (missing attribute). Analytics view dims `'Other'` but NOT `'default'`.

---

## Partial Sell

Full sell marks position `sold: true` in place. Partial sell replaces with two records (sold portion + remainder).

Floating-point safety: `Math.round((pos.qty - qtyInput) * 1e10) / 1e10`.

Mutation pattern: update `positions` → write back to `portfolios[currentPortfolioId].positions` → call cleanup → `save()` → `render()`. The write-back is required for cleanup to see the new state.

---

## Move / Archive

Position copy must include all fields explicitly: `ticker, qty, entry, current, sold, currency, shortName, category, region, sector, purchaseDate, instrumentType, broker`. Missing any → silent data loss.

`alerts` is NOT copied — it lives in `tickerAlerts` and follows the ticker automatically.

---

## Gotchas

**Global `table { min-width: 400px }`** causes mysterious layout bugs in narrow containers or few-column tables (overflow, clipped content). Check this first. Fix: inline `min-width: 0` on the specific table.

**Bulk sed `s|pattern|replacement|g`** can match both call sites AND a wrapper function's body, creating infinite recursion. Use line-range sed, targeted `str_replace` calls, or apply call-site replacements before adding the wrapper.

**Modal z-index:** `archivePosMenu` z-index 500, agg detail modal z-index 400. Order matters when both are open.

---

## Things Not to Break

1. SW: `cache: 'no-cache'` on runtime fetch, `cache: 'reload'` on install `addAll`
2. `if (getCloudBackend() === 'kv') cloudSaveKV(); else cloudSave();` — never bare `cloudSave()`
3. All four cloud/backup write paths carry the same payload set
4. Sort state: read via `getSortKey()` / `getSortDir()`, never globals directly
5. Multi-line chart values arrays must be equal-length (nulls for missing dates)
6. `addTodayPoint` uses `getChartCurrentPrice(p)`, not `p.current`
7. Bond switcher count: filter `qty > 0`
8. Move/Archive: copy ALL position fields explicitly (alerts excluded — ticker-level)
9. Worker CORS: PUT in Allow-Methods; `X-KV-Key, Content-Type` in Allow-Headers
10. Cross-portfolio checks: use the helpers, never `indexOf(viewMode) !== -1`
11. New mutation paths that could orphan a ticker: call `cleanupAlertsForTickerIfUnused`
12. Title bar: through `setTitleForCurrentView()`, never direct `textContent`
13. External fetches: AbortController timeout, no exceptions
