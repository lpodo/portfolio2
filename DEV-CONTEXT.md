# Portfolio Terminal 2 — Developer Context

Implementation decisions, invariants, and non-obvious details for ongoing development.

---

## Project State

**Files:**
- `index.html` — entire frontend (~5850 lines, single file, no build step)
- `worker.js` — Cloudflare Worker backend
- `sw.js` — Service Worker (cache versioning, must bump on every `index.html`/`manifest.json`/`icon-192.png` change)
- `wrangler.toml` — Cloudflare deployment config (includes KV namespace ID)
- `manifest.json` — PWA manifest
- `README.md` — user-facing feature documentation
- `CLAUDE.md` — instructions for Claude Code sessions
- `DEV-CONTEXT.md` — this file

**Deployment:**
- Frontend: GitHub Pages, auto-deploys on push to `main`
- Worker: Cloudflare Workers, auto-deploys via GitHub integration

---

## Architecture

### Single-file frontend

No frameworks, no build tools. Everything in `index.html`. Intentional — maximum portability, no dependencies, easy to inspect and deploy. The tradeoff is a large file (~250KB), handled fine by GitHub Pages CDN.

### Service Worker

Named cache (`portfolio-vXXX`). On install: fetches and caches `index.html`, `manifest.json`, `icon-192.png`; deletes old caches. `skipWaiting()` + `clients.claim()` ensure immediate activation.

**Known issue:** GitHub Pages CDN can serve stale `index.html` for 10–30 minutes after a push. sw.js propagates faster, so the SW may cache the old index.html. No reliable fix — users must wait or use incognito.

---

## Key Globals

```javascript
// Equity portfolios
var portfolios = {};           // { id: { name, positions, currencyCode, watchlist, archive } }
var currentPortfolioId = null;
var positions = [];            // shortcut: portfolios[currentPortfolioId].positions
var viewMode = 'main';         // see View Mode Routing below
var editId = null;             // position being edited (inline form)
var expandedId = null;         // position with expanded attributes row
var editNoteId = null;         // position with open note editor
var sortKey = null, sortDir = 1;
var archiveSortKey = null, archiveSortDir = 1;
var editingPortfolioId = null; // portfolio being renamed in switcher
var movePosId = null;          // position pending move to another portfolio
var archiveMenuPosId = null;   // position pending move to archive
var positionClipboard = null;  // last copied position data
var switcherTab = 'active';    // 'active' | 'archive' in switcher

// Classification dictionaries (sorted arrays, persisted to localStorage)
var catDict = [], regDict = [], secDict = [];

// Market/view state
var closeMode = 'prev';        // market close column: 'prev' | 'reg' | historical period
var currentMode = 'cur';       // market current column: 'cur' | 'reg'
var aggregatedModeActive = …;
var aggregatedModeArchive = …;
var weightSort = { key: 'weight', dir: -1 };
var marketSort = { key: null, dir: -1 };
var watchlistSort = { key: null, dir: -1 };

// FX rates
var fxRateCache = {};          // { 'EURUSD=X': { rate, ts } }
var fxRateInflight = {};       // deduplication of in-flight requests
var FX_CACHE_TTL = 5 * 60 * 1000;

// Bond / deposit portfolios
var bondsDb = [];              // [{ id, name, currency, parValue, nominalYield, couponFrequency, maturityDate }]
var bondPortfolios = {};       // { id: { name, currencyCode, type:'bond'|'deposit', positions:[] } }
var currentBondPortfolioId = null;
var newBondPortfolioType = 'bond'; // radio selection in add-portfolio form
var editingBondPosId = null;
var editingDepPosId = null;
var editingBondDbId = null;
```

---

## View Mode Routing

`viewMode` values:

| Value | Context |
|---|---|
| `main` | P&L (active / archive / watchlist) |
| `weight` | WEIGHTS |
| `market` | MARKET |
| `movers` | legacy per-portfolio top-movers (no UI entry point; preserved for backward compat) |
| `chart` | CHART |
| `analytics` | ANALYTICS |
| `alerts` | ALERTS |
| `global-weight` | Σ WEIGHTS (cross-portfolio) |
| `summary` | P&L in summary |
| `summary-market` | MARKET in summary |
| `summary-movers` | Σ MARKET in summary |
| `summary-chart` | CHART in summary |
| `summary-analytics` | Σ ANALYTICS in summary |
| `summary-alerts` | Σ ALERTS in summary |
| `archive-summary` | archive summary |
| `bonds` | bond/deposit portfolio view |
| `bond-summary` | Σ SUMMARY for bonds+deposits |

`setView(mode)` — routes ⋮ menu clicks. In summary context, maps `market→summary-market`, `chart→summary-chart`, `analytics→summary-analytics`, `market-total→summary-movers`, `alerts→summary-alerts`, `global-weight→global-weight`, everything else→`summary`.

`switchToSummary()` — preserves `movers→summary-movers` and `alerts→summary-alerts`; everything else becomes `summary`.

`switchPortfolio(id)` — resets: `summary*/archive-summary/bonds/bond-summary/global-weight → main`; `summary-movers → market`; `summary-alerts → alerts`; `movers` is kept only for watchlist portfolios.

---

## Sort State

Sort is per portfolio type (active vs archive), not per portfolio:
- `getSortKey()` / `getSortDir()` — read correct state based on `_isArc()`
- `setSortState(key, dir)` — writes to `pt_sort` (active) or `pt_sort_arc` (archive)
- Third click on a column header resets to insertion order (`sortKey = null`)

Always use `getSortKey()` / `getSortDir()` in render code — never read `sortKey` / `sortDir` directly.

---

## Cloud Storage

### Pattern
Every data-mutating function must call:
```javascript
if (getCloudBackend() === 'kv') cloudSaveKV(); else cloudSave();
```
Never call `cloudSave()` directly — it silently skips KV backend users.

### JSONBin
Direct browser → JSONBin API. Master key in `pt_jbkey`, bin ID in `pt_jbbin` (auto-created on first save).

### Cloudflare KV
Browser → Worker (`/api/kv` GET/PUT) → KV namespace. User's key in `pt_kv_key`. KV namespace bound as `PORTFOLIO_KV` in `wrangler.toml` with the namespace ID present.

Worker CORS (OPTIONS handler): `Allow-Methods: GET, PUT, POST, OPTIONS`; `Allow-Headers: X-API-Token, X-KV-Key, Content-Type`. Both headers are required for the KV PUT to pass CORS preflight.

### Encryption
AES-GCM 256-bit, client-side. PBKDF2 key derivation (100K iterations, SHA-256). Random salt + IV per save. Cloud stores `{ encrypted: "base64..." }`. Worker never sees plaintext. Password stored in `pt_enc_key` (localStorage).

---

## FX Rate Caching

`fetchFxRate(baseUrl, token, ticker)` fetches via the worker's `/api/quote` endpoint. Results are cached in `fxRateCache` for 5 minutes. In-flight requests are deduplicated via `fxRateInflight` so concurrent callers (e.g. summary rendering multiple portfolios) share one network request.

---

## Chart Implementation

`loadChartData(range)` — single portfolio total value line. `loadPositionsChartData(range, selectedTickers)` — per-ticker multi-line.

**Common x-axis alignment:** all lines use `allDates` (union of all tickers' dates). Newer tickers have `null` values before their first date. Lines are rendered as multiple polyline segments (split on nulls). This prevents newer tickers from appearing stretched across the full chart width.

**Today's point:** `addTodayPoint(points, p)` appends a current-price point when the last historical date differs from today. Uses `getChartCurrentPrice(p)` which respects `currentMode` — must not use `p.current` directly.

**1D range:** uses `interval=5m` (~78 intraday points). No caching. No today's point. X-axis shows HH:MM local time.

**Cache:** `chart_hist_{ticker}_{range}` in localStorage, daily TTL.

---

## Bonds & Deposits

Bond and deposit portfolios share the `bondPortfolios` object and `pt_bond_portfolios` storage key. The `type` field (`'bond'` | `'deposit'`) distinguishes them.

**Bond positions** (qty=0 allowed for watchlist): `{ id, bondId, bondName, purchaseDate, qty, cleanPrice, accruedInterest }`. qty=0 positions are excluded from totals and switcher counts but show RETURN and ANN.YIELD.

**Deposit positions:** `{ id, name, openDate, termMonths, rate, amount, depositType, freqPerYear }`. `depositType`: `'at-maturity'` | `'regular-payouts'` | `'compounded'`.

**Bond DB** (`bondsDb`, `pt_bonds_db`): shared across all bond portfolios. Inline edit controlled by `editingBondDbId` (bond's string id, not array index).

---

## Position Classification

`category`, `region`, `sector` are selected from per-field dictionaries (`catDict`, `regDict`, `secDict`), stored in `pt_cat_dict`, `pt_reg_dict`, `pt_sec_dict`. Free text is not allowed. When adding a position, the app searches all portfolios (including archive/watchlist) for the same ticker and inherits classification values if found.

---

## Partial Sell

`sellPosition(id)` opens a modal (not `prompt()`). `confirmSell(id)`:
- Full sell: mark position sold in place
- Partial sell: replace with two records (sold portion + remainder)

Floating-point safety: `Math.round((pos.qty - qtyInput) * 1e10) / 1e10`.

---

## Move / Archive

`moveToPortfolio` and `moveToArchive` explicitly copy all fields including `category`, `region`, `sector`, `note`, `alerts`, `previousClose`, `regularMarketPrice`, `marketState`, `priceType`. Forgetting any of these causes silent data loss.

---

## Things Not to Break

1. **`sw.js` version** must increment whenever `index.html`, `manifest.json`, or `icon-192.png` changes
2. **Cloud save pattern** — always branch on `getCloudBackend()`, never call `cloudSave()` directly
3. **Sort state** — always use `getSortKey()` / `getSortDir()`, never read globals directly
4. **Chart x-axis** — all lines in `renderMultiChart` must have equal-length values arrays (nulls for missing dates)
5. **`addTodayPoint`** uses `getChartCurrentPrice(p)` (respects `currentMode`), not `p.current`
6. **Bond switcher count** — filter `qty > 0` for bond portfolios (qty=0 = watchlist, not counted)
7. **Move/Archive** — copy all position fields explicitly (see above)
8. **Worker CORS** — OPTIONS handler must include `PUT` in Allow-Methods and `X-KV-Key, Content-Type` in Allow-Headers
