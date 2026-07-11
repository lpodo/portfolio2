# Portfolio Terminal 2

A PWA stock portfolio tracker with a Cloudflare Worker backend. Supports all major exchanges, extended hours (pre/post market), and cross-device sync via cloud storage.

## Overview

| | |
|---|---|
| **Frontend** | Single-file HTML SPA, hostable anywhere static (GitHub Pages, Vercel, Cloudflare Pages, Netlify, plain S3, etc.). Reference deployment: `lpodo.github.io/portfolio2` |
| **Price backend** | Cloudflare Workers — `portfolio2.lpodolskiy.workers.dev` |
| **Repository** | `lpodo/portfolio2` |
| **App** | PWA — installable on Android/iOS as a home screen app |

## Table of Contents

- [Features](#features)
  - [Portfolios](#portfolios)
  - [Positions](#positions)
  - [Prices & P&L](#prices--pl)
  - [View Modes](#view-modes)
  - [Summary](#summary)
  - [All Positions](#all-positions)
  - [Price Alerts](#price-alerts)
  - [Charts](#charts)
  - [Position sets](#position-sets)
  - [Fundamentals](#fundamentals)
  - [Analytics](#analytics)
  - [Expanded Row](#expanded-row)
  - [Bonds & Deposits](#bonds--deposits)
  - [Cash](#cash)
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

### Portfolio switcher tabs

The portfolio switcher has three tabs:

- **STOCKS** — regular equity portfolios, watchlists, plus two cross-portfolio meta-items at the bottom: [ALL POSITIONS](#all-positions) (position-level union across all stock portfolios) and Σ SUMMARY (portfolio-level totals).
- **BONDS** — bond and deposit portfolios, plus their Σ SUMMARY (see [Bonds & Deposits](#bonds--deposits)).
- **REALIZED** — realized portfolios for both stocks and bonds, listed together and separated by a divider. Cash portfolios appear next, then two cross-portfolio meta-items: ALL POSITIONS (realized) and Σ SUMMARY.

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

### Realized portfolios

Portfolios in the **REALIZED** tab hold closed positions and show their actual realized totals — by contrast with the STOCKS and BONDS tabs, which show projected/unrealized values. Two kinds — **stock** and **bond** — appear in the tab, listed separately, then cash portfolios at the bottom.

**Common properties:**

- No Refresh button — all positions are static (closed).
- Excluded from the main Σ SUMMARY and from Refresh All.
- Have a dedicated Σ SUMMARY at the bottom of the REALIZED tab. Same calculation as the main Summary — values in native currency, totals in USD with live FX conversion.

**Stocks:**

- Dropdown menu has P&L and WEIGHTS only (no MARKET, CHART, ANALYTICS, FUNDAMENTALS, ALERTS).
- Positions are created in sold status; CURRENT (sell price) is required on add.
- Populated either by adding sold positions directly, or by moving sold positions in via the ⊟ button.

**Bonds:**

- Show closed bond positions: sold bonds (with sell date, sell clean price, sell accrued interest) and matured bonds.
- Populated by moving sold or matured bonds in via the ⊟ button — they don't accept direct position add.

**Creating a realized portfolio:** switch to the REALIZED tab and use the add form. A **STOCKS / BONDS** radio selects the type.

**Closing an entire active portfolio (stocks only):** click ⊟ next to the portfolio name in the STOCKS tab. Only available when **all** positions are sold; the portfolio itself moves to the REALIZED tab.

## Positions

### Adding, editing, deleting

- Add position: ticker + qty (0 allowed) + entry price + current price (optional) + purchase date (defaults to today) + broker (current default pre-selected, see [Brokers](#brokers)) + **ISIN** (optional, 12 alphanumeric chars, uppercase-only, `US0378331005` format).
- Adding a position validates the ticker against Yahoo Finance — unknown tickers are rejected.
- Editing the ticker in the Add form clears any typed ISIN — a different ticker implies a different ISIN.
- Inline edit (✎) and delete (✕). Editing exposes the same set of fields plus the classification dropdowns (CAT / REG / SEC) and the NOTE field.

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

A portfolio can be closed (⊟ button) only when **all** its positions are sold; it then moves to REALIZED.

### Moving positions

The ⇨ button moves any position to another active portfolio, preserving all fields including sold status. Available in both active and realized portfolios. Sold positions have an additional **⊟ button** that moves them directly to a chosen realized portfolio — available for sold positions in both active and realized portfolios.

### Brokers

Each position can be tagged with a **broker** — useful when the same ticker is held at multiple brokerages and needs to be tracked separately. Brokers are managed as a dictionary (Settings → DICTIONARIES → BROKERS); set on a position via the dropdown in the Add or ✎ Edit form.

**Default broker:** one entry in the dictionary is marked as default. To set the default, open Settings → BROKERS and click a broker name (a small `(default)` tag appears next to it). When a position has no explicit broker set, `getPositionBroker(p)` substitutes the current default at read time — so changing the default reassigns every still-default position retroactively. The first broker added to an empty dictionary auto-becomes the default.

**Default fallback:** if the stored default broker is later removed from the dictionary, positions referring to it fall back to the first remaining entry alphabetically. If the dictionary is empty (no brokers ever defined), positions without a `broker` field render under the literal label `default` in places that show one (e.g. aggregation subgroups).

**Deletion guard:** a broker cannot be removed from the dictionary while any position still uses it explicitly — the delete attempt is rejected with a message listing the number of positions still referring to it. Reassign or delete those positions first.

Brokers feed three downstream features:

- The **Expanded Row** metadata row shows BROKER alongside BUY DATE.
- The **Aggregation** detail modal groups positions by broker into subgroups, each with its own SELL form.
- The **Analytics** view has a `BROKER` rubric showing the portfolio breakdown by broker.

## Prices & P&L

- Price update: ↻ per row or Refresh All (parallel).
- Sort by any column — persists across sessions.
- **P&L $** for full position: `(current - entry) × qty`
- **P&L %** per share: `(current - entry) / entry × 100`
- **Totals**: VALUE, P&L, RETURN.

**Market state indicator** (shown after P&L %):

- No icon — regular session (REGULAR)
- 🌤️ — pre-market (PRE)
- 🌙 — post-market (POST)
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

The ≡ button in the P&L table header (above the action buttons) collapses duplicate tickers into single rows for a cleaner view. Active separately for regular and realized portfolios; state persists across sessions. The ≡ icon turns green when enabled. The Weight view inherits the same mode automatically.

Aggregation rules:

- Active positions (qty>0, not sold): grouped by ticker, qty summed, entry price weighted-averaged.
- Sold positions: grouped by ticker separately, both entry and sell price weighted-averaged.
- qty=0 watchlist candidates: always shown individually, not aggregated.

Source positions are unchanged — aggregation is display-only.

**Aggregation row buttons:** instead of the per-position SELL / ✎ / ✕ set, an aggregated row shows three actions:

- **×N** (clickable) — opens the [aggregation detail modal](#aggregation-detail-modal) for the group.
- **⇨ MOVE** — moves *all* positions in the aggregation to another portfolio in one operation.
- **✕ DELETE** — deletes *all* positions in the aggregation with confirmation showing the count.

There is no batch edit and no batch sell directly on the row — selling is done from the detail modal per broker subgroup (active) or there's a single MOVE TO REALIZED button (sold). Individual edits remain available by switching aggregation off.

#### Aggregation detail modal

Clicking the **×N** button opens a modal listing the individual positions making up the aggregation, grouped by **broker** into subgroups. Each subgroup is self-contained:

- Subgroup header: `BROKER {name}` on the left; for active aggregations, a **SELL** button on the right.
- Column headers: QTY · ENTRY · CURRENT (or SOLD for sold aggregations) · P&L · % · BUY DATE.
- Position rows sorted by purchase date ascending (FIFO), then by id as tiebreaker.
- A subtotal row appears only if the subgroup has more than one position; with a single position the subtotal is suppressed as redundant.

Positions without a `broker` field land in the subgroup of the current default broker. If no brokers are defined at all, every position appears under the literal label `default`.

**Per-broker SELL form (active aggregations only):** clicking the subgroup's SELL button reveals an inline form asking QTY (max = subgroup quantity) and SELL PRICE. The sell is applied FIFO within the subgroup — the oldest positions are sold first; partial sells split the boundary position as in single-position sells. Positions in other broker subgroups are untouched.

**Sold aggregations:** the modal ends with a single **⊟ MOVE TO REALIZED** button that moves every sold position in the aggregation (across all brokers) to a chosen realized portfolio.

**Missing-date warning:** if any position in the aggregation lacks `purchaseDate`, a small `⚠` notice is shown below the table noting how many — these are treated as the oldest in FIFO order.

### Filters

A global, persistent filter narrows the set of positions shown across every view at once. Toggle it via the **∇** (nabla) icon — it sits in the P&L table header (over the MOVE column) for individual portfolios, and in the PORTFOLIO header cell of cross-portfolio views. The icon is green when a filter is active, dim otherwise. Clicking it opens the filter modal.

Two conditions are available, combined with AND:

- **PURCHASE DATE FROM** — keeps only positions bought on or after the given date. (Positions with no entry price or no purchase date are excluded by this condition.)
- **BROKER** — keeps only positions at the selected broker. (qty=0 watchlist candidates are excluded by this condition, since broker is meaningless for them.)

**APPLY** saves the filter; **RESET** clears it. The filter persists in localStorage (`pt_filter`) across sessions.

Scope of the filter:

- **Individual regular portfolios** — the filter applies. Watchlists and realized portfolios ignore it (their ∇ icon isn't shown).
- **Cross-portfolio views** (ALL POSITIONS, Σ SUMMARY) — the active summaries apply the filter; the realized summary does not.
- **What you see is what you act on:** the filter is the single choke point for both display *and* operations — aggregation, bulk move, bulk delete, and totals all operate on the filtered set, so you can't accidentally act on hidden positions.

## Summary

Selected from the portfolio switcher (**Σ SUMMARY** at the bottom of the STOCKS, BONDS, or REALIZED tab). Portfolio-level cross-portfolio view: each row is a portfolio, with totals computed across the portfolios in scope. Refresh on Summary updates all portfolios in scope.

The ⋮ dropdown menu shows three views:

- **P&L** (default) — NAME / VALUE (in native currency) / P&L / RETURN / SHARE%. The total row is always in USD with live FX conversion. Clicking a portfolio name switches to it.
- **MARKET** — per-portfolio aggregates: PORTFOLIO / [close] / [current] / Δ / Δ%. Uses the same CLOSE/CURRENT mode menus as the regular MARKET view (including historical periods 5D/1M/3M/6M/1Y/5Y); the value in each row is the portfolio's total at the chosen price.
- **CHART** — see [Summary Chart](#summary-chart) — TOTAL or BY PORTFOLIO modes.

## All Positions

A cross-portfolio view at the **position** level — the union of positions from all stock (or all realized) portfolios, deduplicated by ticker, rendered as a single table. Selected from the portfolio switcher (**ALL POSITIONS** meta-item):

- In the **STOCKS** tab — collects positions from all regular equity portfolios and watchlists.
- In the **REALIZED** tab — collects sold positions from all stock realized portfolios.

The ⋮ dropdown shows four views in the STOCKS context and two in REALIZED:

- **MARKET** (stocks default) — same columns and CLOSE/CURRENT menus as the regular [MARKET](#market) view, but built from all positions across portfolios. Default sort: Δ% absolute descending (biggest movers first).
- **ALERTS** (stocks only) — MARKET filtered to positions that have at least one alert set. See [ALERTS view](#alerts-view).
- **WEIGHTS** (realized default) — TICKER / VALUE (native currency, dimmed) / VALUE (\$) (USD-converted) / WEIGHT % / NAME. All non-USD values converted using live FX rates. Sortable by TICKER, VALUE (\$), or WEIGHT.
- **ANALYTICS** — same two-dropdown layout as the per-portfolio [Analytics](#analytics) view, but data is aggregated across all positions in the context. In REALIZED only the P&L and WEIGHTS subviews are available.

ALL POSITIONS is excluded from FUNDAMENTALS, CHART, and P&L views (those operate on a single portfolio or aggregate by portfolio, not by position across portfolios).

## Price Alerts

Each **ticker** can have one or more price alerts. Alerts live in a registry keyed by ticker, so the same ticker held in multiple portfolios, brokers, or watchlists shares one alert set. Alerts are checked on every price refresh and shown across all market-style views.

An alert set persists while at least one **live** position of the ticker exists — meaning a non-sold position in a regular portfolio, or any position in a watchlist (including qty=0 candidates). When the last live position is removed (sold, moved to a realized portfolio, deleted, or its portfolio is deleted), the ticker's alerts are dropped automatically. Realized portfolios don't keep alerts alive.

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

A colored dot `●` appears after the ticker name when any alert on that ticker is triggered. The color depends on the direction of the triggered alert:

- Yellow `●` — at least one `>` alert is triggered (price crossed above target).
- Sky-blue `●` — at least one `<` alert is triggered (price crossed below target).
- Both dots appear (sky-blue first, then yellow) when alerts of both directions are triggered.

When **multiple** alerts in the same direction are triggered for a ticker, the corresponding dot **blinks** — a single triggered alert renders as a solid dot. The blink speed progresses with the number of triggered alerts: 2 alerts blink at the user's base period, 3+ alerts step one level faster per extra alert, clamped at the fastest level. The base period (slow / med / fast) is configurable in Settings → **APPEARANCE**.

Each color is shown at most once per ticker, regardless of how many alerts in that direction have triggered. The dots are visible in all views that show tickers: P&L, MARKET, WEIGHTS, ALERTS, and the ALL POSITIONS views.

### ALERTS view

Available via ⋮ menu → **ALERTS** for individual portfolios, watchlists, and the ALL POSITIONS meta-view. Not available for realized portfolios or Summary.

Structurally a [MARKET](#market) view filtered to positions whose ticker has at least one alert set (sold positions excluded). Inherits everything from MARKET: column layout, the CLOSE/CURRENT mode menus, the Δ% sort cycle, the per-row expand. The difference is purely scope — the rows are the positions you're actively watching.

The default sort on entry depends on context:

- **Individual portfolio / watchlist**: portfolio order (matches MARKET's default).
- **ALL POSITIONS → ALERTS**: |Δ%| descending — biggest movers among alerted positions first.

Source of rows:

- **Individual portfolio**: positions from the current portfolio.
- **ALL POSITIONS → ALERTS**: positions with alerts collected from all stock portfolios and watchlists, deduplicated by ticker.

Empty state: `NO ALERTS SET`.

## Charts

Available via dropdown menu → CHART for individual portfolios and Summary.

**Controls:** 7 range buttons — **1D · 5D · 1M · 3M · 6M · 1Y · 5Y**. A dropdown selects what's plotted. For individual portfolios it offers **PORTFOLIO** (default) plus each defined [position set](#position-sets), with a **MANAGE SETS…** entry at the bottom. For watchlists, PORTFOLIO is hidden — only sets are available. For the Summary chart, the dropdown selects **TOTAL** or **BY PORTFOLIO**.

**Range notes:** 1D is blocked in PORTFOLIO mode and in the Summary chart (with an explanatory message) — it only works when a set is selected.

**Force reload:** A ↻ button at the end of the chart legend clears the history cache for the current tickers and range, refreshes all position prices, then redraws the chart — one tap for a fully up-to-date view.

### Portfolio Chart — PORTFOLIO mode

Single line showing total portfolio value over time in base currency. Active positions only (sold and qty=0 excluded).

### Portfolio Chart — position set mode

Normalized % lines for the tickers in the selected set (deduplicated — if the same ticker appears multiple times, one line is shown). Each line starts at 0% on the first available date. Color-coded with a legend showing the final % change. An empty set (no tickers in the current portfolio) shows "No positions in this set"; on a watchlist with no sets defined, the placeholder reads "Create a set to view the chart".

### Summary Chart

In Summary, the dropdown menu → CHART shows two modes selectable via a green dropdown button:

- **TOTAL** — single line showing the combined value of all active portfolios in USD with FX conversion.
- **BY PORTFOLIO** — one normalized line per portfolio starting at 0%, each calculated in its own base currency (no USD conversion, so FX effects don't distort relative stock performance). Color-coded with a legend showing the final % change.

## Position sets

A portfolio can have any number of **position sets** — named subsets of its tickers, reusable across Chart and Fundamentals views. Each set has a name (uppercase, free text) and a list of tickers picked from the portfolio. Sets are stored as part of the portfolio JSON (`positionSets`) and synced to the cloud alongside everything else; tickers are tracked by symbol, so re-adding a deleted position keeps it in any set it belonged to.

The picker dropdown in Chart and Fundamentals views lists all sets defined for the current portfolio. The currently shown set is remembered per portfolio in localStorage (`pt_chart_set_{portfolioId}` for Chart, `pt_fund_set_{portfolioId}` for Fundamentals) and persists across reloads. If a previously-selected set is deleted, the next render falls back to the default (PORTFOLIO for Chart, none for Fundamentals).

**Managing sets:** the bottom of the picker dropdown has a **MANAGE SETS…** entry that opens a modal listing all sets for the current portfolio, plus a **+ NEW SET** button. For each set there are ✎ (edit name and tickers) and ✕ (delete, with confirmation) buttons. Creating or editing a set opens an inline form with a name input and a checkbox list of all tickers in the portfolio, with **ALL** / **NONE** shortcuts. Saving stores the set in the portfolio JSON; cancelling discards changes.

A set with zero tickers can be saved — it simply renders as the corresponding empty placeholder in the views.

## Fundamentals

Available via dropdown menu → FUNDAMENTALS for individual portfolios and watchlists. Not available for realized portfolios.

A comparative table across selected tickers with four subviews switchable via tabs:

- **Targets** — current price, analyst price targets (mean and rolling average over a 30d/100d window) with upside %, and P/E. The current-price column and the target window are switchable via dropdowns in the column headers.
- **Ratings** — analyst recommendation breakdown (strong buy / buy / hold / sell / strong sell).
- **Earnings** — quarter-over-quarter growth of revenue and net income over the last 3 quarters, sign-colored.
- **EPS** — actual EPS per quarter.

On entering the view, state is always reset to defaults: **Targets** tab, **Current** price, **30d** window.

### Set selection

Use the picker dropdown in the upper right to choose which [position set](#position-sets) to compare. Default: nothing selected — the view shows the placeholder `NO SET SELECTED`. If the chosen set has no tickers in the current portfolio, the placeholder becomes `NO POSITIONS IN THIS SET`; if the set's tickers are all non-equity (see below), it shows `NO EQUITY POSITIONS IN THIS SET`.

The current selection is remembered per portfolio in localStorage (`pt_fund_set_{portfolioId}`) and persists across reloads.

### Non-equity filtering

Fundamentals data is meaningful only for individual stocks. Other instrument types (ETFs, indices, mutual funds, currencies, etc.) are filtered out of the comparative table — the worker tags every quote with an `instrumentType` field (sourced from Yahoo's `meta.instrumentType`), and only `EQUITY` rows are included. The number of skipped tickers is shown below the table, e.g. `2 non-equity tickers (ETF / index / etc.) skipped`.

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

Available via dropdown menu → ANALYTICS for individual portfolios and the ALL POSITIONS meta-view (both stock and realized contexts).

Two dropdowns at the top of the view drive what's shown:

- **Rubric** (left): **CATEGORY** / **REGION** / **SECTOR** / **CURRENCY** / **EXCHANGE** / **ISIN** / **BROKER**. Determines how positions are grouped. Positions with qty=0 are excluded from all rubrics. Positions without a value in the selected field fall into a fallback bucket described per-rubric below.
- **Subview** (right): determines what's shown per group. Four options — **P&L**, **MARKET**, **CHART**, **WEIGHTS**. Realized contexts only have **P&L** and **WEIGHTS** (MARKET and CHART make no sense for closed positions).

Rubric semantics:

- **CATEGORY / REGION / SECTOR / ISIN** — ticker-level attributes (see [Ticker classification fields](#ticker-classification-fields)). Same ticker, same value everywhere. Fallback bucket: `Other` (or `Unknown` for ISIN).
- **CURRENCY / EXCHANGE / BROKER** — position-level. Currency uses the actual position currency from Yahoo Finance. Exchange uses the position's `exchangeName` field. Broker falls back to the current default broker when empty (see [Brokers](#brokers)). Fallback bucket: `Other`.
- The ISIN rubric groups by **country code** — the first two characters of the ISIN (e.g. `US`, `NL`, `GB`). Positions whose ticker has no known ISIN — including all non-securities (indices, currencies, etc.) — fall into `Unknown`.

Subviews:

- **P&L** — VALUE / P&L / RETURN per group, plus grand totals. For the CURRENCY rubric, each row is shown in its native currency (no within-row conversion); grand totals always in the base currency.
- **MARKET** — per-group AT CLOSE / CURRENT / Δ / Δ%, mirroring the regular MARKET view. Uses the same CLOSE/CURRENT mode menus including historical periods.
- **CHART** — one normalized % line per group, each starting at 0% on the first available date. Color-coded with a legend showing the final % change.
- **WEIGHTS** — group name, value (with FX conversion to base currency), weight %, and a horizontal bar chart scaled to the largest group.

Row order is stable across subview switches — groups are sorted by base value descending, with the fallback bucket always last — so toggling between subviews doesn't shuffle the table. The rubric and subview selections persist in localStorage (`pt_analytics_subview`).

### Ticker classification fields

Four attributes describe **the security itself**, not any specific holding: **category**, **region**, **sector**, and **ISIN**. They live on the ticker (in the [Ticker data registry](#ticker-data-registry)) — one value per ticker, shared by every position of that ticker across every portfolio.

- **CATEGORY / REGION / SECTOR** — must be chosen from dictionaries (Settings → DICTIONARIES). Free text is not allowed; this guarantees exact consistency across portfolios so Analytics grouping works.
- **ISIN** — free text, 12-character ISO 6166 code. Uppercase-only, alphanumeric.

These attributes are shown and edited only for real securities (`EQUITY` / `ETF`) — for indices, currencies, futures, crypto, etc. the fields are hidden entirely in both the expanded row and the edit form, since they have no meaningful company-level classification.

**Setting values:** open the ✎ edit form for any position. Each dictionary-backed field shows a custom dropdown — tap/click to open the list. Select a value, or choose **+ new...** to add a new value inline: a text input appears with ✓ (confirm) and ✕ (cancel) buttons. Confirming adds the value to the dictionary and selects it. Saving updates the ticker — so every other position of the same ticker sees the change immediately.

For ISIN, overwriting or clearing an existing value triggers a confirmation dialog. Setting an ISIN on an empty slot happens silently.

**Dictionaries** (Settings → DICTIONARIES): five buttons — CATEGORIES, REGIONS, SECTORS, BROKERS, CASH CAT. Tap a button to expand the list of values for that dictionary. Each value has a ✕ button to delete it from the dictionary. Deleting a value from the dictionary does not remove it from existing tickers — except for BROKERS, where deletion is rejected while any position still references the broker (see [Brokers](#brokers)).

Dictionaries are included in cloud sync and backup/restore. Grouping in Analytics normalizes whitespace (trims and collapses multiple spaces) but preserves original casing.

### Note field

Each position has a free-text **note** field, set via the ✎ edit row. Notes are position-level (unlike CAT/REG/SEC/ISIN which are ticker-level) — one note per lot, so different positions of the same ticker can carry different annotations. Notes don't affect any calculations or groupings and appear only in the expanded view and the edit form.

### CSV import / export

Located in Settings → **ANALYTICS CSV** as three buttons — **↑ IMPORT CSV**, **↓ EXPORT CSV**, **↓ INCOMPLETE**.

- **EXPORT CSV** downloads `tickers_analytics.csv` — all tickers with at least one of category/region/sector set, plus their current values.
- **INCOMPLETE** downloads `incomplete_analytics.csv` — all unique tickers across all regular and realized portfolios (watchlist excluded) where at least one of category/region/sector is empty. Useful for identifying what still needs to be classified.
- **IMPORT CSV** reads a CSV and updates ticker attributes. Supports comma (`,`) or semicolon (`;`) delimiter, auto-detected from the header row. Empty fields in the CSV do not overwrite existing values. All imported category/region/sector values are automatically added to their respective dictionaries.

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

Tapping/clicking the **ticker name** in any market-style view toggles an expandable sub-row. Available in: **P&L**, **MARKET**, **ALERTS**, **watchlist** views, and the **ALL POSITIONS → MARKET / ALERTS / WEIGHTS** views. Tap the ticker again to collapse. The expanded state resets when switching portfolios.

### Position metadata

Metadata layout depends on the position's instrument type:

- **Real security (`EQUITY` / `ETF`) with qty>0** — two rows:
  ```
  BROKER  ETrade   BUY DATE  2024-08-19   ISIN  US26884L1098
    CAT  AI & Semi    REG  US    SEC  Technology
  ```
- **Real security in a watchlist (qty=0)** — trade fields make no sense, so only ISIN + CAT/REG/SEC show:
  ```
  ISIN  US26884L1098
    CAT  AI & Semi    REG  US    SEC  Technology
  ```
- **Non-security** (`INDEX`, `CURRENCY`, `FUTURE`, `CRYPTO`, etc.) — these have no meaningful company-level metadata; both rows are hidden entirely.

Fields:

- **BROKER** — the broker tagged on this position, or the current default broker if none is explicitly set (see [Brokers](#brokers)). If no brokers are defined at all, shows `default`.
- **BUY DATE** — the position's `purchaseDate` (ISO `YYYY-MM-DD`), or `—` if not set.
- **ISIN** — International Securities Identification Number for the ticker, or `—` if not known. Free-text; the frontend supports lookup via the worker's `/api/isin` endpoint but no free provider currently supplies it (see [Cloudflare Worker](#cloudflare-worker)), so users enter ISINs manually via the ✎ Edit form. Overwriting or clearing an existing ISIN triggers a confirmation dialog.
- **CAT / REG / SEC** — classification fields, ticker-level (see [Ticker classification fields](#ticker-classification-fields)). Show `—` if empty.

Below these, always two more rows:

```
NOTE  Bought on dip after earnings  ✎
ALERTS  > 920  ✕    [>] [price] [+]
```

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
- The blue `[›]` button opens the **More** overlay (see below).

### More overlay

A full-screen overlay with additional Yahoo Finance information, organized into six tabs. Opens on the **CHART** tab by default; other tabs fetch their data on first switch and are kept for the session. Escape or ✕ closes the overlay.

- **CHART** — price chart for the single ticker across seven ranges (1D · 5D · 1M · 3M · 6M · 1Y · 5Y). Uses the existing history cache, so reopening within the same day is instant.
- **MARKET** — current market data: regular and pre/post prices, bid/ask, day and 52-week ranges, 50d/200d/all-time averages, volume, beta.
- **KEY STATS** — fundamentals: market cap, cash and debt, cash flows, revenue and earnings growth, valuation multiples (P/E, P/B, P/S, PEG), trailing/forward EPS, dividend info, next earnings date.
- **EARNINGS** — quarterly and yearly toggle: a table of revenue, net income, EPS (quarterly only), and net margin, plus a stacked bar chart with a net-margin line overlay.
- **ANALYSTS** — analyst price targets (high / low / mean / median with upside %), recommendation summary, vote breakdown, and a history table of recent upgrades/downgrades with a rolling-window average target tied to a configurable day count.
- **SENTIMENT** — insider/institutional ownership and short interest (`sharesShort`, `shortPercentOfFloat`).

### Behavior in aggregation mode

Expanded rows are enabled for aggregated entries, with the following behavior on the four metadata lines:

- **BROKER / BUY DATE:** BUY DATE is hidden in aggregation mode (positions in a group may have different purchase dates — the breakdown lives in the [aggregation detail modal](#aggregation-detail-modal)). BROKER shows the single broker name if all positions agree, or `N brokers` in dim style if the group spans multiple brokers.
- **Attributes (CAT / REG / SEC):** the app enforces identical attributes across all instances of the same ticker, so the values are read from any one position in the aggregated group (the first one).
- **Notes:** non-empty notes from all positions in the group are joined into a single read-only block. Editing is not available in aggregation mode — switch to a non-aggregated view to edit individual notes.
- **Alerts:** all positions in the group share the same alert set — alerts are keyed by ticker, not by position. The list shown in the aggregated row's expansion is the same set you'd see on any individual row of the same ticker. Delete and add controls work as in normal mode.

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

### Selling bonds

Bonds can be sold before maturity via the **SELL** button on a position row.

**Sell dialog:** asks for sell quantity (default: full position), sell date (defaults to today, or to the maturity date if it has already passed), clean price as % of par (default 100), and accrued interest (default 0). A **PREVIEW** button computes and shows BODY P&L, COUPON INCOME, total PROFIT, RETURN, and ANN.YIELD before committing; the button then changes to **CONFIRM SELL** to apply the sale.

**Partial sell:** if quantity < position qty, the position is split into two records — the sold portion (with sell-side params) and the remainder (active, unchanged buy-side params).

**Sold bonds:** marked with `sold: true` and the sell-side fields. They are excluded from active totals and contribute to a separate **SOLD** totals bar in the bond portfolio view. The sell-side params can be corrected via ✎. Use the ⊟ button to move a sold or matured bond to a Bonds portfolio in REALIZED.

For sold bonds, **Profit** uses the sell-side dirty price instead of par + total coupons, and **coupons received** counts only coupons in `(purchaseDate, sellDate]`.

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

## Cash

Cash portfolios track free funds and cashflow events outside of any specific instrument — fees, dividends, coupons, and so on. Each portfolio is a flat list of dated **entries**, not positions.

Cash portfolios live at the bottom of the **REALIZED** tab in the portfolio switcher, below the stock and bond portfolios there.

### Entries

Each entry has:

- **Date** — required; future dates are not allowed.
- **Amount** — required; sign chosen via a `+` / `−` toggle next to the input.
- **Currency** — defaults to the portfolio base currency; validated against Yahoo Finance.
- **Category** — required; free text with autocompletion from a shared dictionary (`pt_cash_cat_dict`).

Entries can be edited (✎) or deleted (✕) inline. The ⊟ button moves an entry to another cash portfolio.

### Table view

Columns: **DATE · CATEGORY · AMOUNT**, sorted newest first (secondary sort by id for stable ordering on the same date). Amounts are sign-colored (green for positive, red for negative).

A **TOTAL** row at the bottom shows the net balance, converted to the portfolio base currency via live FX rates. Entries in other currencies are converted on the fly.

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
  "bondsDb": [ ... ],
  "bondPortfolios": { ... },
  "cashPortfolios": { ... },
  "tickerData": { ... },
  "catDict": ["AI & Semi", "Energy", ...],
  "regDict": ["Europe", "US", ...],
  "secDict": ["Energy", "Technology", ...],
  "cashCatDict": ["Salary", "Dividend", ...],
  "brokerDict": ["ETrade", "IB", ...],
  "defaultBroker": "ETrade"
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

- `/api/quote?ticker=AAPL` — price quote. Returns `price`, `priceType`, `marketState`, `regularMarketPrice`, `previousClose`, `priceTimestamp`, `currency`, `exchangeName`, `shortName`, `instrumentType`. `instrumentType` comes from Yahoo's `meta.instrumentType` (`EQUITY`, `ETF`, `INDEX`, `MUTUALFUND`, `CURRENCY`, etc.) and is used by the Fundamentals view to filter out non-equity rows. Optional `&simple=1` skips extended-hours candle logic.
- `/api/history?ticker=AAPL&range=1mo` — historical OHLCV for charts. Supported ranges: `1d`, `5d`, `1mo`, `3mo`, `6mo`, `1y`, `5y`. Returns `{ points: [{t, o, h, l, c, v}] }`.
- `/api/kv` — cloud storage proxy (GET to load, PUT to save). Requires the `X-KV-Key` header with the user's storage key. Only available when the Cloudflare KV backend is configured.
- `/api/profile?ticker=AAPL` — sector/industry/country from Yahoo `assetProfile`. Returns nulls for ETFs and when Yahoo blocks the request.
- `/api/quotesummary?ticker=AAPL&modules=financialData,defaultKeyStatistics,recommendationTrend,upgradeDowngradeHistory` — Yahoo Finance fundamentals via the `quoteSummary` API. Returns raw module data under `quoteSummary.result[0]`. Requires a Yahoo crumb token for auth; the worker fetches and caches the crumb in-memory automatically. If Yahoo returns 404 for a multi-module request (some ETFs lack certain modules), the worker falls back to per-module fetches and merges what succeeds. Used by the **Expanded Row** fundamentals lines and the **More** overlay.
- `/api/isin?ticker=AAPL` — ISIN lookup. Currently a **stub**: always returns `{ isin: null }`. No free provider supplies ISIN data reliably (Yahoo doesn't return it, Business Insider scrapes are noisy, Twelve Data gates the field behind a paid add-on). The endpoint stays so the frontend contract is unchanged — users enter ISINs manually via the ✎ Edit form, and a real provider can be wired in later by editing only this handler. The frontend caches a negative result with the `UNRESOLVED` marker so it won't re-query (see [Ticker data registry](#ticker-data-registry)).
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

A position is now a purely **transactional** record — it describes one lot you bought (and possibly sold). Everything about the *security* (its price, currency, name, market metadata, classification, ISIN, alerts) has moved to the ticker-keyed [Ticker data registry](#ticker-data-registry) and is read through helper functions (`getPositionCurrent`, `getPositionCurrencyCode`, `getTickerMeta`, etc.).

```json
{
  "id": 1234567890,
  "ticker": "EOG",
  "qty": 8,
  "entry": 134.00,
  "purchaseDate": "2024-08-19",
  "broker": "ETrade",
  "note": "core energy holding",
  "sold": false
}
```

A sold lot additionally freezes its sale values, which are historical and must never be seeded back into the live ticker:

```json
{
  "id": 1234567891, "ticker": "EOG", "qty": 8, "entry": 134.00,
  "purchaseDate": "2023-02-10", "broker": "ETrade",
  "sold": true, "sellPrice": 151.20, "sellCurrency": "USD"
}
```

Fields:

- `id` — unique numeric id (`Date.now()`-based) identifying the lot.
- `ticker` — uppercase symbol; the key into the ticker data registry.
- `qty` — number of shares. `qty=0` is allowed for watchlist candidates. P&L $ shows `—`, P&L % is calculated if entry > 0. Entry=0 is allowed only when qty=0 (pure price tracking). Excluded from WEIGHTS and Analytics totals.
- `entry` — buy price per share.
- `purchaseDate` — ISO `YYYY-MM-DD` (local timezone). Optional; defaults to today on add. Used for FIFO ordering inside the aggregation detail modal, the purchase-date filter, and display in the [Expanded Row](#expanded-row).
- `broker` — explicit broker tag for this lot. Optional; when absent, `getPositionBroker(p)` resolves to the current default broker at read time. See [Brokers](#brokers).
- `note` — optional free-text annotation. Position-level (each lot can carry its own note), unlike the ticker-level classification. Visible only in the expanded row and edit form.
- `sold` — marks the lot as closed. A sold lot carries `sellPrice` and `sellCurrency` (frozen at sale); its price is not refreshed.

Everything else a position used to carry — `current`, `currency`, `shortName`, `instrumentType`, `exchangeName`, `marketState`, `priceType`, `regularMarketPrice`, `previousClose`, plus `category` / `region` / `sector` / `isin` / `alerts` — is ticker-level and lives in the [Ticker data registry](#ticker-data-registry).

### Portfolio structure

```json
{
  "name": "OIL & GAS",
  "currencyCode": "USD",
  "watchlist": false,
  "archive": false,
  "positions": [],
  "positionSets": []
}
```

- `currencyCode` — ISO 4217 base currency. All position values are converted to this currency for VALUE and WEIGHTS. Validated against Yahoo Finance on creation/rename.
- `watchlist: true` — watchlist portfolio (no qty/entry fields, simple price display, excluded from Summary).
- `archive: true` — realized portfolio (all positions sold, no Refresh, excluded from the main Summary).
- `positionSets` — array of named ticker subsets for use by Chart and Fundamentals views: `[{ id: "set_<timestamp>", name: "AI BASKET", tickers: ["NVDA", "ASML.AS"] }]`. Tickers are stored as symbols, not IDs, so re-adding a removed position keeps it in any set it belonged to. See [Position sets](#position-sets).

### Ticker data registry

The central consequence of the data refactor: a ticker-keyed registry holds **everything that describes the security rather than a specific holding**. One entry per ticker, shared by every position of that ticker across every portfolio. Persisted in localStorage under `pt_ticker_data` and cloud-synced as a top-level field `tickerData`.

It stores three groups of fields:

1. **Live market metadata** from Yahoo — refreshed on every price update: `current`, `currency`, `shortName`, `instrumentType`, `exchangeName`, `marketState`, `priceType`, `regularMarketPrice`, `previousClose`.
2. **User classification** — `category`, `region`, `sector` (dictionary-backed) and `isin`.
3. **Alerts** — `alerts` array.

```json
{
  "AAPL": {
    "current": 248.10,
    "currency": "USD",
    "shortName": "Apple Inc.",
    "instrumentType": "EQUITY",
    "exchangeName": "NMS",
    "marketState": "REGULAR",
    "priceType": "regular",
    "regularMarketPrice": 248.10,
    "previousClose": 246.55,
    "category": "Consumer Electronics",
    "region": "US",
    "sector": "Technology",
    "isin": "US0378331005",
    "alerts": [
      { "id": "1735420800123_a7k9x2", "condition": ">", "value": 250.00, "triggered": false }
    ]
  },
  "^GSPC": {
    "current": 5820.4,
    "shortName": "S&P 500",
    "instrumentType": "INDEX",
    "isin": "UNRESOLVED"
  }
}
```

Field semantics:

- Market metadata is stored verbatim from Yahoo (numeric fields stay numeric). A `null`/`undefined` clears the field. Read via `getTickerMeta(ticker, field)` and the per-field wrappers (`getPositionCurrent`, `getPositionCurrencyCode`, `getPositionShortName`, etc.).
- `category` / `region` / `sector` — free-string values chosen from dictionaries (see [Ticker classification fields](#ticker-classification-fields)); hand-typed values are trimmed. Absent means unclassified.
- `isin` — one of three states: a real ISIN string; the marker `UNRESOLVED` (a provider was asked and returned nothing — don't re-ask); or absent (never looked up). A lookup fires only when the field is falsy, so both a known ISIN and the `UNRESOLVED` marker suppress re-querying. The helper `isKnownIsin(v)` treats any value starting with `UNRESOLVED` as a marker — so a future provider can use a suffixed variant (e.g. `UNRESOLVED_V2`) to auto-requery tickers still carrying the bare marker, without changing the check.
- `alerts` — array of alert objects `{ id, condition: ">" | "<", value, triggered }`. Absent means no alerts. `triggered` is recomputed on every price refresh and saved (the dot stays lit between sessions until the next refresh re-evaluates). Alert IDs are `Date.now() + '_' + shortRandom`.

Storage rules: missing fields aren't stored (no `null` clutter); if an entry ends up with no fields, it's removed entirely.

**Cleanup** — `pruneTickerData(ticker)` runs after operations that may orphan a ticker (sell, delete, move-to-archive, ticker rename, portfolio delete). Retention differs by field group:

- **Alerts** are dropped when no live position of the ticker remains (non-sold in a regular portfolio, or any position in a watchlist). Realized portfolios don't keep alerts alive.
- **Classification / ISIN / market metadata** are dropped only when no position of the ticker exists **anywhere**, including realized portfolios — closed positions still want their metadata for reporting.

The hook is idempotent.

## Local Storage

Primary on-device storage:

- `pt_portfolios` — all equity portfolios and positions
- `pt_bonds_db` — bond database (bond definitions)
- `pt_bond_portfolios` — bond portfolios and positions (also used by deposit portfolios)
- `pt_cash_portfolios` — cash portfolios and entries
- `pt_cash_cat_dict` — shared dictionary of cash entry categories
- `pt_ticker_data` — ticker-keyed registry with live market metadata, classification, ISIN, and alerts (see [Ticker data registry](#ticker-data-registry))
- `pt_current` — active portfolio ID
- `pt_finnhub` — Cloudflare Worker URL
- `pt_token` — API token for Cloudflare Worker
- `pt_sort` — P&L sort state for active portfolios
- `pt_sort_arc` — P&L sort state for realized portfolios
- `pt_wl_sort` — sort state for watchlist market view
- `pt_cat_dict` — CATEGORY dictionary (sorted array of values)
- `pt_reg_dict` — REGION dictionary
- `pt_sec_dict` — SECTOR dictionary
- `pt_broker_dict` — BROKER dictionary
- `pt_default_broker` — default broker name (used by `getPositionBroker` when a position has no explicit `broker`); falls back to the first dict entry if the stored value is missing
- `pt_agg_active`, `pt_agg_archive` — aggregation mode state
- `pt_cloud_backend` — cloud storage backend: `jsonbin` (default) or `kv`
- `pt_jbkey` — JSONBin master key
- `pt_jbbin` — JSONBin bin ID
- `pt_kv_key` — Cloudflare KV user key
- `pt_cloud_ts` — cloud sync timestamp (conflict prevention)
- `pt_enc_key` — AES-GCM encryption password
- `pt_contrast` — APPEARANCE contrast preset (`low` / `med` / `high`); default `low`
- `pt_blink_period` — APPEARANCE base blink period for triggered alerts (`slow` / `med` / `fast`); default `med`
- `pt_close_mode` — close column mode: `prev` (Prev.Close), `reg` (Reg.Price), or a historical period (`5d`, `1mo`, `3mo`, `6mo`, `1y`, `5y`); default `prev`
- `pt_current_mode` — current column mode: `cur` (Current) or `reg` (Reg.Price); default `cur`
- `pt_analytics_subview` — Analytics subview: `pnl` / `market` / `chart` / `weights`; default `weights`
- `pt_filter` — global position filter: `{ purchaseDateFrom?, broker? }`; absent when no filter is set (see [Filters](#filters))
- `pt_chart_set_{portfolioId}` — currently selected set in the Chart view (a set ID or the string `portfolio` for PORTFOLIO mode)
- `pt_fund_set_{portfolioId}` — currently selected set in the Fundamentals view (a set ID, or absent for "no selection")
- `chart_hist_{ticker}_{range}` — historical price cache (daily TTL)
- `yfund_{ticker}` — fundamentals cache for Targets and Ratings (4-hour TTL)
- `yearn_{ticker}` — earnings cache for Earnings and EPS (12-hour TTL)

## Cloud Storage

Cross-device sync via two supported backends (selected in Settings):

- **JSONBin.io** — direct browser-to-API requests; requires a Master Key and Bin ID.
- **Cloudflare KV** — routed through the Worker; requires only a user-defined KV Key. More reliable and no extra API keys needed.

Bond, deposit, cash, and ticker-data (`bondsDb`, `bondPortfolios`, `cashPortfolios`, `tickerData`, stored in `pt_bonds_db`, `pt_bond_portfolios`, `pt_cash_portfolios`, and `pt_ticker_data`) is included in cloud sync alongside equity portfolios, in the same cloud storage record, regardless of backend.

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
