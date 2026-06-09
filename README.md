# Portfolio Terminal 2

A PWA stock portfolio tracker with a Cloudflare Worker backend. Supports all major exchanges, extended hours (pre/post market), and cross-device sync via cloud storage.

## Overview

| | |
|---|---|
| **Frontend** | GitHub Pages — `lpodo.github.io/portfolio2` |
| **Price backend** | Cloudflare Workers — `portfolio2.lpodolskiy.workers.dev` |
| **Repository** | `lpodo/portfolio2` |
| **App** | PWA — installable on Android/iOS as a home screen app |

## Table of Contents

- [Features](#features)
  - [Portfolios](#portfolios)
  - [Positions](#positions)
  - [Prices & P&L](#prices--pl)
  - [View Modes](#view-modes)
  - [Summary (Cross-Portfolio)](#summary-cross-portfolio)
  - [Price Alerts](#price-alerts)
  - [Charts](#charts)
  - [Fundamentals](#fundamentals)
  - [Analytics](#analytics)
  - [Expanded Row](#expanded-row)
  - [Bonds & Deposits](#bonds--deposits)
  - [CSV Position Import / Export](#csv-position-import--export)
  - [Backup & Restore](#backup--restore)
  - [Cloud Sync](#cloud-sync)
  - [Exchange Support](#exchange-support)
- [Technical Implementation](#technical-implementation)
  - [Architecture & Stack](#architecture--stack)
  - [Cloudflare Worker](#cloudflare-worker)
  - [Data Model](#data-model)
  - [Local Storage](#local-storage)
  - [Cloud Storage](#cloud-storage)
  - [Service Worker](#service-worker)
  - [Chart Data Pipeline](#chart-data-pipeline)
  - [Fundamentals Caching](#fundamentals-caching)

---

# Features

## Portfolios

### Managing portfolios

- Multiple portfolios — tap the name in the header to switch, add, rename, or delete.
- Currency symbol per portfolio — set at creation, editable via rename.
- **Position counts** in the portfolio switcher show unique active tickers only (excluding sold and qty=0). The Σ SUMMARY count shows globally unique tickers across all non-watchlist portfolios — a ticker held in multiple portfolios is counted once.

### Multi-currency portfolios

Each position carries its own currency (from Yahoo Finance). ENTRY/CURRENT show the position currency symbol. Totals and weights are converted to the portfolio base currency via live FX rates (`EURUSD=X` etc.).

### Watchlist portfolios

Selected via the **WATCHLIST** radio button at creation. Designed for tracking indices, commodities, currencies, and any instruments without a held position (e.g. `^KS11`, `BZ=F`, `EURUSD=X`). Essentially a regular portfolio with qty/entry forced to 0 and some UI restrictions suited to its purpose:

- Add form hides qty/entry fields.
- View shows CLOSE / PRICE / Δ% / market state icon / NAME — sortable by TICKER and Δ%.
- ⋮ menu shows MARKET, ALERTS, CHART, and FUNDAMENTALS only (P&L, WEIGHTS, ANALYTICS hidden).
- CHART mode: positions-only (no portfolio value line); ticker selection works the same as regular portfolios.
- Appears at the top of the active portfolio list, separated by a divider.
- Excluded from Summary, Summary Market, Summary Chart, and Analytics.

### Archive portfolios

Archive portfolios store closed positions for historical tracking. Accessed via the **ARCHIVE** tab in the portfolio switcher.

**Key differences from regular portfolios:**

- No Refresh button — all positions are static (sold).
- Dropdown menu has P&L and WEIGHTS only (no MARKET view).
- All positions are created in sold status; CURRENT (sell price) is required on add.
- Archive portfolios are excluded from the main Summary and from Refresh All.

**Creating an archive portfolio:** switch to the ARCHIVE tab and use the add form (no INDEX/REGULAR radio — always creates an archive portfolio).

**Archiving a regular portfolio:** click ⊟ next to the portfolio name. Only available when **all** positions are sold.

**Archive Summary:** Σ SUMMARY at the bottom of the ARCHIVE tab. Same calculation as the main Summary — values in native currency, totals in USD with live FX conversion.

## Positions

### Adding, editing, deleting

- Add position: ticker + qty (0 allowed) + entry price + current price (optional).
- Adding a position validates the ticker against Yahoo Finance — unknown tickers are rejected.
- Inline edit (✎) and delete (✕).

**qty=0** is allowed — used for watchlist candidates. P&L $ shows `—`, P&L % is calculated if entry > 0. Entry=0 is allowed only when qty=0 (pure price tracking). Excluded from WEIGHTS and Analytics totals.

### Position Clipboard (Cut & Paste)

Deleting a position (✕) saves it to an in-memory clipboard (ticker, qty, entry, current). The ⧉ button next to the TICKER field in the Add form pastes the clipboard into the fields for editing before adding. This works as a **cut & paste** — useful for:

- Undoing an accidental deletion (paste back immediately).
- Moving a position to another portfolio (delete here, switch portfolio, paste there).

### Selling positions

Any position in a regular portfolio can be marked as sold via the **SELL** button (appears before ✎ and ✕):

- A modal dialog asks for the quantity to sell (default: full position) and sell price (pre-filled with current price).
- **Partial sell**: if quantity < position qty, the position is split into two records — the sold portion (marked `sold` with sell price) and the remainder (active, original entry price).
- The position is marked `sold` with the sell price locked as `current`.
- Sold positions are displayed in *italic* with reduced opacity and a ⊘ icon instead of market state.
- Sold positions are excluded from Refresh — their price is frozen at the sell price.
- Sold positions are included in portfolio totals and weights.
- The sell price can be corrected via the edit (✎) button.
- Sorting by ticker: sold positions appear first among same-ticker entries.

A portfolio can be archived (⊟ button) only when **all** its positions are sold.

### Moving positions

The ⇨ button moves any position to another active portfolio, preserving all fields including sold status. Available in both active and archive portfolios. Sold positions have an additional **⊟ button** that moves them directly to a chosen archive portfolio — available for sold positions in both active and archive portfolios.

## Prices & P&L

- Price update: ↻ per row or Refresh All (parallel).
- Sort by any column — persists across sessions.
- **P&L $** for full position: `(current - entry) × qty`
- **P&L %** per share: `(current - entry) / entry × 100`
- **Totals**: VALUE, P&L, RETURN.

**Market state indicator** (shown after P&L %):

- No icon — regular session (REGULAR)
- 🌙 — pre or post market (PRE / POST)
- ✦ — market closed (CLOSED)

Market state icons can be changed via Settings.

## View Modes

Selected via the dropdown menu (sometimes referred to as the ⋮ menu).

### P&L

Default view with full position details.

### MARKET

Columns TICKER / CLOSE / CURRENT / Δ%; sortable by TICKER or Δ%. The Δ% column header cycles through three sort modes: Δ%↓ → Δ%↑ → |Δ%|↓ (absolute, biggest movers first) → reset. Market state icon included. The CLOSE and CURRENT column headers are clickable menus (shown in green) to control what each column displays:

- **CLOSE column**: `Prev.Close` (previousClose, default), `Reg.Price` (regularMarketPrice), or a historical period — **5D**, **1M**, **3M**, **6M**, **1Y**, **5Y**. Historical data is fetched from `/api/history` (shared with the Chart view cache) and loaded asynchronously on first use; subsequent opens use the daily cache. When a period is selected, Δ% shows performance over that period.
- **CURRENT column**: `Current` (current price including extended hours, default) or `Reg.Price` (regularMarketPrice).
- Δ% is always computed from the selected CLOSE vs the selected CURRENT values.
- Settings apply globally to all portfolios (regular, watchlist, summary) and persist across sessions.

### WEIGHTS

Columns TICKER / VALUE / WEIGHT %; sortable by any column.

### Aggregation mode

The ≡ button in the P&L table header (above the action buttons) collapses duplicate tickers into single rows for a cleaner view. Active separately for regular and archive portfolios; state persists across sessions. The ≡ icon turns green when enabled. The Weight view inherits the same mode automatically.

Aggregation rules:

- Active positions (qty>0, not sold): grouped by ticker, qty summed, entry price weighted-averaged.
- Sold positions: grouped by ticker separately, both entry and sell price weighted-averaged.
- qty=0 watchlist candidates: always shown individually, not aggregated.

Aggregated rows show ×N instead of action buttons (SELL, MOVE, EDIT, DELETE are hidden). Source positions are unchanged — aggregation is display-only.

## Summary (Cross-Portfolio)

Selected from the portfolio switcher (Σ SUMMARY at the bottom). Shows all non-watchlist portfolios: NAME / VALUE (in native currency) / P&L / RETURN / SHARE%. The total row is always in USD with live FX conversion. Clicking a portfolio name switches to it. Refresh on Summary updates all portfolios.

In Summary, the ⋮ dropdown menu shows Summary-specific views (marked with the Σ prefix):

- **Σ MARKET** — cross-portfolio market view. Collects all non-sold positions from all non-archive portfolios, deduplicates by ticker, and shows them in a single table. Same CLOSE/CURRENT menus and Δ% sort cycle as the regular MARKET view (including historical period comparison).
- **Σ WEIGHTS** — cross-portfolio weights view. Aggregates all active positions from all non-archive portfolios by ticker. Columns: TICKER / VALUE (native currency, dimmed) / VALUE (\$) (USD-converted) / WEIGHT % / NAME. All non-USD values converted using live FX rates. Sortable by TICKER, VALUE (\$), or WEIGHT.
- **Σ ALERTS** — alerts across all portfolios (see [Price Alerts](#price-alerts)).
- **Σ ANALYTICS** — analytics across all portfolios (see [Analytics](#analytics)).

## Price Alerts

Each position can have one or more price alerts. Alerts are checked on every price refresh and shown across all market-style views.

### Setting alerts

**From the ✎ edit form** — under the ALERTS section at the bottom of the form:

- Click the `>` / `<` toggle button to select the condition (tap to switch in place).
- Enter a price value.
- Click **+ ADD**.

**From the expanded row** (faster, without opening the edit form) — tap a ticker to expand, then use the inline ALERTS row:

- Click the `>` / `<` toggle to select the condition.
- Enter a price value.
- Click `+`.

### Triggering

On every price refresh, each alert is re-evaluated:

- `>` — triggers when `current price > alert value`
- `<` — triggers when `current price < alert value`

### Indicators

A colored dot `●` appears after the ticker name when any alert on that position is triggered. The color depends on the direction of the triggered alert:

- Yellow `●` — at least one `>` alert is triggered (price crossed above target).
- Sky-blue `●` — at least one `<` alert is triggered (price crossed below target).
- Both dots appear (sky-blue first, then yellow) when alerts of both directions are triggered.

Each color is shown at most once per ticker, regardless of how many alerts in that direction have triggered. The dots are visible in all views that show tickers: P&L, MARKET, WEIGHTS, Σ MARKET, Σ WEIGHTS, ALERTS.

### ALERTS view

Available via ⋮ menu → **ALERTS** for individual portfolios, watchlists, and Summary. Not available for Archive portfolios.

Shows all positions that have at least one alert set (sold positions excluded), sorted by Δ% descending (biggest gainers first, biggest losers last). Same columns as the MARKET view. Tap a ticker to expand.

- **Individual portfolio**: shows positions from the current portfolio only.
- **Summary (Σ ALERTS)**: collects all positions with alerts from regular and watchlist portfolios, deduplicated by ticker.
- Empty state: displays "NO ALERTS SET".

This view is useful as a single dashboard of everything being watched — you see current prices and conditions without visiting each portfolio individually.

## Charts

Available via dropdown menu → CHART for individual portfolios and Summary.

**Controls:** 7 range buttons — **1D · 5D · 1M · 3M · 6M · 1Y · 5Y**. A dropdown button (showing the current mode) selects between **PORTFOLIO** and **POSITIONS** for individual charts, and **TOTAL** and **BY PORTFOLIO** for the Summary chart.

**Range notes:** 1D is blocked in PORTFOLIO mode and in the Summary chart (with an explanatory message) — it only works in POSITIONS mode for individual portfolios and watchlists.

**Force reload:** A ↻ button at the end of the chart legend clears the history cache for the current tickers and range, refreshes all position prices, then redraws the chart — one tap for a fully up-to-date view.

### Portfolio Chart — PORTFOLIO mode

Single line showing total portfolio value over time in base currency. Active positions only (sold and qty=0 excluded).

### Portfolio Chart — POSITIONS mode

Normalized % lines for individually selected tickers (deduplicated — if the same ticker appears multiple times, one line is shown). Each line starts at 0% on the first available date. Color-coded with a legend showing the final % change.

**Selection:** Click ✎ Edit selection (N/M) to open a checkbox list with ALL / NONE shortcuts. Selection is saved to localStorage per portfolio and persists across sessions. Default on first open: none selected.

### Summary Chart

In Summary, the dropdown menu → CHART shows two modes selectable via a green dropdown button:

- **TOTAL** — single line showing the combined value of all active portfolios in USD with FX conversion.
- **BY PORTFOLIO** — one normalized line per portfolio starting at 0%, each calculated in its own base currency (no USD conversion, so FX effects don't distort relative stock performance). Color-coded with a legend showing the final % change.

## Fundamentals

Available via dropdown menu → FUNDAMENTALS for individual portfolios and watchlists. Not available for Archive portfolios.

A comparative table across selected tickers with four subviews switchable via tabs:

- **Targets** — current price, analyst price targets (mean and rolling average over a 30d/100d window) with upside %, and P/E. The current-price column and the target window are switchable via dropdowns in the column headers.
- **Ratings** — analyst recommendation breakdown (strong buy / buy / hold / sell / strong sell).
- **Earnings** — quarter-over-quarter growth of revenue and net income over the last 3 quarters, sign-colored.
- **EPS** — actual EPS per quarter.

On entering the view, state is always reset to defaults: **Targets** tab, **Current** price, **30d** window.

### Position selection

Click **Edit selection** in the upper right corner to open a checkbox list of all tickers in the portfolio, with **ALL** / **NONE** shortcuts for bulk toggling and **APPLY** to confirm. Default on first open: empty — the view shows the placeholder `SELECT POSITIONS TO COMPARE`.

Selection is saved to localStorage per portfolio (`pt_fund_sel_{portfolioId}`) and persists across reloads. Tickers removed from the portfolio drop out of the selection automatically.

### Expanded row

Tap a ticker in any of the four tabs to toggle a compact "lite" sub-row beneath it. Four lines:

1. **CAT / REG / SEC** — classification fields (show `—` if empty).
2. **NOTE** — free-text annotation.
3. **ALERTS** — existing alerts with ✕ delete buttons, plus the same inline quick-add controls as in the main Expanded Row.
4. The `[›]` button — opens the full **More** overlay (the same overlay reached from the main [Expanded Row](#expanded-row)).

Unlike the main Expanded Row, the lite version doesn't repeat the analyst votes / Avg tgt / P/E lines — that data is already visible in the comparative table above, so it would be redundant.

### Rendering behavior

When valid cached data exists for the selected tickers, tables render instantly. For any ticker without cache, the corresponding row shows `…` and a single fetch to the worker is triggered asynchronously; the view repaints itself when data arrives. Requests are deduplicated — two parallel fetches for the same ticker cannot start. ETFs and other instruments without earnings/targets are cached as `null`, so they aren't refetched on every open.

## Analytics

Available via dropdown menu → ANALYTICS for individual portfolios and Summary.

Shows the portfolio breakdown by **CATEGORY**, **REGION**, **SECTOR**, or **CURRENCY** — four buttons to switch between them. Currency uses the actual position currency from Yahoo Finance (no manual input needed). Each row shows the group name, value (with FX conversion to base currency), weight %, and a horizontal bar chart scaled to the largest group. Positions with qty=0 are excluded. Positions without a value in the selected field appear in the **Other** group.

### Position classification fields

Each position has three classification fields: **category**, **region**, **sector**. Values must be chosen from per-field dictionaries — free text is not allowed. This ensures exact consistency across portfolios, which is required for Analytics to group correctly.

**Setting values:** open the ✎ edit form for any position. Each field shows a custom dropdown — tap/click to open a list of all values in that dictionary. Select a value, or choose **+ new...** to add a new value inline: a text input appears with ✓ (confirm) and ✕ (cancel) buttons. Confirming adds the value to the dictionary and selects it.

**Dictionaries** (Settings → DICTIONARIES): three buttons — CATEGORIES, REGIONS, SECTORS. Tap a button to expand the list of values for that dictionary. Each value has a ✕ button to delete it from the dictionary. Deleting a value from the dictionary does not remove it from existing positions.

**On first run after upgrade:** existing category/region/sector values found in positions are automatically migrated into the dictionaries. No manual action required.

Dictionaries are included in cloud sync and backup/restore. Grouping in Analytics normalizes whitespace (trims and collapses multiple spaces) but preserves original casing.

### Attribute inheritance & sync

When a position is added (via the Add form or CSV import), the app automatically checks all existing portfolios (active, archive, and watchlist) for a position with the same ticker. If found and it has category/region/sector values, those are copied to the new position. This means you only need to classify a ticker once — subsequent additions inherit the values automatically.

**Ticker-wide sync:** when attributes are edited via the ✎ edit form, the new values are immediately synced to all other positions with the same ticker across all portfolios (including archive). There is no prompt and no separate step — sync is silent, enforcing the rule that a ticker always has exactly one set of attributes everywhere.

### Note field

Each position also has a free-text **note** field, set via the ✎ edit row. Notes are personal annotations — they don't affect any calculations or groupings and appear only in the expanded view and the edit form.

### CSV import / export (Analytics)

In the Analytics view (portfolio level), three links appear: **↑ Import CSV**, **↓ Export CSV**, and **↓ Incomplete**.

- **Export CSV** downloads `tickers.csv` — all unique tickers across all portfolios with their current category/region/sector values.
- **Incomplete** downloads `incomplete_analytics.csv` — all unique tickers across all regular and archive portfolios (watchlist excluded) where at least one of category/region/sector is empty. Useful for identifying what still needs to be classified. Includes all positions regardless of sold/qty status.
- **Import** reads a CSV and updates matching positions across all portfolios. Supports comma (`,`) or semicolon (`;`) delimiter, auto-detected from the header row. Empty fields in the CSV do not overwrite existing values. All imported category/region/sector values are automatically added to their respective dictionaries.

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

## Expanded Row

Tapping/clicking the **ticker name** in any market-style view toggles an expandable sub-row. Available in: **P&L**, **MARKET**, **Σ MARKET**, **ALERTS**, and **watchlist** views. Tap the ticker again to collapse. The expanded state resets when switching portfolios.

### Position metadata

The first three lines always show position metadata:

```
  CAT  AI & Semi    REG  US    SEC  Technology
NOTE  Bought on dip after earnings  ✎
ALERTS  > 920  ✕    [>] [price] [+]
```

- **CAT / REG / SEC** — classification fields (show `—` if empty).
- **NOTE** — free-text annotation. Click the ✎ button to edit inline: the value becomes an input field; press **Enter** or click away to save, **Escape** to cancel.
- **ALERTS** — existing alerts with ✕ delete buttons, plus inline quick-add controls.

### Yahoo fundamentals & "More" overlay

If the ticker has Yahoo Finance fundamental data, three more lines appear:

```
  strongBuy 4  buy 11  hold 5  sell 0  strongSell 0
Avg tgt  1,417.25 (+10.67%)   30d tgt  1,395.00 (+8.97%)
P/E  18.37   fw P/E  29.26                                  [›]
```

- **Analyst vote breakdown** (line 1) sourced from `recommendationTrend`.
- **Avg tgt** is the current mean analyst price target with upside %; **30d tgt** / **100d tgt** is the rolling average over the corresponding window. The app prefers 30d, falls back to 100d if there are no entries in the last 30 days, or omits the line if there are no entries in the last 100 days.
- **Trailing P/E** is computed client-side as `currentPrice / trailingEps`; **forward P/E** is read directly from Yahoo.
- The blue `[›]` button opens **More** — a full-screen overlay with additional information from Yahoo Finance (Market, Key Stats, Earnings, Analysts and Sentiment).

### Behavior in aggregation mode

Expanded rows are enabled for aggregated entries, with the following behavior on the first three lines:

- **Attributes (CAT / REG / SEC):** the app enforces identical attributes across all instances of the same ticker, so the values are read from any one position in the aggregated group (the first one).
- **Notes:** non-empty notes from all positions in the group are joined into a single read-only block. Editing is not available in aggregation mode — switch to a non-aggregated view to edit individual notes.
- **Alerts:** alerts from all positions in the group are merged into a single list. Delete and add controls work as in normal mode; a newly added alert is attached to one position in the group (the first one) — but since all positions of the same ticker resolve to the same price, it doesn't matter which one carries the alert.

The dot indicators (yellow / sky-blue) appear if any position in the aggregated group has a triggered alert of the corresponding direction, following the same rules as for individual positions. The Yahoo fundamentals lines and the **More** button appear in aggregated rows just as in regular ones.

## Bonds & Deposits

Bond and deposit portfolios are managed via the **BONDS** tab in the portfolio switcher. They are completely separate from equity portfolios and have their own data structures, storage keys, and cloud sync.

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

**Limitations:** Only the hold-to-maturity strategy is supported. Selling bonds before maturity is not currently implemented.

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

Remaining coupons are calculated by stepping back from the maturity date in coupon intervals and counting payments strictly after the purchase date (accrued interest already accounts for the current period).

**Matured bonds** (maturity date ≤ today) are shown in italic with reduced opacity, with a separate MATURED VALUE totals bar. Active bonds have their own ACTIVE VALUE totals bar. If only one group exists, only that total is shown.

### Deposit Portfolios

Deposit portfolios live in the same **BONDS** tab as bond portfolios. When creating a portfolio, a **Bond / Deposit** radio button selects the type. Deposit portfolios appear below bond portfolios in the switcher, separated by a divider. They share the same storage keys (`pt_bond_portfolios`) and cloud sync as bond portfolios. No Bond Database entry is required — all data is entered directly per position.

**Position fields:**

- **Name** — arbitrary label (e.g. `BANK 12M`)
- **Open Date** — date the deposit was opened
- **Term** — duration in months
- **Rate %** — nominal annual interest rate
- **Amount** — principal deposited (inherits portfolio currency)
- **Type** — one of three payout modes (see below)
- **Freq/yr** — coupon/payout frequency per year (shown only for Regular Payouts and Compounded)

**Deposit types and calculations:**

*At Maturity* — interest is paid in full at the end of the term:

```
profit = amount × (rate / 100) × (termMonths / 12)
annYield = rate
```

*Regular Payouts* — interest is paid periodically; principal returned at maturity. Same profit formula as At Maturity; `freqPerYear` records how often payouts occur (for reference only — does not change the total):

```
profit = amount × (rate / 100) × (termMonths / 12)
annYield = rate
```

*Compounded* — interest is reinvested at each period; effective annual yield exceeds nominal rate:

```
profit = amount × ((1 + rate/100 / freq) ^ (freq × termYears) − 1)
annYield = ((1 + rate/100 / freq) ^ freq − 1) × 100
```

**Maturity date** = `openDate + termMonths`. A deposit is considered matured when `maturityDate ≤ today`.

**Table view** — columns: **NAME · OPEN DATE · TERM · RATE · AMOUNT · PROFIT · RETURN · ANN.YIELD**. Click any row to open a detail modal showing all fields plus the calculated maturity date, profit, return, and status (Active / Matured). Edit (✎) and delete (✕) buttons appear on each row. **Editing** opens an inline form beneath the row (same style as bond position editing) with all fields including the Type radio buttons and conditional Freq/yr field. **Matured deposits** are shown in italic with reduced opacity, grouped in a separate MATURED VALUE totals bar; active deposits have their own ACTIVE VALUE totals bar.

### Bond & Deposit Σ SUMMARY

Deposit portfolios appear in the bond **Σ SUMMARY** view alongside bond portfolios. Each deposit portfolio contributes one row (or two rows if it contains both active and matured deposits). Reported columns are identical to bonds: **VALUE · PROFIT · RETURN · WEIGHT**. Non-USD portfolios are converted using the same FX rate lookup as bonds.

## CSV Position Import / Export

### Import

The **↑ Import CSV** button in the Add form bulk-imports positions from a CSV file. Each ticker is validated against Yahoo Finance and receives the correct currency and shortName. Supports comma and semicolon delimiters; `current` and `sold` columns are optional. Analytics fields (category/region/sector) are inherited automatically if the ticker already exists elsewhere.

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

### Export

The **↓ Export CSV** button in the Add form exports all non-sold positions of the current portfolio to a CSV file (`{name}_pl.csv`). Includes columns: `ticker`, `qty`, `entry`, `current`, `pnl`, `pnl_pct`, `category`, `region`, `sector`, `currency`. Useful for pasting into Excel or any spreadsheet tool.

## Backup & Restore

From the Settings panel:

- **↓ BACKUP** — downloads `portfolio-backup-YYYY-MM-DD.json` with all portfolios to the Downloads folder.
- **↑ RESTORE** — loads a backup JSON file, asks for confirmation before overwriting current data. After RESTORE, data is immediately pushed to cloud to mark it as the authoritative version.

Backup format:

```json
{
  "version": 1,
  "date": "2026-03-30T...",
  "portfolios": { ... },
  "catDict": ["AI & Semi", "Energy", ...],
  "regDict": ["Europe", "US", ...],
  "secDict": ["Energy", "Technology", ...]
}
```

## Cloud Sync

Two cloud storage backends are supported. Select in Settings under **CLOUD STORAGE**.

### Backends

**JSONBin**

- Requires a **Master Key** (from jsonbin.io → API Keys) and a **Bin ID** (auto-created on first save, or pasted from another device).
- Direct browser-to-JSONBin requests.

**Cloudflare KV**

- Requires only a **KV Key** — any unique string you choose (e.g. `lpodo`). Data is stored under this key in the KV namespace bound to your Worker.
- Requests are routed through your Cloudflare Worker (no external API keys needed).
- More reliable — no dependency on third-party availability.

**Switching backends:** select the new backend in Settings, enter its credentials, then tap **↑ OVERWRITE CLOUD** to push your local data. Both backends are independent and can coexist.

### Operations

Common to both backends:

- **↓ SYNC FROM CLOUD** — pull the latest data from cloud to the current device.
- **↑ OVERWRITE CLOUD** — push local data to cloud (destructive).
- Auto-save to cloud on every structural change (add/edit/delete position).
- Auto-load from cloud on app open with a status overlay (disappears automatically on success, stays on error).

### Encryption

Optional AES-GCM 256-bit client-side encryption via the **ENC KEY** field in Settings. Applied before sending to either backend — the cloud stores only an encrypted blob. To enable, set an ENC KEY (encryption password) in Settings.

**Multi-device:** enter the same ENC KEY on each device. The password never leaves the device — it is stored only in localStorage and never sent to the cloud.

**Important:** if you lose the password, cloud data cannot be recovered. Local data and backups are not affected. If no ENC KEY is set, data is stored in plaintext.

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

---

# Technical Implementation

## Architecture & Stack

- Pure HTML/JS/CSS — no frameworks or build tools.
- **Cloudflare Worker** (`worker.js`) — serverless proxy to Yahoo Finance, bypasses CORS.
- PWA files: `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png`, `icon-32.png`, `icon-16.png`.
- No npm, webpack, or React — maximum portability.

## Cloudflare Worker

Price source: Yahoo Finance via Cloudflare Worker — free, all major exchanges, extended hours.

### Price algorithm

1. Fast request `interval=1d` → get `regularMarketPrice`, `regularMarketTime`, `currentTradingPeriod`.
2. If `now >= regular.start && now < regular.end && regularMarketTime >= regular.start` → return `regularMarketPrice`, `priceType: "regular"` (one request).
3. Otherwise → second request `interval=1m&range=5d&includePrePost=true` → find the last non-null candle.
4. If `lastCandle.price ≈ regularMarketPrice` → `priceType: "regular"`.
5. Otherwise → `priceType: "extended"`.

### Market state detection

Market state (`REGULAR` / `PRE` / `POST` / `CLOSED`) is determined from `currentTradingPeriod` windows vs `now` and returned in every response.

### Endpoints

- `/api/quote?ticker=AAPL` — price quote. Returns `price`, `priceType`, `marketState`, `regularMarketPrice`, `previousClose`, `priceTimestamp`, `currency`, `shortName`. Optional `&simple=1` skips extended-hours candle logic.
- `/api/history?ticker=AAPL&range=1mo` — historical OHLCV for charts. Supported ranges: `1d`, `5d`, `1mo`, `3mo`, `6mo`, `1y`, `5y`. Returns `{ points: [{t, o, h, l, c, v}] }`.
- `/api/kv` — cloud storage proxy (GET to load, PUT to save). Requires the `X-KV-Key` header with the user's storage key. Only available when the Cloudflare KV backend is configured.
- `/api/profile?ticker=AAPL` — sector/industry/country from Yahoo `assetProfile`. Returns nulls for ETFs and when Yahoo blocks the request.
- `/api/quotesummary?ticker=AAPL&modules=financialData,defaultKeyStatistics,recommendationTrend,upgradeDowngradeHistory` — Yahoo Finance fundamentals via the `quoteSummary` API. Returns raw module data under `quoteSummary.result[0]`. Requires a Yahoo crumb token for auth; the worker fetches and caches the crumb in-memory automatically. If Yahoo returns 404 for a multi-module request (some ETFs lack certain modules), the worker falls back to per-module fetches and merges what succeeds. Used by the **Expanded Row** fundamentals lines and the **More** overlay.
- `/api/debug?ticker=AAPL` — processed result (same logic as `/api/quote`).
- `/api/debug1?ticker=AAPL` — raw meta from the Yahoo 1d request.
- `/api/debug2?ticker=AAPL` — last candles + pre/post windows from the 5d request.

All endpoints require the `X-API-Token: TOKEN` header. To call from curl:

```
curl -H "X-API-Token: YOUR_TOKEN" https://portfolio2.lpodolskiy.workers.dev/api/quote?ticker=AAPL
```

### Authentication & security

The worker is protected by a secret token passed in the `X-API-Token` request header. The token is stored as a Cloudflare Secret (not Variable) under `API_TOKEN` — secrets persist across deployments. To rotate: update `API_TOKEN` in Cloudflare → Settings → Variables and Secrets → Secret, then update it in the app settings.

## Data Model

### Position structure

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
- `previousClose`, `regularMarketPrice` — cached from the worker response for Market view Δ% calculations.
- `category`, `region`, `sector` — classification fields for the Analytics view. Selected from per-field dictionaries; free text is not allowed.
- `note` — optional free-text annotation. Visible only in the expanded position row and edit form.
- `priceTimestamp` — Unix timestamp of last price from `regularMarketTime`; used to align the "today's point" in charts.
- `alerts` — array of price alert objects: `[{ condition: ">" | "<", value: 134.5, triggered: true|false }]`. Checked on every price refresh. The `triggered` flag is runtime-only and is not persisted to storage; the array itself is included in cloud sync.

`qty=0` is allowed — used for watchlist candidates. P&L $ shows `—`, P&L % is calculated if entry > 0. Entry=0 is allowed only when qty=0 (pure price tracking). Excluded from WEIGHTS and Analytics totals.

### Portfolio structure

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
- `archive: true` — archive portfolio (all positions sold, no Refresh, excluded from the main Summary).

## Local Storage

Primary on-device storage:

- `pt_portfolios` — all equity portfolios and positions
- `pt_bonds_db` — bond database (bond definitions)
- `pt_bond_portfolios` — bond portfolios and positions (also used by deposit portfolios)
- `pt_current` — active portfolio ID
- `pt_finnhub` — Cloudflare Worker URL
- `pt_token` — API token for Cloudflare Worker
- `pt_sort` — P&L sort state for active portfolios
- `pt_sort_arc` — P&L sort state for archive portfolios
- `pt_wl_sort` — sort state for watchlist market view
- `pt_cat_dict` — CATEGORY dictionary (sorted array of values)
- `pt_reg_dict` — REGION dictionary
- `pt_sec_dict` — SECTOR dictionary
- `pt_agg_active`, `pt_agg_archive` — aggregation mode state
- `pt_cloud_backend` — cloud storage backend: `jsonbin` (default) or `kv`
- `pt_jbkey` — JSONBin master key
- `pt_jbbin` — JSONBin bin ID
- `pt_kv_key` — Cloudflare KV user key
- `pt_cloud_ts` — cloud sync timestamp (conflict prevention)
- `pt_enc_key` — AES-GCM encryption password
- `pt_close_mode` — close column mode: `prev` (Prev.Close), `reg` (Reg.Price), or a historical period (`5d`, `1mo`, `3mo`, `6mo`, `1y`, `5y`); default `prev`
- `pt_current_mode` — current column mode: `cur` (Current) or `reg` (Reg.Price); default `cur`
- `pt_chart_sel_{portfolioId}` — per-portfolio ticker selection for the POSITIONS chart
- `pt_fund_sel_{portfolioId}` — per-portfolio ticker selection for the Fundamentals view
- `chart_hist_{ticker}_{range}` — historical price cache (daily TTL)
- `yfund_{ticker}` — fundamentals cache for Targets and Ratings (4-hour TTL)
- `yearn_{ticker}` — earnings cache for Earnings and EPS (12-hour TTL)

## Cloud Storage

Cross-device sync via two supported backends (selected in Settings):

- **JSONBin.io** — direct browser-to-API requests; requires a Master Key and Bin ID.
- **Cloudflare KV** — routed through the Worker; requires only a user-defined KV Key. More reliable and no extra API keys needed.

Bond and deposit data (`bondsDb`, `bondPortfolios`, stored in `pt_bonds_db` and `pt_bond_portfolios`) is included in cloud sync alongside equity portfolios, in the same cloud storage record, regardless of backend.

### Structural data vs live prices

- **Cloud storage** (JSONBin or Cloudflare KV) stores structural data — portfolios, positions, entry prices. Current prices are not actively synced to cloud — `cloudSave` is only triggered by structural changes (add/edit/delete position, portfolio changes), not by price updates.
- **Prices** are always fetched live from Yahoo Finance via the Cloudflare Worker. After every `cloudLoad`, `refreshAll` is triggered automatically for the current portfolio.
- On portfolio switch, `refreshAll` runs automatically so prices are always fresh when you view a portfolio.

### Sync & conflict prevention

- `cloudSave` is called only on structural changes (add/edit/delete position, portfolio changes) — never on price updates.
- After every `cloudLoad` or `cloudSave`, the cloud timestamp is stored in `pt_cloud_ts`.
- Before `cloudSave`, the cloud metadata is checked — if the cloud is newer than `pt_cloud_ts`, save is blocked with an error message prompting the user to sync first.
- After **RESTORE**, data is immediately pushed to cloud to mark it as the authoritative version.

### Encryption internals

Cloud data can be encrypted client-side using AES-GCM 256-bit encryption via the browser's built-in Web Crypto API.

- The password is derived into a cryptographic key using PBKDF2 (100,000 iterations, SHA-256).
- A random salt (16 bytes) and IV (12 bytes) are generated on every save.
- JSONBin stores `{ "encrypted": "base64..." }` instead of plaintext.
- Without the correct password, the data cannot be decrypted.
- The password is stored only in localStorage and never sent to the cloud. If lost, cloud data cannot be recovered (local data and backups are unaffected). If no ENC KEY is set, data is stored in plaintext.

## Service Worker

Caches the app shell for offline use. API requests are **never cached**:

- `workers.dev` — Cloudflare Worker (prices and KV proxy)
- `jsonbin.io` — cloud storage (JSONBin backend only)
- `finnhub.io` — legacy

**IMPORTANT: increment the cache version string in `sw.js` on every deploy** (e.g. `portfolio-v35` → `portfolio-v36`).

## Chart Data Pipeline

- **Data:** historical daily closes fetched via the `/api/history` endpoint. For multi-currency portfolios, FX history is fetched for each non-base currency and applied per day.
- **Range intervals:** 1D uses `interval=5m` (~78 intraday points); all other ranges use `interval=1d`. 1D is blocked in PORTFOLIO mode and in the Summary chart — it only works in POSITIONS mode for individual portfolios and watchlists.
- **Spike prevention:** missing trading days (holidays, exchange closures) are forward-filled per ticker. Only dates where all tickers have data are plotted.
- **Caching:** historical data is cached in localStorage per ticker+range with a daily TTL. 1D data is never cached (always fetched fresh). Stale entries are purged automatically on each new cache write. Repeated chart opens within the same day make zero network requests. The positions chart shares the same cache as the portfolio chart.
- **Today's point:** after loading history, a current-price point is appended if the last history entry doesn't match the latest price timestamp. This keeps the chart up to date even when Yahoo delays adding the current session to the history feed (common for European instruments). The timestamp comes from `regularMarketTime` returned by the worker.
- **Force reload:** the ↻ button at the end of the chart legend clears the history cache for the current tickers and range, refreshes all position prices, then redraws the chart.

## Fundamentals Caching

Two persistent caches in `localStorage` back the Expanded Row fundamentals lines, the **More** overlay, and the **Fundamentals** view:

- **`yfund_{ticker}`** — analyst data: `targetMeanPrice`, current P/E, target history, analyst votes. Fetched via `/api/quotesummary` with the modules `financialData,defaultKeyStatistics,recommendationTrend,upgradeDowngradeHistory`. Stores only extracted parameters (not raw Yahoo modules — they can be hundreds of KB for large stocks). TTL **4 hours**. Used by the Expanded Row lines, the **More** overlay's Analyst tab, and the Fundamentals view's **Targets** and **Ratings** tabs.
- **`yearn_{ticker}`** — raw Yahoo `earnings` module for revenue, net income, and EPS. TTL **12 hours**. Used by the **More** overlay's Earnings tab and the Fundamentals view's **Earnings** and **EPS** tabs.

Both caches are schema-versioned: if the format changes, old entries are silently invalidated and refetched on next access. The `yearn_` cache is integrated with the **More** overlay in both directions — opening the Earnings tab in **More** warms the cache for the Fundamentals view, and vice versa. The same applies to `yfund_` between the row/overlay and the Targets/Ratings tabs. Data is fetched exactly once per TTL regardless of which UI surfaces it.

In-flight fetches are tracked per ticker so two parallel requests for the same ticker cannot start. ETFs and other instruments without applicable data are cached as `null` rather than refetched.

Derived display values:

- The analyst vote breakdown is sourced from `recommendationTrend`.
- **Avg tgt** is the current mean analyst price target; **30d tgt** / **100d tgt** is the rolling average over the corresponding window (prefers 30d, falls back to 100d, omits the line if no entries in the last 100 days).
- **Trailing P/E** is computed client-side as `currentPrice / trailingEps`; **forward P/E** is read directly from Yahoo.
