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

**Market state** (`REGULAR` / `PRE` / `POST` / `CLOSED`) is determined from `currentTradingPeriod` windows vs `now` and returned in every response.

**Worker endpoints:**
- `/api/quote?ticker=AAPL` — price quote. Returns `price`, `priceType`, `marketState`, `regularMarketPrice`, `previousClose`, `priceTimestamp`, `currency`, `shortName`. Optional `&simple=1` skips extended-hours candle logic.
- `/api/history?ticker=AAPL&range=1mo` — historical OHLCV for charts. Supported ranges: `5d`, `1mo`, `3mo`, `6mo`, `1y`. Returns `{ points: [{t, o, h, l, c, v}] }`.
- `/api/profile?ticker=AAPL` — sector/industry/country from Yahoo assetProfile. Returns nulls for ETFs and when Yahoo blocks the request.
- `/api/debug?ticker=AAPL` — processed result (same logic as `/api/quote`)
- `/api/debug1?ticker=AAPL` — raw meta from Yahoo 1d request
- `/api/debug2?ticker=AAPL` — last candles + pre/post windows from 5d request

All endpoints require `X-API-Token: TOKEN` header. To call from curl:
```
curl -H "X-API-Token: YOUR_TOKEN" https://portfolio2.lpodolskiy.workers.dev/api/quote?ticker=AAPL
```

**Security:**  

The worker is protected by a secret token passed in the `X-API-Token` request header. The token is stored as a Cloudflare Secret (not Variable) under `API_TOKEN` — secrets persist across deployments. To rotate: update `API_TOKEN` in Cloudflare → Settings → Variables and Secrets → Secret, then update in the app settings.

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
  - `pt_portfolios` — all equity portfolios and positions
  - `pt_bonds_db` — bond database (bond definitions)
  - `pt_bond_portfolios` — bond portfolios and positions
  - `pt_current` — active portfolio ID
  - `pt_finnhub` — Cloudflare Worker URL
  - `pt_token` — API token for Cloudflare Worker
  - `pt_sort`, `pt_wl_sort` — sort state (regular and watchlist)
  - `pt_jbkey` — JSONBin master key
  - `pt_jbbin` — JSONBin bin ID
  - `pt_cloud_ts` — cloud sync timestamp (conflict prevention)
  - `pt_enc_key` — AES-GCM encryption password
  - `pt_close_mode` — close column mode: `prev` (Prev.Close) or `reg` (Reg.Price), default `prev`
  - `pt_current_mode` — current column mode: `cur` (Current) or `reg` (Reg.Price), default `cur`
  - `pt_chart_sel_{portfolioId}` — per-portfolio ticker selection for POSITIONS chart
  - `chart_hist_{ticker}_{range}` — historical price cache (daily TTL)
- **JSONBin.io** — cloud sync for cross-device access. Stores `{ portfolios, bondsDb, bondPortfolios }` — structural data only, no prices.

## Position Structure

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

- `currency` — position currency code from Yahoo Finance (e.g. `GBP`, `EUR`). Set on add. Used for symbol display and FX conversion in totals/weights.
- `shortName` — company/ETF name from Yahoo Finance. Displayed in MARKET and WEIGHT views.
- `sold` — marks position as sold; price frozen at sell price, excluded from Refresh.
- `previousClose`, `regularMarketPrice` — cached from worker response for Market view Δ% calculations.
- `category`, `region`, `sector` — optional classification fields for Analytics view. Set manually via ✎ edit row or via CSV import.

**qty=0** is allowed — used for watchlist candidates. P&L $ shows `—`, P&L% is calculated if entry > 0. Entry=0 is allowed only when qty=0 (pure price tracking). Excluded from WEIGHTS and Analytics totals.

## Portfolio Structure

```json
{
  "name": "OIL & GAS",
  "currencyCode": "USD",
  "watchlist": false,
  "archive": false,
  "positions": []
}
```

- `currencyCode` — ISO 4217 base currency. All position values are converted to this currency for VALUE and WEIGHTS. Validated against Yahoo Finance on creation/rename.
- `watchlist: true` — watchlist portfolio (no qty/entry fields, simple price display, excluded from Summary).
- `archive: true` — archive portfolio (all positions sold, no Refresh, excluded from main Summary).

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
  - No icon — regular session (REGULAR)
  - 🌙 — pre or post market (PRE / POST)
  - ✦ — market closed (CLOSED)
- Total: VALUE, P&L, RETURN
- **Multi-currency portfolios**: each position carries its own currency (from Yahoo Finance). ENTRY/CURRENT show position currency symbol. Totals and weights are converted to portfolio base currency via live FX rates (`EURUSD=X` etc.)
- **Summary view**: selected from the portfolio switcher (Σ SUMMARY at the bottom). Shows all non-watchlist portfolios: NAME / VALUE (in native currency) / P&L / RETURN / SHARE%. Total row always in USD with live FX conversion. Clicking a row switches to that portfolio. Refresh on Summary updates all portfolios.

- **View modes** via dropdown menu (sometimes referred to as ⋮ menu):
  - **P&L** — default view with full position details
  - **WEIGHTS** — TICKER / VALUE / WEIGHT %; sortable by any column
  - **MARKET** — TICKER / CLOSE / CURRENT / Δ%; sortable by TICKER or Δ% (3rd click resets to portfolio order); market state icon included. The CLOSE and CURRENT column headers are clickable menus (shown in green) to control what each column displays:
    - **CLOSE column**: `Prev.Close` (chartPreviousClose, default) or `Reg.Price` (regularMarketPrice)
    - **CURRENT column**: `Current` (current price including extended hours, default) or `Reg.Price` (regularMarketPrice)
    - Δ% is always computed from the selected CLOSE vs selected CURRENT values
    - Settings apply globally to all portfolios (regular, watchlist, summary) and persist across sessions
  - other view modes are described below 
- **Aggregation mode** (≡ button in the P&L table header, above the action buttons): collapses duplicate tickers into single rows for a cleaner view. Active separately for regular and archive portfolios; state persists across sessions (`pt_agg_active`, `pt_agg_archive`). The ≡ icon turns green when enabled. Weight view inherits the same mode automatically.

  Aggregation rules:
  - Active positions (qty>0, not sold): grouped by ticker, qty summed, entry price weighted-averaged
  - Sold positions: grouped by ticker separately, both entry and sell price weighted-averaged
  - qty=0 watchlist candidates: always shown individually, not aggregated

  Aggregated rows show ×N instead of action buttons (SELL, MOVE, EDIT, DELETE are hidden). Source positions are unchanged — aggregation is display-only.

- **CSV position import** (↑ Import CSV button in the Add form): bulk-import positions from a CSV file. Each ticker is validated against Yahoo Finance and receives correct currency and shortName. Supports comma and semicolon delimiters; `current` and `sold` columns are optional. Analytics fields (category/region/sector) are inherited automatically if the ticker already exists elsewhere.

  Minimal format:
  ```
  ticker,qty,entry
  NVDA,10,500.00
  MU,5,80.00
  ```
  Full format:
  ```
  ticker,qty,entry,current,sold
  NVDA,10,500.00,,
  MU,5,80.00,95.00,true
  ```

- **CSV position export** (↓ Export CSV button in the Add form): exports all non-sold positions of the current portfolio to a CSV file (`{name}_pl.csv`). Includes columns: `ticker`, `qty`, `entry`, `current`, `pnl`, `pnl_pct`, `category`, `region`, `sector`, `currency`. Useful for pasting into Excel or any spreadsheet tool.
- **Watchlist portfolio** (WATCHLIST radio button at creation): designed for tracking indices, commodities, currencies and any instruments without a held position (e.g. `^KS11`, `BZ=F`, `EURUSD=X`). Essentially a regular portfolio with qty/entry forced to 0 and some UI restrictions suited to its purpose:
  - Add form hides qty/entry fields
  - View shows CLOSE / PRICE / Δ% / market state icon / NAME — sortable by TICKER and Δ%
  - ⋮ menu shows MARKET and CHART only (P&L, WEIGHT, ANALYTICS hidden)
  - CHART mode: positions-only (no portfolio value line); ticker selection works the same as regular portfolios
  - Appears at the top of the active portfolio list, separated by a divider
  - Excluded from Summary, Summary Market, Summary Chart and Analytics
- **Position counts** in the portfolio switcher show unique active tickers only (excluding sold and qty=0). The Σ SUMMARY count shows globally unique tickers across all non-watchlist portfolios — a ticker held in multiple portfolios is counted once.
- **Move position** (⇨ button): moves any position to another active portfolio, preserving all fields including sold status. Available in both active and archive portfolios. Archive portfolios show an additional **⊟ button** for sold positions that moves them directly to a chosen archive portfolio.

## Backup / Restore (Settings panel)

- **↓ BACKUP** — downloads `portfolio-backup-YYYY-MM-DD.json` with all portfolios to Downloads folder
- **↑ RESTORE** — loads a backup JSON file, asks for confirmation before overwriting current data

Backup format:
```json
{
  "version": 1,
  "date": "2026-03-30T...",
  "portfolios": { ... }
}
```

## Data Architecture

**Cloud (JSONBin)** stores structural data — portfolios, positions, entry prices. Current prices are not actively synced to cloud — `cloudSave` is only triggered by structural changes (add/edit/delete position, portfolio changes), not by price updates.

**Prices** are always fetched live from Yahoo Finance via Cloudflare Worker. After every `cloudLoad`, `refreshAll` is triggered automatically for the current portfolio.

On portfolio switch, `refreshAll` runs automatically so prices are always fresh when you view a portfolio.

## Position Clipboard (Cut & Paste)

Deleting a position (✕) saves it to an in-memory clipboard (ticker, qty, entry, current). The ⧉ button next to the TICKER field in the Add form pastes the clipboard into the fields for editing before adding. This works as a **cut & paste** — useful for:
- Undoing an accidental deletion (paste back immediately)
- Moving a position to another portfolio (delete here, switch portfolio, paste there)

Only one position is held in the clipboard at a time. The clipboard is cleared on page reload. Status (sold) is not preserved — the pasted position is always created as a new active position.

## Selling Positions

Any position in a regular portfolio can be marked as sold via the **SELL** button (appears before ✎ and ✕):
- A prompt asks for the sell price (pre-filled with current price, editable)
- The position is marked `sold: true` with the sell price locked as `current`
- Sold positions are displayed in *italic* with reduced opacity and a ⊘ icon instead of market state
- Sold positions are excluded from Refresh — their price is frozen at the sell price
- Sold positions are included in portfolio totals and weights
- The sell price can be corrected via the edit (✎) button
- Sorting by ticker: sold positions appear first among same-ticker entries

A portfolio can be archived (⊟ button) only when **all** its positions are sold.

## Archive Portfolios

Archive portfolios store closed positions for historical tracking. Accessed via the **ARCHIVE** tab in the portfolio switcher.

**Key differences from regular portfolios:**
- No Refresh button — all positions are static (sold)
- Dropdown menu has P&L and WEIGHTS only (no MARKET view)
- All positions are created in sold status; CURRENT (sell price) is required on add
- Adding a position validates the ticker against Yahoo Finance — unknown tickers are rejected
- Archive portfolios are excluded from the main Summary and from Refresh All

**Creating an archive portfolio:** switch to the ARCHIVE tab and use the add form (no INDEX/REGULAR radio — always creates an archive portfolio).

**Archiving a regular portfolio:** click ⊟ next to the portfolio name. Only available when all positions are sold.

**Archive Summary:** Σ SUMMARY at the bottom of the ARCHIVE tab. Same calculation as main Summary — values in native currency, totals in USD with live FX conversion.

## Cloud Encryption

Cloud data can be encrypted client-side using AES-GCM 256-bit encryption via the browser's built-in Web Crypto API. Set an **ENC KEY** (encryption password) in Settings to enable.

**How it works:**
- The password is derived into a cryptographic key using PBKDF2 (100,000 iterations, SHA-256)
- A random salt (16 bytes) and IV (12 bytes) are generated on every save
- JSONBin stores `{ "encrypted": "base64..." }` instead of plaintext
- Without the correct password, the data cannot be decrypted

**Multi-device:** Enter the same ENC KEY on each device. The password never leaves the device — it is stored only in localStorage and never sent to the cloud.

**Important:** If you lose the password, cloud data cannot be recovered. Local data and backups are not affected.

If no ENC KEY is set, data is stored in plaintext (previous behavior).

## Sync & Conflict Prevention

- `cloudSave` is called only on structural changes (add/edit/delete position, portfolio changes) — never on price updates
- After every `cloudLoad` or `cloudSave`, the cloud timestamp is stored in `pt_cloud_ts`
- Before `cloudSave`, the cloud metadata is checked — if the cloud is newer than `pt_cloud_ts`, save is blocked with an error message prompting the user to sync first
- After **RESTORE**, data is immediately pushed to cloud to mark it as the authoritative version

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

## Bond Portfolios

Bond portfolios are managed via the **BONDS** tab in the portfolio switcher. They are completely separate from equity portfolios and have their own data structures, storage keys, and cloud sync.

**Limitations:** Only the hold-to-maturity strategy is supported. Selling bonds before maturity is not currently implemented.

### Bond Database

Before adding positions, bonds must be registered in the **Bond Database** (☰ BOND DATABASE button). Each bond has:
- **Name** — arbitrary label (uppercase)
- **Currency** — ISO 4217 code
- **Par Value** — face value of one bond
- **Nominal Yield** — annual coupon rate (%)
- **Coupon Frequency** — number of coupon payments per year
- **Maturity Date** — date of final repayment

Bonds can be edited (✎) or deleted (✕) from the database. The database is shared across all bond portfolios.

### Bond Portfolio

Each bond portfolio has a name and base currency. Positions are sorted by maturity date ascending.

**Position fields (entered manually):**
- Bond name (selected from database)
- Purchase date
- Qty (number of bonds)
- Clean Price (% of par value)
- Accrued Interest

**Calculated fields:**
- **Position Value** = qty × (cleanPrice/100 × parValue + accruedInterest)
- **Profit** = qty × (totalCouponIncome + parValue − dirtyPrice), where totalCouponIncome = remaining coupons × couponPrice
- **Return %** = profit / positionValue × 100
- **Annual Yield** = Return % / days held × 365

Remaining coupons are calculated by stepping back from maturity date in coupon intervals and counting payments strictly after purchase date (accrued interest already accounts for the current period).

**Matured bonds** (maturity date ≤ today) are shown in italic with reduced opacity, with a separate MATURED VALUE totals bar. Active bonds have their own ACTIVE VALUE totals bar. If only one group exists, only that total is shown.

### Storage

Bond data (`bondsDb`, `bondPortfolios`) is stored in `pt_bonds_db` and `pt_bond_portfolios` in localStorage, and is included in cloud sync alongside equity portfolios in the same JSONBin record.

## TOP MOVERS view

Available via ⋮ menu → TOP MOVERS in individual portfolios, watchlist portfolios, and Summary.

Shows positions ranked by absolute Δ% (largest moves first), using the same CLOSE/CURRENT mode as the Market view. Useful for quickly spotting the biggest movers without scrolling through the full list.

- **Individual portfolio**: deduplicates by ticker, excludes sold positions, includes qty=0
- **Summary (cross-portfolio)**: collects all positions from regular and watchlist portfolios, deduplicates by ticker globally, excludes sold and archive portfolios
- **SHOW TOP N**: configurable limit (3–50), saved in `pt_movers_limit`, persists across sessions
- **CLOSE / CURRENT** column headers are clickable menus (same as Market view)
- qty=0 positions shown in italic/dimmed style

## Chart View

Available via dropdown menu → CHART for individual portfolios and Summary.

**Controls:** 7 range buttons — **1D · 5D · 1M · 3M · 6M · 1Y · 5Y**. A dropdown button (showing current mode) selects between **PORTFOLIO** and **POSITIONS** for individual charts, and **TOTAL** and **BY PORTFOLIO** for Summary chart.

**Data:** Historical daily closes fetched via `/api/history` endpoint. For multi-currency portfolios, FX history is fetched for each non-base currency and applied per day.

**Spike prevention:** Missing trading days (holidays, exchange closures) are forward-filled per ticker. Only dates where all tickers have data are plotted.

**Caching:** Historical data is cached in localStorage per ticker+range with a daily TTL. 1D data is never cached (always fetched fresh). Stale entries are purged automatically on each new cache write. Repeated chart opens within the same day make zero network requests. The positions chart shares the same cache as the portfolio chart.

**Range notes:** 1D uses `interval=5m` (~78 intraday points), all other ranges use `interval=1d`. 1D is blocked in PORTFOLIO mode and in Summary chart (with an explanatory message) — it only works in POSITIONS mode for individual portfolios and watchlists.

**Today's point:** After loading history, a current-price point is appended if the last history entry doesn't match the latest price timestamp. This keeps the chart up to date even when Yahoo delays adding the current session to the history feed (common for European instruments). The timestamp comes from `regularMarketTime` returned by the worker.

**Force reload:** A ↻ button at the end of the chart legend clears the history cache for the current tickers and range, refreshes all position prices, then redraws the chart — one tap for a fully up-to-date view.

### Portfolio Chart — PORTFOLIO mode

Single line showing total portfolio value over time in base currency. Active positions only (sold and qty=0 excluded).

### Portfolio Chart — POSITIONS mode

Normalized % lines for individually selected tickers (deduplicated — if the same ticker appears multiple times, one line is shown). Each line starts at 0% on the first available date. Color-coded with a legend showing final % change.

**Selection:** Click ✎ Edit selection (N/M) to open a checkbox list with ALL / NONE shortcuts. Selection is saved to localStorage per portfolio and persists across sessions. Default on first open: none selected.

### Summary Chart

In Summary, the dropdown menu → CHART shows two modes toggled by TOTAL / BY PORTFOLIO buttons:

- **TOTAL** — single line showing combined value of all active portfolios in USD with FX conversion
- **BY PORTFOLIO** — one normalized line per portfolio starting at 0%, each calculated in its own base currency (no USD conversion, so FX effects don't distort relative stock performance). Color-coded with a legend showing final % change.

## Analytics View

Available via dropdown menu → ANALYTICS for individual portfolios and Summary.

Shows portfolio breakdown by **CATEGORY**, **REGION**, **SECTOR**, or **CURRENCY** — four buttons to switch between them. Currency uses the actual position currency from Yahoo Finance (no manual input needed). Each row shows group name, value (with FX conversion to base currency), weight %, and a horizontal bar chart scaled to the largest group. Positions with qty=0 are excluded. Positions without a value in the selected field appear in the **Other** group.

### Position Classification Fields

Each position has three optional fields: **category**, **region**, **sector**. Set via the ✎ edit row (expands below the position). Grouping normalizes whitespace (trims and collapses multiple spaces) but preserves original casing.

### Note Field

Each position also has a free-text **note** field. Set via the ✎ edit row. Notes are personal annotations — they don't affect any calculations or groupings and appear only in the expanded view and the edit form.

### Viewing Attributes Without Editing

Tapping/clicking the **ticker name** in the P&L view toggles an expandable sub-row showing the position's classification fields and note in read-only format:

```
CAT  AI & Semi    REG  US    SEC  Technology
NOTE  Bought on dip after earnings
```

Tap the ticker again to collapse. The expanded state resets when switching portfolios or views.

### Attribute Inheritance

When a position is added (via the Add form or CSV import in the Add form), the app automatically checks all existing portfolios (active, archive, and watchlist) for a position with the same ticker. If found and it has category/region/sector values, those are copied to the new position. This means you only need to classify a ticker once — subsequent additions inherit the values automatically.

### CSV Import / Export

In Analytics view (portfolio level), three links appear: **↑ Import CSV**, **↓ Export CSV**, and **↓ Incomplete**.

**Export CSV** downloads `tickers.csv` — all unique tickers across all portfolios with their current category/region/sector values.

**Incomplete** downloads `incomplete_analytics.csv` — all unique tickers across all regular and archive portfolios (watchlist excluded) where at least one of category/region/sector is empty. Useful for identifying what still needs to be classified. Includes all positions regardless of sold/qty status.

**Import** reads a CSV and updates matching positions across all portfolios. Supports comma (`,`) or semicolon (`;`) delimiter, auto-detected from the header row. Empty fields in the CSV do not overwrite existing values.

CSV format:
```
ticker,category,region,sector
NVDA,AI & Semi,US,Technology
ASML.AS,AI & Semi,Europe,Technology
CVX,Energy,US,Energy
GLD,Commodities,Global,Commodities
SPY,Broad Market,US,Diversified
```

Tickers may appear multiple times across portfolios — all matching positions are updated.
