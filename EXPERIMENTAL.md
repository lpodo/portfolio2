# Experimental Branch — Yahoo Finance Extended Data Sandbox

Sandbox for exploring Yahoo Finance data beyond what production currently uses. Provides a focused single-ticker UI with multiple structured views (Market, Key Statistics, Quarterly Earnings, Analysts, Sentiment, Raw) backed by Yahoo's `quoteSummary` endpoint.

This branch is isolated from `main`. Nothing here affects the production worker or the main app.

## Files

Files added on top of the `main` baseline:

- `worker-test.js` — separate Cloudflare Worker (`portfolio-worker-test`) implementing the new endpoints
- `test.html` — single-page sandbox UI with multiple views, custom dropdown menu, in-memory cache
- `wrangler.toml` — overwritten in this branch to point Cloudflare's Git integration at `worker-test.js`
- `EXPERIMENTAL.md` — this document

Production files (`index.html`, `worker.js`, `sw.js`) are untouched in this branch.

## Why a separate worker

The new `quoteSummary` endpoint requires a fragile authentication flow (cookies + crumb token from Yahoo). If something breaks in this flow, the production worker should be unaffected. A separate worker gives full isolation during the experimental phase.

**Future plan:** when functionality stabilizes and is used in the main UI, the new logic will be merged into `worker.js` as a single consolidated worker. The merge is safe because:

- Old endpoints (`/api/quote`, `/api/history`, `/api/profile`) hit `query1.finance.yahoo.com/v8/finance/chart/...` — a different Yahoo endpoint that does **not** require crumb.
- Only the new `/api/quotesummary` endpoint triggers `ensureCrumb()`.
- If Yahoo's crumb flow breaks, only the new endpoint fails. The chart-based endpoints continue to work because they share no state and call no shared code paths.

Two-worker architecture (one prod, one test forever) was considered and rejected: extra URL in the frontend config, more moving parts, no real benefit once crumb-flow has been validated.

## Yahoo Finance authentication flow

The endpoint `https://query1.finance.yahoo.com/v10/finance/quoteSummary/{ticker}` requires authenticated requests:

1. **Get cookies.** Request `https://fc.yahoo.com` → Yahoo returns 404 but sets session cookies in `Set-Cookie` headers.
2. **Get crumb.** Request `https://query1.finance.yahoo.com/v1/test/getcrumb` with the cookies → Yahoo returns a small string (the crumb token).
3. **Use cookies + crumb.** Every `quoteSummary` request must include the cookies as `Cookie:` header and the crumb as `crumb=...` query parameter.

Cookies and crumb expire after some time (~30+ minutes, exact TTL undocumented by Yahoo). On expiry, requests return 401/403 and the flow must be re-run.

## Crumb caching: in-memory, not KV

Crumb + cookies are cached in a module-scoped variable inside the worker (`crumbCache`) with a 30-minute TTL. KV was considered and rejected.

**Reasoning:**

- This is a personal, low-traffic app. Realistic load: one user, occasional sessions, fundamentals fetched on demand.
- With in-memory: cold start happens at most once per session (the first quotesummary request after isolate startup), costing ~500-1000 ms. All subsequent requests in the same isolate hit the cache in <10 ms.
- With KV: every quotesummary request adds ~20 ms of KV-read latency. Arithmetically worse than the rare cold start once a session has more than ~50 requests, and adds an extra dependency, write-throttling concerns, and more code.
- KV would only pay off in a multi-user scenario where many people share warmed crumbs, or in an auto-refresh-everything scenario.

An auto-retry-once on 401/403 handles cases where Yahoo invalidates the crumb mid-session (the cached value is forcibly refreshed and the request is replayed once).

**Revisit if:** cold-start latency becomes noticeable in real use. Switching to KV later is ~15 minutes of work.

## Worker endpoints

All endpoints require an `X-API-Token` header matching the worker's `API_TOKEN` environment secret. CORS is wide-open (`Access-Control-Allow-Origin: *`) to allow local testing from `file://` or any dev server.

### `GET /api/quotesummary`

Main endpoint. Query parameters:

- `ticker` (required) — Yahoo ticker symbol (e.g. `AAPL`, `BRK-B`, `ASML.AS`)
- `modules` (required) — comma-separated list of Yahoo modules

Returns the raw `quoteSummary` response from Yahoo with the original `quoteSummary.result[0].{module}` structure preserved.

Example: `GET /api/quotesummary?ticker=AAPL&modules=assetProfile,financialData`

### `GET /api/debug/crumb`

Diagnostic. Returns current cached crumb info:
```json
{ "crumb": "uk07R.4dwR7", "cookieLength": 97, "expiresInSec": 1798 }
```
Add `?force=1` to bypass cache and re-fetch immediately. Useful for verifying the auth flow in isolation.

### `GET /api/raw`

Passthrough for arbitrary Yahoo URLs. Useful when experimenting with endpoints not covered by `/api/quotesummary`. Query parameter:

- `url` (required) — must start with `https://query[12].yahoo.com` or `https://finance.yahoo.com`

Crumb is automatically appended if not already present in the URL.

### Errors

Worker returns errors as JSON. Worker-level errors include an `_error` field; underlying Yahoo errors are wrapped under `_yahoo`. The token check returns plain `{ "error": "Forbidden" }` with 403.

## test.html — architecture

### Storage keys (localStorage)

- `yahoo-sandbox-settings` — `{ workerUrl, apiToken }` — worker URL and API token
- `yahoo-sandbox-modules` — array of selected modules for Raw view
- `yahoo-sandbox-view` — name of currently selected view (with migration for renamed keys)

### State

- `dataCache = { ticker, modules: {} }` — in-memory cache of fetched Yahoo modules, keyed by ticker. When the user enters a new ticker and clicks Go, the cache is invalidated; when they switch view, the cache is reused.
- `currentView` — currently selected view name, persisted to localStorage

### Data flow

User clicks **Go**:
1. Read ticker from input
2. Determine required modules for current view (`VIEWS[currentView].modules`)
3. If ticker changed → invalidate cache
4. Force-refresh: drop cached entries for required modules
5. Fetch the missing modules from `/api/quotesummary`
6. Merge into `dataCache.modules`
7. Call `VIEWS[currentView].render(dataCache.modules, container)`

User switches **view** (via dropdown menu):
1. Set `currentView`, save to localStorage
2. Determine modules required by new view
3. If all required modules already in cache for this ticker → just re-render (no fetch)
4. Otherwise fetch only the missing modules and merge
5. Re-render

This means **switching views never re-fetches if cache covers it**. A typical session: enter ticker, click Go (fetches modules for one view), switch through other views (most data overlaps — minimal additional fetches).

### VIEWS object

Each view declares its label, required modules, whether checkboxes are visible, and an independent render function:

```javascript
const VIEWS = {
  market:     { label: 'Market',             modules: [...], render: (data, container) => ... },
  statistics: { label: 'Key Statistics',     modules: [...], render: ... },
  quarterly:  { label: 'Quarterly Earnings', modules: ['earnings'], render: renderQuarterlyView },
  analyst:    { label: 'Analysts',           modules: [...], render: renderAnalystView },
  sentiment:  { label: 'Sentiment',          modules: ['defaultKeyStatistics'], render: ... },
  raw:        { label: 'Raw',                modules: null,  render: renderRawView, showCheckboxes: true },
};
```

`modules: null` means "use whatever the checkboxes show" (only Raw view does this).

New views (tables, charts, custom layouts) plug in here without touching anything else.

### FIELDS catalog and `renderFieldGroups`

For list-style views (Market, Key Statistics, Sentiment), fields are defined as a catalog with multi-path fallbacks:

```javascript
const FIELDS = {
  regularMarketPrice: { paths: ['price.regularMarketPrice'] },
  marketCap:          { paths: ['price.marketCap', 'summaryDetail.marketCap'] },
  exDividendDate:     { paths: ['summaryDetail.exDividendDate', 'calendarEvents.exDividendDate'], format: 'date' },
  // ...
};
```

`paths` is an ordered list — the first path that yields a usable value wins. `format` can be `'date'` or `'date-range'`.

Views then declare GROUPS — arrays of arrays of field names. `renderFieldGroups` iterates them, builds rows, and inserts dividers between non-empty groups. Empty fields are skipped; empty groups (all fields skipped) collapse entirely so no orphan dividers appear.

### Custom rows (composite layout)

`renderFieldGroups` also supports custom rows that don't fit the label/value pattern. Inside a group, a `{ custom: fn }` object replaces a field name string. The function receives the data and returns full HTML for that row (or `null` to skip):

```javascript
const MARKET_GROUPS = [
  ['regularMarketPrice', { custom: buildExtendedHoursRow }, { custom: buildBidAskRow }],
  // ... other plain groups
];
```

This is used by Market view for:
- **Extended hours row** — `postMarketPrice 308.12 +1.73 (+0.57%)` or `preMarketPrice 304.50 -1.89 (-0.62%)`, only when relevant
- **Bid/ask row** — `bid 305.52 × 700  ask 313.97 × 400` (composite single-line layout)

### Value formatting

`formatField(value, format)` handles Yahoo's `{ raw, fmt, longFmt }` wrappers as follows:

- For `'date'` format: prefers `raw` (Unix timestamp) → ISO `YYYY-MM-DD`. Falls back to `fmt`.
- For `'date-range'` format: array of timestamps → "YYYY-MM-DD – YYYY-MM-DD".
- Default: prefers `fmt` if present (Yahoo's pre-formatted "1.23B" / "+1.5%"). Falls back to formatted `raw`.

This means Yahoo's locale-formatted numbers (`fmt`) are displayed as-is for non-date fields. Dates are normalized to ISO regardless of Yahoo's locale.

`isUseful(value)` returns `false` for nulls, empty objects, empty wrappers `{}`, etc. — used to skip rendering fields where Yahoo returned a wrapper with no usable content.

## Views — what they show

### Market

Live quote and price-range data for a single ticker.

**Modules:** `price`, `summaryDetail`, `defaultKeyStatistics`

**Layout:**

```
regularMarketPrice  306.39
preMarketPrice      304.50  -1.89 (-0.62%)   ← only when extended hours session is active
bid 305.52 × 400   ask 312.00 × 100          ← composite row, hidden if no quote data
─────────────────────────────────────────
dayLow              305.49
dayHigh             310.93
fiftyTwoWeekLow     195.07
fiftyTwoWeekHigh    315.00
fiftyDayAverage     275.28
twoHundredDayAverage 263.24
allTimeHigh         315.00                   ← only present when Yahoo provides it
─────────────────────────────────────────
volume              45.21M
averageVolume       48.07M
averageVolume10days 55.45M
─────────────────────────────────────────
beta                1.07
```

**Extended hours logic:** compares `regularMarketTime`, `postMarketTime`, `preMarketTime` and picks the most recent. If `regularMarketTime` wins, the extended hours row is hidden (the regular session is currently live and the regularMarketPrice row already shows the live data). If `post` or `pre` wins, that session's data is shown. This correctly handles:

- During pre-market trading → `preMarketTime` freshest → shows pre row
- During regular session → `regularMarketTime` freshest → extended row hidden
- During post-market → `postMarketTime` freshest → shows post row
- Overnight/weekends → whichever extended timestamp is most recent (typically last day's post) is shown

### Key Statistics

Fundamentals grouped by topic.

**Modules:** `price`, `summaryDetail`, `defaultKeyStatistics`, `financialData`, `calendarEvents`

**Groups (in order):** Size (marketCap, totalAssets) · Cash/Debt (totalCash, totalDebt, operatingCashflow, freeCashflow) · Revenue/Margins (totalRevenue, revenueGrowth, netIncomeToCommon, earningsGrowth, profitMargins) · Valuations (trailingPE, forwardPE, priceToSalesTrailing12Months, priceToBook, trailingEps, forwardEps, pegRatio) · Dividends (lastDividendValue, lastDividendDate, exDividendDate) · Earnings calendar (earningsDate).

ETFs show very few groups (most fundamental data is absent for funds) — this is expected behavior.

### Quarterly Earnings

A 5-column table joining `earnings.financialsChart.quarterly[]` (revenue, earnings) and `earnings.earningsChart.quarterly[]` (actual EPS) by `date`.

**Modules:** `earnings`

| Quarter | Revenue | Earnings | Net Margin | EPS |

- Date format: `"1Q2024"` (calendar quarter, not fiscal — Yahoo normalizes this)
- Net margin is **computed locally**: `earnings.raw / revenue.raw * 100` — Yahoo doesn't expose quarterly net margin directly
- Sorted by quarter ascending (oldest first)
- Yahoo typically returns 4 most recent quarters

### Analysts

Three blocks plus a history table.

**Modules:** `financialData`, `recommendationTrend`, `upgradeDowngradeHistory`

**Block 1 (top-left):** targets with %-change vs currentPrice:
```
currentPrice              306.31
targetHighPrice           400.00     +30.6%
targetLowPrice            215.00     -29.8%
targetMeanPrice           310.51      +1.4%
targetMedianPrice         310.00      +1.2%
```

**Block 2 (top-right, divided by vertical line):** recent vote counts from `recommendationTrend.trend[0]`:
```
strongBuy   7
buy        23
hold       15
sell        1
strongSell  2
```

**Block 3 (below top, separate so long values don't deform the targets column):**
```
recommendationMean  1.48
recommendationKey   strong_buy
# of analysts       40
```

(Note: `numberOfAnalystOpinions` is renamed in the display to `# of analysts` — the original Yahoo name would inflate the label column too much. All other labels are exact camelCase Yahoo field names.)

**History section:** filtered to last 100 days from `upgradeDowngradeHistory.history`.

Above the table, two summary rows:
```
Avg target (100d)        352.45    +13.7%
Avg target ( [30] d)     341.20    +10.1%
```

The second row has a 2-digit numeric input. As the user types, the average target over that period is recalculated in real time. Both rows show ±% vs current price when available.

**The two-period spread is interesting** — when avg target (30d) > avg target (100d), analyst sentiment has improved recently. Useful as a real-time sentiment-change indicator.

**Table columns:** Date · Firm · Grade · Target · Prior. Horizontally scrollable on narrow screens. Sorted by date descending (newest first).

### Sentiment

Ownership and short interest. The simplest view — pure label/value pairs.

**Modules:** `defaultKeyStatistics`

**Groups:** Ownership (heldPercentInsiders, heldPercentInstitutions) · Short interest (sharesShort, sharesShortPriorMonth, shortPercentOfFloat)

### Raw

Original card-based view for exploring any Yahoo module. Checkboxes select modules; on Go each selected module is fetched and rendered as a card with structured key/value table plus collapsible raw JSON.

The only view where the module-checkboxes panel is visible.

## UI details

### Custom in-place dropdown menu

The view selector is **not** a native `<select>` element. The native picker on mobile pops a full-screen system dialog, which felt heavy for switching between 6 views. Instead:

- A button (right side of the query bar) shows the current view label and a `▾` arrow
- Click → a small panel drops down right below the button
- Each menu item is a button styled like a row; current view is highlighted in accent color
- Click an item → switches view, closes panel
- Click outside the panel → closes
- `Escape` key → closes

No external libraries; ~50 lines of CSS and JS.

### Settings modal

Triggered automatically on first run (when worker URL and token are missing) or via the ⚙ button in the header.

- Worker URL field auto-prepends `https://` if the scheme is missing — addresses the most common setup error.
- API token field is `type="password"` (masked)

Settings persist in `localStorage` under `yahoo-sandbox-settings`.

### Module checkboxes (Raw view only)

Grouped by category (Profile / Statistics / Analyst / Earnings / Financials / Ownership / Other). Three action buttons:

- **Select all** / **Select none**
- **Default** — resets to 5 most useful modules

Selections persist per-user across sessions in `localStorage` under `yahoo-sandbox-modules`.

### Custom days input (Analysts view)

A 2-character numeric input embedded in a label, e.g. `Avg target ( [30] d)`. Uses `inputmode="numeric"` so mobile keyboards open in number mode. Width is 44px (after iteration — 32px was too tight for two digits). Live recalculation on each keystroke.

## Yahoo modules used (cross-reference)

| Module | Used by |
|---|---|
| `price` | Market |
| `summaryDetail` | Market, Key Statistics |
| `defaultKeyStatistics` | Market, Key Statistics, Sentiment |
| `financialData` | Key Statistics, Analysts |
| `calendarEvents` | Key Statistics |
| `earnings` | Quarterly Earnings |
| `recommendationTrend` | Analysts |
| `upgradeDowngradeHistory` | Analysts |
| any | Raw (user picks) |

## Decisions log

Architecture and design decisions made during the build, recorded so we don't relitigate them:

- **Separate worker for now**, merge into `worker.js` later — keeps production safe during the unstable Yahoo crumb-flow validation period
- **In-memory crumb cache** instead of KV — see [Crumb caching](#crumb-caching-in-memory-not-kv) section
- **VIEWS + FIELDS + custom rows architecture** — each view has its own render function; list-style views share a catalog and renderer; specialized views (Quarterly, Analysts) have custom renderers
- **Cache by ticker** — switching views reuses fetched modules; entering a new ticker invalidates everything
- **Empty fields hidden, not shown with dashes** — for ETFs and other tickers with sparse data, dashes everywhere would be ugly; collapse instead
- **Empty groups also hidden** — including their preceding divider, so no orphan separators
- **Net margin computed locally** — Yahoo doesn't expose quarterly net margin; trivial to compute from revenue and earnings
- **Custom dropdown menu, not `<select>`** — mobile UX, avoid native picker, control over styling
- **Two-block Analysts top layout** — targets block (with pct column) is separated from the recommendation summary block (mean/key/count) because a long `recommendationKey` value like `strong_buy` would force the targets value column wider on tickers like MU
- **Timestamp-based extended hours session detection** — Yahoo keeps stale extended-hours fields populated all day; only timestamp comparison correctly identifies the active session
- **Labels are exact Yahoo camelCase field names** — except `# of analysts` (otherwise `numberOfAnalystOpinions` was too long and stretched the layout)
- **Non-breaking spaces (`&nbsp;`) for layout gaps** in composite rows — proved more reliable across browsers than empty inline-block spacers with CSS width
- **Auto-prepend `https://`** to worker URL in settings — common setup mistake that wasted minutes of debugging time
- **Dates as `YYYY-MM-DD`** — derived from raw Unix timestamps rather than Yahoo's `fmt` strings, which use locale-dependent formats like "Nov 5, 2024"
- **All numbers with decimals are shown with exactly 2 decimal places** — Yahoo's `fmt` strings inconsistently use 1 or 2 decimals (e.g. `"42.1B"` vs `"42.10B"`). A `normalizeFmt()` helper pads single-decimal strings to 2 places. Applies everywhere — table cells, target percentages, analyst summary, raw values.
- **Bid/ask zero values shown as `—`** — Yahoo often returns `0` for bid/ask outside trading hours; treating these as missing (dash) is more honest than displaying `0`. Row hides only when both bid AND ask are entirely absent.
- **Verbose 52-week/50-day/200-day labels shortened to numeric prefixes** — `fiftyTwoWeekLow` → `52WeekLow`, `twoHundredDayAverage` → `200DayAverage`, etc. Field keys in FIELDS act as both lookup IDs and display labels; Yahoo's API paths stay unchanged in the descriptor.
- **Module split: live vs research** — `price` and `summaryDetail` are treated as "live" (never cached). All other modules (`defaultKeyStatistics`, `financialData`, `calendarEvents`, `earnings`, `recommendationTrend`, `upgradeDowngradeHistory`) are "research" (cached). Drives view design: each view's modules are exclusively from one category. See [Main-app integration plan](#main-app-integration-plan).

## Main-app integration plan

This section captures finalized design decisions for bringing sandbox functionality into `index.html`. Nothing here is implemented yet.

### Goal

Bring research data into the main app in two layers:

1. **Compact 4th and 5th rows** in the expanded position view, alongside CAT/REG/SEC, NOTE, ALERTS. Always rendered (even if data is missing). Show what's already in localStorage cache; sometimes triggers a fetch on expand if cache is stale/missing.
2. **"More" button** at the end of the 5th row, opens a separate full-screen view with sandbox-style tabs (Market / Key Statistics / Quarterly Earnings / Analysts / Sentiment / Raw). Integrated into the app, not a link to external page.

### Module split: live vs research

The architectural insight: Yahoo modules split cleanly into two categories.

**Live modules — never cached, fetched fresh per More-session:**

- `price`
- `summaryDetail`

Contain real-time data (current price, bid/ask, volume, day range, extended-hours fields).

**Research modules — cached locally per ticker (4th row only):**

- `financialData`
- `defaultKeyStatistics`
- `recommendationTrend`

Only these three are persisted in localStorage. The other research modules (`calendarEvents`, `earnings`, `upgradeDowngradeHistory`) are not cached — they're only needed inside More, where memory-session caching is sufficient.

### Two independent caching mechanisms

1. **4th-row cache (localStorage):** Per-ticker entry with 4-hour TTL. Powers the always-visible compact rows on the main portfolio view. Caches only the three modules listed above.

2. **More-session cache (in-memory):** Lives for the duration of a single open "More" screen. Refetches everything on next open. No TTL, no persistence.

These mechanisms do **not** share data. Opening More always fetches fresh, even if 4th-row cache has overlapping modules. Simplicity over micro-optimization.

### More-screen behavior

**On open:**
- Screen opens directly to **Market tab** (always)
- Triggers fetch of `price` + `summaryDetail` immediately → stored in memory
- Memory store initialized empty for the session

**On tab switch (lazy module loading):**
- If switching to a tab whose required modules are not yet in memory → fetch them, add to memory
- If already in memory → render instantly without refetch

**On close:**
- In-memory store discarded
- Reopening triggers fresh fetches for whatever tabs are visited

**On long-open sessions (user leaves More open for hours):**
- Accepted as edge case — data may be stale
- No auto-refresh, no visibility-based refetch
- Closing and reopening gives fresh data

### Tab-to-modules mapping

| Tab            | Modules                                                           |
|----------------|-------------------------------------------------------------------|
| Market         | `price`, `summaryDetail`                                          |
| Key Statistics | `defaultKeyStatistics`, `financialData`, `calendarEvents`         |
| Quarterly      | `earnings`                                                        |
| Analysts       | `financialData`, `recommendationTrend`, `upgradeDowngradeHistory` |
| Sentiment      | `defaultKeyStatistics`                                            |
| Raw            | user-selected                                                     |

### 4th-row content (final)

Two lines, no row labels (the smaller expanded-view font makes labels redundant). Both rendered when position is expanded; individual missing fields just don't appear.

**Line 1 — analyst vote breakdown** (from `recommendationTrend.trend[0]`):
```
strongBuy 4  buy 11  hold 5  sell 0  strongSell 0
```

**Line 2 — valuation summary + More button:**
```
Avg target: 1,417.25 (+10.67%)  P/E: 18.37  fw P/E: 29.26  [More]
```

Field sources:
- `Avg target` → `financialData.targetMeanPrice`
- Upside `%` → computed as `(targetMeanPrice − currentPrice) / currentPrice × 100`, using `financialData.currentPrice`
- `P/E` (trailing) → **computed client-side** as `financialData.currentPrice / defaultKeyStatistics.trailingEps`. Yahoo's `summaryDetail.trailingPE` is the only direct source for this, and `summaryDetail` is not cached. The computed value will be slightly less fresh than Yahoo's but accurate within the 4-hour cache window.
- `fw P/E` → `defaultKeyStatistics.forwardPE`

Color coding deferred. Upside % will likely become green/red for consistency with the change% in the header row — but that's a follow-up.

### ETF and missing-data behavior

For tickers without analyst coverage (most ETFs):
- Vote line: empty (no values displayed)
- Valuation line: shows only fields with data; if all empty, line shows just `[More]` on the right
- More button is always present — even if 4th-row data is empty, More may still be useful (Market view always works)

### Loading state

Nothing displayed during a cache-miss fetch. When data arrives, rows populate. No spinners, no placeholders.

### What is NOT cached and NOT computed

Decisions about Yahoo data we explicitly **don't** bring into the main app's cache or computation pipeline:

- `marketCap` — only in Market view (live), no separate compute pipeline
- `priceToSalesTrailing12Months` — only in Market/Statistics view (live), not in 4th row
- `52WeekLow/High`, `50DayAverage`, `200DayAverage`, `beta`, `volume`, `averageVolume*` — Market-only
- `bid/ask`, day ranges, extended hours — Market-only
- `earnings` quarterly history, `upgradeDowngradeHistory` records, `calendarEvents` (other than what 4th row uses) — More-only

This keeps the 4th-row cache narrow: three modules per ticker, minimal storage, low complexity.

### Fetch strategy summary

| Trigger                                    | Source                  | Modules                              |
|--------------------------------------------|-------------------------|--------------------------------------|
| Position expanded (4th row)                | localStorage cache, fetch if stale | financialData, DKS, recommendationTrend |
| More opened                                | network (always)        | price, summaryDetail                 |
| More tab switched (not previously loaded)  | network                 | tab-specific modules                 |
| All other navigation                       | no fetch                | —                                    |

No bulk endpoint. Per-ticker fetches keep architecture simple. Crumb cache in the worker amortizes Yahoo auth cost across requests.

### Storage choice

`localStorage` over `IndexedDB`:
- Synchronous API is simpler
- For current scale (≤100 positions × 3 modules × ~5 KB each = ~1.5 MB), well under the 5 MB limit
- IndexedDB migration remains viable if portfolios grow significantly

### Resolved design decisions

- **"More" button:** thin right-arrow icon inside a framed border, rendered in a blue accent color that is not used anywhere else in the app. The uniqueness of the color ensures the button stands out from the surrounding dim/bright terminal palette without requiring extra space for a text label.

## Known issues / Yahoo quirks

- **EU datacenters and consent flow.** Cloudflare Workers may execute from any datacenter. If a request originates from an EU region, Yahoo may redirect to a consent flow instead of returning cookies directly from `fc.yahoo.com`. Not observed yet in practice, but a known failure mode. Fix would involve adding a consent-flow fallback in `ensureCrumb()`.
- **Crumb TTL is non-deterministic.** The 30-minute cache TTL is a guess. Yahoo can invalidate crumbs earlier. The auto-retry-once on 401/403 handles this transparently.
- **Yahoo API is unofficial.** The `quoteSummary` endpoint is not documented or supported. Yahoo can change behavior without notice. This is the main reason the worker is kept separate from production during experimentation.
- **Stale extended-hours fields.** Yahoo keeps `postMarketPrice`/`preMarketPrice` populated all day with frozen values from the most recent session. Use timestamps to detect which session is actually current.
- **`allTimeHigh` is undocumented.** It's not consistently present in Yahoo modules. We try `price.allTimeHigh` and `summaryDetail.allTimeHigh` and silently skip if absent.
- **Per-analyst price targets exist in `upgradeDowngradeHistory`.** Initially thought Yahoo doesn't expose these — turned out they do, in the same history records: `currentPriceTarget`, `priorPriceTarget`, `priceTargetAction` ("Raises" / "Lowers" / "Maintains"). Used in the Analysts history table.
- **ETFs have very sparse fundamental data.** Most `financialData`, `earnings`, and ownership modules are empty for ETFs. Views that depend on them will show empty states.
