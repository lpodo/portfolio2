// core.js — stable, separable layer for Portfolio Terminal.
//
// Holds the parts that change rarely and don't touch rendering/DOM, split out
// of index.html for readability. Not just "low-level primitives" — any code
// that is naturally separable (no render/DOM dependency) and stable lives here:
//   • data migrations (position/ticker split chain + dict seeding)
//   • ticker & position accessors (getTicker*/setTicker*/getPosition*)
//   • ISIN helpers (isKnownIsin, ISIN_UNRESOLVED_MARKER)
//   • formatters (f2/fSign/fPct/fmtK, todayLocalISO)
//   • portfolio/broker accessors (currentPortfolio, getCurrency, get*Broker)
//   • local storage primitives (get/savePortfolios, *TickerDataLS, saveDicts…)
//   • network primitives (fetchFxRate, fetchIsin)
//   • position filtering (filterActive/filterPositions/applyFilter…)
//   • aggregation & market totals (aggregatePositions, computeUsdMarketTotal…)
//
// Loaded before fundamentals.js and the main index.html script, so every
// definition here is available to both. This is a shared-globals split (ES5,
// no modules): everything lives in one global scope — no import/export. Code
// here may read globals and call functions that still live in index.html
// (portfolios, tickerData, activeFilter, closeMode, save*, getHistoricalClose…);
// that's safe because all of it runs after both files have loaded (from the
// window 'load' handler and event callbacks), never at parse time.

// ── Data migrations ─────────────────────────────────────────────────────────
// When cloud payload contains legacy `tickerAlerts` (flat) but not `tickerData`,
// merge the alerts into the nested structure. Used by all cloud/backup readers.
function migrateLegacyTickerAlertsFromCloud(data) {
  if (!data) return;
  if (data.tickerData && typeof data.tickerData === 'object') {
    tickerData = data.tickerData;
  } else {
    tickerData = {};
  }
  if (data.tickerAlerts && typeof data.tickerAlerts === 'object') {
    Object.keys(data.tickerAlerts).forEach(function(t) {
      var arr = data.tickerAlerts[t];
      if (arr && arr.length) {
        if (!tickerData[t]) tickerData[t] = {};
        if (!tickerData[t].alerts) tickerData[t].alerts = arr;
      }
    });
  }
}
function newAlertId() {
  return String(Date.now()) + '_' + Math.random().toString(36).slice(2, 8);
}
function initPortfolios() {
  portfolios = getPortfolios();
  // Migrate legacy data (pt_v3) into default portfolio if no portfolios exist
  if (Object.keys(portfolios).length === 0) {
    var legacy = [];
    try { legacy = JSON.parse(localStorage.getItem('pt_v3') || '[]'); } catch(e) {}
    var id = 'p_' + Date.now();
    portfolios[id] = { name: 'MY PORTFOLIO', positions: legacy };
    savePortfolios();
  }
  // Load ticker-level alerts from localStorage
  loadTickerDataLS();
  // Lift any position-level category/region/sector into tickerData and strip
  // them from positions. Idempotent and cheap — safe to run every startup;
  // this also cleans up stray null attribute keys left by older versions.
  liftAttrsFromPositions();
  migrateSoldPositions();
  migrateMetaToTicker();
  migrateNotesToTicker();
  stripMigratedFieldsFromPositions();
  stripNullPositionFields();
  // Restore last active portfolio
  currentPortfolioId = localStorage.getItem('pt_current');
  if (!currentPortfolioId || !portfolios[currentPortfolioId]) {
    currentPortfolioId = Object.keys(portfolios)[0];
  }
}
// The actual lift+strip, reusable for both LS init and cloud loads. Idempotent:
// if positions carry no attribute fields (already migrated), it does nothing.
// A field is stripped whenever it's PRESENT on the position — including when
// its value is null (older positions stored empty attrs as null; a truthy
// guard would leave those null keys behind and they'd show up in backups).
// The value is lifted into tickerData only when it's actually meaningful.
function liftAttrsFromPositions() {
  var changed = false;
  Object.keys(portfolios).forEach(function(pid) {
    (portfolios[pid].positions || []).forEach(function(pos) {
      ['category', 'region', 'sector'].forEach(function(f) {
        if (f in pos) {
          if (pos[f] && !getTickerAttr(pos.ticker, f)) setTickerAttr(pos.ticker, f, pos[f]);
          delete pos[f];
          changed = true;
        }
      });
    });
  });
  if (changed) {
    saveTickerDataLS();
    savePortfolios();
  }
}

// Migration: give existing sold positions their own sellPrice and sellCurrency
// (frozen at sale). Historically a sold position stored the sale price in
// `current` and shared `currency`; these move to dedicated fields so the sale
// stays historically correct regardless of later ticker changes. Idempotent —
// only fills a field that's absent, so it's safe to run every startup and after
// every cloud load (self-healing). Runs BEFORE stripMigratedFieldsFromPositions
// so the old `current` is converted to sellPrice before it's deleted.
function migrateSoldPositions() {
  var changed = false;
  Object.keys(portfolios).forEach(function(pid) {
    var ownerBase = (portfolios[pid].currencyCode || 'USD');
    (portfolios[pid].positions || []).forEach(function(pos) {
      if (!pos.sold) return;
      if (!('sellPrice' in pos)) {
        pos.sellPrice = (pos.current != null ? pos.current : null);
        changed = true;
      }
      if (!('sellCurrency' in pos)) {
        pos.sellCurrency = pos.currency || ownerBase;
        changed = true;
      }
    });
  });
  if (changed) savePortfolios();
}

// Migration: physically remove migrated fields from position objects.
// current/currency/metadata now live in tickerData and are read via helpers;
// the copies left on positions are dead weight. Safe-guard: before deleting a
// field, ensure its value is preserved in tickerData (self-sufficient — does
// not rely on migrateMetaToTicker having run first). Sold positions keep their
// frozen sellPrice/sellCurrency; their dead current/currency are removed too.
// Idempotent: only touches fields that are physically present.
var STRIP_POSITION_FIELDS = ['current', 'currency', 'shortName', 'instrumentType', 'exchangeName', 'marketState', 'priceType', 'regularMarketPrice', 'previousClose'];
function stripMigratedFieldsFromPositions() {
  var changed = false;
  Object.keys(portfolios).forEach(function(pid) {
    (portfolios[pid].positions || []).forEach(function(pos) {
      // Preserve into tickerData before stripping (active positions only — a
      // sold position's current/currency are its historical sale values, held
      // in sellPrice/sellCurrency, and must not seed the live ticker).
      if (!pos.sold) {
        STRIP_POSITION_FIELDS.forEach(function(f) {
          if (pos[f] != null && getTickerMeta(pos.ticker, f) == null) {
            setTickerMeta(pos.ticker, f, pos[f]);
          }
        });
      }
      STRIP_POSITION_FIELDS.forEach(function(f) {
        if (f in pos) { delete pos[f]; changed = true; }
      });
    });
  });
  if (changed) {
    saveTickerDataLS();
    savePortfolios();
  }
}

// Migration: remove optional position fields that are present but empty/null
// (note, purchaseDate, broker). Older edits stored a cleared field as null;
// add and the current edit path omit it entirely. This normalizes existing
// records so a position carries only real data — consistent across
// localStorage, cloud, and backups. Idempotent: only touches keys that are
// present AND empty; real values are never removed.
var NULLABLE_POSITION_FIELDS = ['purchaseDate', 'broker'];
function stripNullPositionFields() {
  var changed = false;
  Object.keys(portfolios).forEach(function(pid) {
    (portfolios[pid].positions || []).forEach(function(pos) {
      NULLABLE_POSITION_FIELDS.forEach(function(f) {
        if (f in pos && !pos[f]) { delete pos[f]; changed = true; }
      });
    });
  });
  if (changed) savePortfolios();
}

// Migration: copy ticker-level market metadata (plus current/currency, active
// positions only) from positions into tickerData. Idempotent — only fills a
// tickerData field that's absent, so repeated runs (startup + after each cloud
// load) are safe. Deletion of the now-dead position copies is handled
// separately by stripMigratedFieldsFromPositions. Uses the last-seen position
// value per ticker (they're all the same ticker, so any is fine; later
// positions don't overwrite an already-set tickerData value).
var TICKER_META_FIELDS = ['shortName', 'instrumentType', 'exchangeName', 'marketState', 'priceType', 'regularMarketPrice', 'previousClose'];
function migrateMetaToTicker() {
  Object.keys(portfolios).forEach(function(pid) {
    (portfolios[pid].positions || []).forEach(function(pos) {
      TICKER_META_FIELDS.forEach(function(f) {
        if (pos[f] != null && getTickerMeta(pos.ticker, f) == null) {
          setTickerMeta(pos.ticker, f, pos[f]);
        }
      });
      // current is ticker-level too, but only an ACTIVE position's current is
      // the market price. A sold position's current is its sale price (now in
      // sellPrice), so it must not seed tickerData.current.
      if (!pos.sold && pos.current != null && getTickerMeta(pos.ticker, 'current') == null) {
        setTickerMeta(pos.ticker, 'current', pos.current);
      }
      // currency is ticker-level; only an active position's currency is the
      // live ticker currency. A sold position freezes its own sellCurrency, so
      // it must not seed tickerData.currency.
      if (!pos.sold && pos.currency != null && getTickerMeta(pos.ticker, 'currency') == null) {
        setTickerMeta(pos.ticker, 'currency', pos.currency);
      }
    });
  });
  saveTickerDataLS();
}

// Notes were originally per-position, but a note like "sell at 300" describes
// the ticker, not one lot — and in aggregated view there was no lot to attach
// it to. Move every position note up to the ticker (concatenating when several
// lots of the same ticker carried notes) and drop the key from positions.
// Idempotent: after the first run no position has a note key, so re-runs no-op.
function migrateNotesToTicker() {
  var changed = false;
  Object.keys(portfolios).forEach(function(pid) {
    (portfolios[pid].positions || []).forEach(function(pos) {
      if (!('note' in pos)) return;
      var n = pos.note;
      if (n) {
        var existing = getTickerAttr(pos.ticker, 'note');
        setTickerAttr(pos.ticker, 'note', existing ? existing + ' • ' + n : n);
      }
      delete pos.note;
      changed = true;
    });
  });
  if (changed) { saveTickerDataLS(); savePortfolios(); }
}

// ── Alerts (thin wrappers over tickerData[ticker].alerts) ───────────────────
function getTickerAlerts(ticker) {
  if (!ticker) return [];
  var d = tickerData[ticker];
  return (d && d.alerts && d.alerts.length) ? d.alerts : [];
}
function setTickerAlerts(ticker, arr) {
  if (!ticker) return;
  if (arr && arr.length) {
    if (!tickerData[ticker]) tickerData[ticker] = {};
    tickerData[ticker].alerts = arr;
  } else if (tickerData[ticker]) {
    delete tickerData[ticker].alerts;
    if (!Object.keys(tickerData[ticker]).length) delete tickerData[ticker];
  }
}
function addTickerAlert(ticker, alertObj) {
  if (!ticker || !alertObj) return;
  if (!tickerData[ticker]) tickerData[ticker] = {};
  if (!tickerData[ticker].alerts) tickerData[ticker].alerts = [];
  tickerData[ticker].alerts.push(alertObj);
}
function removeTickerAlert(ticker, id) {
  if (!ticker || !tickerData[ticker] || !tickerData[ticker].alerts) return;
  tickerData[ticker].alerts = tickerData[ticker].alerts.filter(function(a) { return a.id !== id; });
  if (!tickerData[ticker].alerts.length) {
    delete tickerData[ticker].alerts;
    if (!Object.keys(tickerData[ticker]).length) delete tickerData[ticker];
  }
}
// ── Ticker-level attributes: category / region / sector ────────────────────
// These describe the security, not the trade, so they live on the ticker
// (like isin/alerts) rather than being copied across every position. One
// ticker → one value, shared by all its positions in every portfolio.
function getTickerAttr(ticker, field) {
  if (!ticker) return null;
  var d = tickerData[ticker];
  return (d && d[field]) || null;
}
function setTickerAttr(ticker, field, val) {
  if (!ticker) return;
  var v = val && String(val).trim();
  if (v) {
    if (!tickerData[ticker]) tickerData[ticker] = {};
    tickerData[ticker][field] = v;
  } else if (tickerData[ticker]) {
    delete tickerData[ticker][field];
    if (!Object.keys(tickerData[ticker]).length) delete tickerData[ticker];
  }
}

// Raw grouping value for the "simple" ticker-level rubrics — category, region,
// sector. These are the only rubrics routed here; currency/exchange/broker/isin
// need special handling (fallbacks, 'default' label, ISIN→country) and are
// resolved by dedicated branches at the analytics call sites instead.
function rubricRawValue(p, rubric) {
  return getTickerAttr(p.ticker, rubric);
}

// Ticker-level market metadata from Yahoo (shortName, instrumentType,
// exchangeName, marketState, priceType, regularMarketPrice, previousClose).
// Unlike getTickerAttr/setTickerAttr (which trim strings for hand-typed
// cat/reg/sec), these store the value verbatim — Yahoo data isn't edited, and
// numeric fields (regularMarketPrice/previousClose) must not be stringified.
// null/undefined clears the field; empty tickerData entry is pruned.
function getTickerMeta(ticker, field) {
  if (!ticker) return null;
  var d = tickerData[ticker];
  return (d && d[field] != null) ? d[field] : null;
}
function setTickerMeta(ticker, field, val) {
  if (!ticker) return;
  if (val != null) {
    if (!tickerData[ticker]) tickerData[ticker] = {};
    tickerData[ticker][field] = val;
  } else if (tickerData[ticker]) {
    delete tickerData[ticker][field];
    if (!Object.keys(tickerData[ticker]).length) delete tickerData[ticker];
  }
}

// Current price of a ticker (ticker-level — alerts etc. test against it).
// Reads from tickerData via the meta accessor.
function getTickerCurrentPrice(ticker) {
  return getTickerMeta(ticker, 'current');
}

// ── ISIN (thin wrappers over tickerData[ticker].isin) ──────────────────────
// Three states: string ISIN | 'UNRESOLVED*' marker | absent (falsy).
// Yahoo lookup fires only when falsy — UNRESOLVED and known ISIN don't re-query.
function getTickerIsin(ticker) {
  if (!ticker) return undefined;
  var d = tickerData[ticker];
  return d ? d.isin : undefined;
}
function setTickerIsin(ticker, v) {
  if (!ticker) return;
  if (v) {
    if (!tickerData[ticker]) tickerData[ticker] = {};
    tickerData[ticker].isin = v;
  } else if (tickerData[ticker]) {
    delete tickerData[ticker].isin;
    if (!Object.keys(tickerData[ticker]).length) delete tickerData[ticker];
  }
}
// True when v is a real ISIN string, not a "we tried" marker. Any string
// starting with 'UNRESOLVED' is treated as a marker — the current one is
// the bare 'UNRESOLVED'; any future provider-specific variant (e.g.
// 'UNRESOLVED_V2') is covered by the same prefix check.
// The marker records "lookup ran, no ISIN found" so refreshTicker won't
// re-query it every time. Global so both the add flow and refreshTicker write
// the same value.
var ISIN_UNRESOLVED_MARKER = 'UNRESOLVED';
function isKnownIsin(v) {
  return !!(v && typeof v === 'string' && v.length >= 2 && v.indexOf('UNRESOLVED') !== 0);
}

// True if the position is an equity or ETF — the only instrument types
// that carry meaningful company-level metadata (CAT/REG/SEC/ISIN). Everything
// else (indices, futures, crypto, currencies, options) has no such meta:
// their CAT/REG/SEC/ISIN rows are hidden in expanded views, and ISIN
// lookups are skipped. Returns false while instrumentType is unknown (never
// refreshed yet) — the safe default; one Yahoo refresh fixes the state.
function isRealSecurity(p) {
  var t = getPositionInstrumentType(p);
  return t === 'EQUITY' || t === 'ETF';
}

// ── Position accessors ──────────────────────────────────────────────────────
// Currency of a position. A sold position keeps its frozen sellCurrency; an
// active one reads the ticker-level currency from tickerData. Optional
// fallbackCode lets cross-portfolio callers pass the OWNER portfolio's currency
// (not the current one); the fallback chain (fallbackCode → current portfolio →
// USD) guards the case where the ticker has no currency yet (added offline /
// before first refresh, or a legacy record). Single-portfolio callers omit it.
function getPositionCurrencySymbol(pos, fallbackCode) {
  var code = getPositionCurrencyCode(pos, fallbackCode);
  return CURRENCY_SYMBOLS[code] || code;
}
function getPositionCurrencyCode(pos, fallbackCode) {
  if (pos.sold && pos.sellCurrency) return pos.sellCurrency;
  return getTickerMeta(pos.ticker, 'currency') || fallbackCode || currentPortfolio().currencyCode || 'USD';
}
// Price of a position for display and P&L math. A sold position reports its
// frozen sellPrice (with a legacy fallback to pos.current for records migrated
// before sellPrice existed); an active one reads the ticker-level current from
// tickerData. Returns null when no price is available.
function getPositionCurrent(pos) {
  if (!pos) return null;
  if (pos.sold) {
    if (pos.sellPrice != null) return pos.sellPrice;
    return pos.current != null ? pos.current : null; // fallback: un-migrated sold
  }
  return getTickerMeta(pos.ticker, 'current');
}
// Market-data fields describing the ticker's live/last state. These are
// meaningful only for active positions — sold positions never consult them
// (callers gate on p.sold first, or show a distinct sold icon). They read the
// ticker-level values from tickerData; no sold branch is needed by design.
function getPositionRegularMarketPrice(pos) {
  return pos ? getTickerMeta(pos.ticker, 'regularMarketPrice') : null;
}
function getPositionPreviousClose(pos) {
  return pos ? getTickerMeta(pos.ticker, 'previousClose') : null;
}
function getPositionMarketState(pos) {
  return pos ? getTickerMeta(pos.ticker, 'marketState') : null;
}
function getPositionPriceType(pos) {
  return pos ? getTickerMeta(pos.ticker, 'priceType') : null;
}
// Descriptive ticker metadata (company name, instrument kind, listing venue).
// Like the market-data fields, these describe the ticker, not the trade, and
// read the ticker-level values from tickerData.
function getPositionShortName(pos) {
  return pos ? getTickerMeta(pos.ticker, 'shortName') : null;
}
function getPositionInstrumentType(pos) {
  return pos ? getTickerMeta(pos.ticker, 'instrumentType') : null;
}
function getPositionExchange(pos) {
  return pos ? getTickerMeta(pos.ticker, 'exchangeName') : null;
}

// Dict migration: seed cat/reg/sec dictionaries from existing tickerData
// (one-time, keyed on absence of pt_cat_dict).
function migrateDicts() {
  if (localStorage.getItem('pt_cat_dict') !== null) return;
  Object.keys(tickerData).forEach(function(t) {
    var d = tickerData[t];
    if (d.category) addToDict(catDict, d.category);
    if (d.region)   addToDict(regDict, d.region);
    if (d.sector)   addToDict(secDict, d.sector);
  });
  saveDicts();
}

// ── Formatters ──────────────────────────────────────────────────────────────
// YYYY-MM-DD in local timezone, used as default purchaseDate for new positions
function todayLocalISO() {
  return new Date().toLocaleDateString('en-CA');
}
function f2(n) {
  if (n === null || n === undefined || isNaN(n)) return '&mdash;';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fSign(n) {
  if (n === null || n === undefined || isNaN(n)) return '&mdash;';
  return (n >= 0 ? '+' : '') + f2(n);
}
function fPctNoSign(n) {
  if (n === null || n === undefined || isNaN(n)) return '&mdash;';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
}
function fPct(n) {
  if (n === null || n === undefined || isNaN(n)) return '&mdash;';
  return (n >= 0 ? '+' : '') + f2(n) + '%';
}
function fmtK(v) {
  if (Math.abs(v) >= 1000000) return (v / 1000000).toFixed(2) + 'M';
  if (Math.abs(v) >= 1000) return (v / 1000).toFixed(1) + 'K';
  return v.toFixed(0);
}

// ── Portfolio / broker accessors ────────────────────────────────────────────
function currentPortfolio() {
  return portfolios[currentPortfolioId] || { name: 'MY PORTFOLIO', positions: [] };
}
function getCurrency() {
  var p = currentPortfolio();
  var code = p.currencyCode || 'USD';
  return CURRENCY_SYMBOLS[code] || code;
}
function getDefaultBroker() {
  if (_defaultBroker && brokerDict.indexOf(_defaultBroker) !== -1) return _defaultBroker;
  return brokerDict[0] || null;
}
function getPositionBroker(p) {
  return p.broker || getDefaultBroker();
}

// ── Local storage primitives ─────────────────────────────────────
function getPortfolios() {
  try { return JSON.parse(localStorage.getItem('pt_portfolios') || '{}'); } catch(e) { return {}; }
}
function savePortfolios() {
  try { localStorage.setItem('pt_portfolios', JSON.stringify(portfolios)); } catch(e) {}
}
// Loads from new key; one-time migration from legacy pt_ticker_alerts (flat
// { ticker: [alerts] } shape) into new nested { ticker: { alerts: [...] } }.
// Migration is destructive on the LS side — after successful move, the old
// key is deleted so subsequent loads skip this path.
function loadTickerDataLS() {
  try { tickerData = JSON.parse(localStorage.getItem('pt_ticker_data') || '{}'); } catch(e) { tickerData = {}; }
  // One-time migration from legacy per-ticker alerts key
  try {
    var legacyRaw = localStorage.getItem('pt_ticker_alerts');
    if (legacyRaw) {
      var legacy = JSON.parse(legacyRaw);
      Object.keys(legacy || {}).forEach(function(t) {
        var arr = legacy[t];
        if (arr && arr.length) {
          if (!tickerData[t]) tickerData[t] = {};
          if (!tickerData[t].alerts) tickerData[t].alerts = arr;
        }
      });
      localStorage.removeItem('pt_ticker_alerts');
      saveTickerDataLS();
    }
  } catch(e) {}
}
function saveTickerDataLS() {
  try { localStorage.setItem('pt_ticker_data', JSON.stringify(tickerData)); } catch(e) {}
}
function saveLocal() {
  portfolios[currentPortfolioId].positions = positions;
  savePortfolios();
}
function saveDicts() {
  try { localStorage.setItem('pt_cat_dict', JSON.stringify(catDict)); } catch(e) {}
  try { localStorage.setItem('pt_reg_dict', JSON.stringify(regDict)); } catch(e) {}
  try { localStorage.setItem('pt_sec_dict', JSON.stringify(secDict)); } catch(e) {}
  try { localStorage.setItem('pt_cash_cat_dict', JSON.stringify(cashCatDict)); } catch(e) {}
  try { localStorage.setItem('pt_broker_dict', JSON.stringify(brokerDict)); } catch(e) {}
  try {
    if (_defaultBroker) localStorage.setItem('pt_default_broker', _defaultBroker);
    else localStorage.removeItem('pt_default_broker');
  } catch(e) {}
}
function addToDict(dict, value) {
  value = String(value).trim();
  if (!value) return;
  for (var i = 0; i < dict.length; i++) { if (dict[i] === value) return; }
  dict.push(value);
  dict.sort(function(a, b) { return a.localeCompare(b); });
}

// The ALL POSITIONS sets store (top-level, unlike portfolio sets which live
// inside the portfolio object and are saved along with it).
function loadAllPositionSetsLS() {
  try {
    var v = JSON.parse(localStorage.getItem('pt_all_sets'));
    if (v && typeof v.length === 'number') allPositionSets = v;
  } catch(e) {}
}
function saveAllPositionSetsLS() {
  try { localStorage.setItem('pt_all_sets', JSON.stringify(allPositionSets)); } catch(e) {}
}

// ── Network primitives ──────────────────────────────────────────
function fetchFxRate(baseUrl, token, ticker) {
  var now = Date.now();
  var cached = fxRateCache[ticker];
  if (cached && (now - cached.ts) < FX_CACHE_TTL) {
    return Promise.resolve(cached.rate);
  }
  // Return existing in-flight promise if one exists
  if (fxRateInflight[ticker]) return fxRateInflight[ticker];
  var url = baseUrl + '/api/quote?ticker=' + encodeURIComponent(ticker);
  var opts = token ? { headers: { 'X-API-Token': token } } : {};
  var p = fetch(url, opts).then(function(r) { return r.json(); }).then(function(d) {
    delete fxRateInflight[ticker];
    if (d.price) fxRateCache[ticker] = { rate: d.price, ts: Date.now() };
    return d.price || null;
  }).catch(function() { delete fxRateInflight[ticker]; return null; });
  fxRateInflight[ticker] = p;
  return p;
}
// Fetch ISIN for a ticker via the worker's /api/isin endpoint. Currently the
// worker returns { isin: null } for everything — no free provider supplies
// ISIN data (see worker comment). The pipeline stays intact so users can
// enter ISINs manually and a real provider can be wired into the worker
// later without touching the frontend. Returns the ISIN string on success,
// null when unavailable, or throws on network/HTTP errors.
function fetchIsin(ticker) {
  if (!ticker) return Promise.resolve(null);
  var baseUrl = getApiKey();
  if (!baseUrl) return Promise.reject(new Error('no_key'));
  baseUrl = baseUrl.replace(/\/+$/, '');
  var token = getToken();
  var url = baseUrl + '/api/isin?ticker=' + encodeURIComponent(ticker);
  var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var timer = controller ? setTimeout(function() { controller.abort(); }, 15000) : null;
  var opts = controller ? { signal: controller.signal } : {};
  if (token) opts.headers = { 'X-API-Token': token };
  return fetch(url, opts).then(function(r) {
    if (timer) clearTimeout(timer);
    if (!r.ok) throw new Error('http_' + r.status);
    return r.json();
  }).then(function(data) {
    if (!data || data.error) return null;
    return data.isin || null;
  });
}

// ── Position filter ────────────────────────────────────────
// A global, persisted filter for REGULAR ACTIVE portfolios. When active it
// restricts which positions are shown AND which an aggregate operation acts on.
// applyFilter is the single choke point — every display/operation path routes
// its position list through it, so adding a view or a condition needs no new
// wiring here. The activeFilter state itself lives in index.

// True when the filter should apply in the current individual-portfolio
// context: a filter is set AND the current portfolio is a regular active one
// (not watchlist, not archive).
function filterActive() {
  if (!activeFilter) return false;
  var pf = currentPortfolio();
  return !!pf && !pf.archive && !pf.watchlist;
}
// True when the filter should apply to a cross-portfolio view (ALL POSITIONS /
// Σ SUMMARY). Same global filter, but the gate is the view — active summaries
// filter, realized (archive) summaries don't. Callers pass whether the current
// summary context is the realized one.
function filterActiveForSummary(isRealized) {
  return !!activeFilter && !isRealized;
}
// Pure filter: reduce a position array to the filter's SET, with NO context
// gate. Each active condition is a FULL predicate — including its own base
// requirement — and predicates combine by AND (a position must satisfy every
// active condition). Only conditions present in activeFilter apply.
//   • purchaseDateFrom → entry != 0 AND purchaseDate present AND >= threshold
//       (a qty-0 lot with an entry is a fully-sold buy; its date still matters)
//   • broker           → qty != 0 AND getPositionBroker(p) === broker
//       (broker is meaningless for a qty-0 lot, so it's excluded here)
// This DEFINES the working set; each view then applies its own logic on top —
// identical for individual portfolios and cross-portfolio views. Extensible:
// new conditions slot in as further AND predicates.
function filterPositions(posns) {
  if (!activeFilter) return posns;
  return posns.filter(function(p) {
    if (activeFilter.purchaseDateFrom) {
      if (!p.entry) return false;
      if (!p.purchaseDate) return false;
      if (p.purchaseDate < activeFilter.purchaseDateFrom) return false;
    }
    if (activeFilter.broker) {
      if (!(p.qty !== 0)) return false;
      if (getPositionBroker(p) !== activeFilter.broker) return false;
    }
    return true;
  });
}
// Individual-view filter: gate on the current portfolio, then filter.
function applyFilter(posns) {
  if (!filterActive()) return posns;
  return filterPositions(posns);
}
// True if any condition is actually set (drives the lit filter icon).
function hasActiveFilter() {
  return !!(activeFilter && (activeFilter.purchaseDateFrom || activeFilter.broker));
}

// ── Position aggregation & market totals ────────────────────────
// Data transforms that prepare positions for the views (group by ticker,
// weighted-average an aggregate, sum a market total in USD). No rendering.
function aggregatePositions(posns) {
  // Build maps: active by ticker, sold by ticker; qty=0 kept as-is
  var activeMap = {}, soldMap = {};
  posns.forEach(function(p) {
    if (!p.sold && p.qty > 0) {
      if (!activeMap[p.ticker]) activeMap[p.ticker] = [];
      activeMap[p.ticker].push(p);
    } else if (p.sold) {
      if (!soldMap[p.ticker]) soldMap[p.ticker] = [];
      soldMap[p.ticker].push(p);
    }
  });

  // Build aggregated entries
  function makeEntry(group, isSold) {
    if (group.length === 1) return { agg: false, pos: group[0] };
    var totalQty = 0, totalCost = 0, totalSell = 0;
    group.forEach(function(p) { totalQty += p.qty; totalCost += p.qty * p.entry; if (isSold) totalSell += p.qty * getPositionCurrent(p); });
    var avgSell = totalQty > 0 ? totalSell / totalQty : 0;
    var rep = Object.assign({}, group[0], {
      qty: totalQty,
      entry: totalQty > 0 ? totalCost / totalQty : 0,
      current: isSold ? avgSell : getPositionCurrent(group[0])
    });
    if (isSold) {
      // Aggregate reads its price via the sold branch, so give it a real
      // sellPrice (weighted-average sale price) instead of relying on the
      // current-fallback. sellCurrency is frozen per ticker (same for the group).
      rep.sellPrice = avgSell;
      rep.sellCurrency = group[0].sellCurrency || getPositionCurrencyCode(group[0]);
    }
    return { agg: true, count: group.length, pos: rep, group: group };
  }

  // Emit in the order of first appearance in posns
  var seen = {}, result = [];
  posns.forEach(function(p) {
    if (!p.sold && p.qty === 0) {
      result.push({ agg: false, pos: p });
    } else if (!p.sold && p.qty > 0) {
      var key = 'a:' + p.ticker;
      if (!seen[key]) { seen[key] = true; result.push(makeEntry(activeMap[p.ticker], false)); }
    } else if (p.sold) {
      var key2 = 's:' + p.ticker;
      if (!seen[key2]) { seen[key2] = true; result.push(makeEntry(soldMap[p.ticker], true)); }
    }
  });
  return result;
}
// Shared USD market-total accumulator: sums a position array into USD close/
// current values using the same price logic as the per-portfolio summary
// (sold freezes at sellPrice; closeMode/currentMode pick close/current price).
// fxRates maps currency→USD. Returns { closeUSD, currentUSD, hasAny }. Reused
// by Σ SUMMARY (per-portfolio) and All Positions MARKET (whole set).
function computeUsdMarketTotal(posns, fxRates) {
  var closeUSD = 0, currentUSD = 0, hasAny = false;
  (posns || []).forEach(function(pos) {
    var pcur = getPositionCurrent(pos);
    if (pcur == null || !(pos.qty > 0)) return;
    var pc = getPositionCurrencyCode(pos);
    var rateToUSD = pc === 'USD' ? 1 : (fxRates[pc] || fxRates[pc + 'USD'] || 1);
    var closePrice = pos.sold ? pcur : (HIST_MODES.indexOf(closeMode) !== -1 ? (getHistoricalClose(pos.ticker, closeMode) || getPositionRegularMarketPrice(pos) || pcur) : (closeMode === 'prev' ? (getPositionPreviousClose(pos) || getPositionRegularMarketPrice(pos) || pcur) : (getPositionRegularMarketPrice(pos) || pcur)));
    var curPrice = pos.sold ? pcur : (currentMode === 'reg' ? (getPositionRegularMarketPrice(pos) || pcur) : pcur);
    closeUSD += pos.qty * closePrice * rateToUSD;
    currentUSD += pos.qty * curPrice * rateToUSD;
    hasAny = true;
  });
  return { closeUSD: closeUSD, currentUSD: currentUSD, hasAny: hasAny };
}

// ── Position sorting ────────────────────────────────────────
// Pure data sorts (return ordered arrays). Read sort-state globals from index.
function getSortKey() { return _isArc() ? archiveSortKey : sortKey; }
function getSortDir() { return _isArc() ? archiveSortDir : sortDir; }
function setSortState(key, dir) {
  if (_isArc()) { archiveSortKey = key; archiveSortDir = dir; try { localStorage.setItem('pt_sort_arc', JSON.stringify({key:key,dir:dir})); } catch(e) {} }
  else { sortKey = key; sortDir = dir; try { localStorage.setItem('pt_sort', JSON.stringify({key:key,dir:dir})); } catch(e) {} }
}
function getSorted() {
  var sortKey = getSortKey(), sortDir = getSortDir();
  var base = applyFilter(positions);
  if (!sortKey) return base.slice();
  return base.slice().sort(function(a, b) {
    var va, vb;
    if (sortKey === 'ticker') { var cmp = sortDir * a.ticker.localeCompare(b.ticker); if (cmp !== 0) return cmp; return (a.sold ? 0 : 1) - (b.sold ? 0 : 1); }
    if (sortKey === 'qty')    { va = a.qty; vb = b.qty; }
    if (sortKey === 'entry')  { va = a.entry; vb = b.entry; }
    if (sortKey === 'current'){ var ac0 = getPositionCurrent(a), bc0 = getPositionCurrent(b); va = ac0 !== null ? ac0 : -Infinity; vb = bc0 !== null ? bc0 : -Infinity; }
    if (sortKey === 'pnl')    { var ac1 = getPositionCurrent(a), bc1 = getPositionCurrent(b); va = (ac1 !== null) ? (ac1 - a.entry) * a.qty : -Infinity; vb = (bc1 !== null) ? (bc1 - b.entry) * b.qty : -Infinity; }
    if (sortKey === 'pnlpct') { var ac2 = getPositionCurrent(a), bc2 = getPositionCurrent(b); va = (ac2 !== null && a.entry) ? (ac2 - a.entry) / a.entry : -Infinity; vb = (bc2 !== null && b.entry) ? (bc2 - b.entry) / b.entry : -Infinity; }
    return sortDir * (va > vb ? 1 : va < vb ? -1 : 0);
  });
}
function getSortedForRender() {
  var sortKey = getSortKey(), sortDir = getSortDir();
  if (!isAggregated()) return getSorted().map(function(p) { return { agg: false, pos: p }; });
  // Aggregate first on unsorted positions, then sort aggregated entries.
  // Filter applies BEFORE aggregation, so ×N counts only visible lots.
  var entries = aggregatePositions(applyFilter(positions));
  if (!sortKey) return entries;
  return entries.slice().sort(function(a, b) {
    var pa = a.pos, pb = b.pos;
    var va, vb;
    if (sortKey === 'ticker') { var cmp = sortDir * pa.ticker.localeCompare(pb.ticker); if (cmp !== 0) return cmp; return (pa.sold ? 0 : 1) - (pb.sold ? 0 : 1); }
    if (sortKey === 'qty')    { va = pa.qty; vb = pb.qty; }
    if (sortKey === 'entry')  { va = pa.entry; vb = pb.entry; }
    if (sortKey === 'current'){ var pac0 = getPositionCurrent(pa), pbc0 = getPositionCurrent(pb); va = pac0 !== null ? pac0 : -Infinity; vb = pbc0 !== null ? pbc0 : -Infinity; }
    if (sortKey === 'pnl')    { var pac1 = getPositionCurrent(pa), pbc1 = getPositionCurrent(pb); va = (pac1 !== null) ? (pac1 - pa.entry) * pa.qty : -Infinity; vb = (pbc1 !== null) ? (pbc1 - pb.entry) * pb.qty : -Infinity; }
    if (sortKey === 'pnlpct') { var pac2 = getPositionCurrent(pa), pbc2 = getPositionCurrent(pb); va = (pac2 !== null && pa.entry) ? (pac2 - pa.entry) / pa.entry : -Infinity; vb = (pbc2 !== null && pb.entry) ? (pbc2 - pb.entry) / pb.entry : -Infinity; }
    return sortDir * (va > vb ? 1 : va < vb ? -1 : 0);
  });
}
function getWeightSorted(items, totVal) {
  return items.slice().sort(function(a, b) {
    var va, vb;
    if (weightSort.key === 'ticker') { va = a.ticker; vb = b.ticker; return weightSort.dir * va.localeCompare(vb); }
    if (weightSort.key === 'value') {
      var wac0 = getPositionCurrent(a), wbc0 = getPositionCurrent(b);
      va = (wac0 !== null && a.qty > 0) ? a.qty * wac0 : -Infinity;
      vb = (wbc0 !== null && b.qty > 0) ? b.qty * wbc0 : -Infinity;
    } else { // weight same as value
      var wac1 = getPositionCurrent(a), wbc1 = getPositionCurrent(b);
      va = (wac1 !== null && a.qty > 0) ? a.qty * wac1 : -Infinity;
      vb = (wbc1 !== null && b.qty > 0) ? b.qty * wbc1 : -Infinity;
    }
    return weightSort.dir * (va > vb ? 1 : va < vb ? -1 : 0);
  });
}
function getMarketSorted(items) {
  if (!marketSort.key) return items.slice(); // portfolio order
  return items.slice().sort(function(a, b) {
    var va, vb;
    if (marketSort.key === 'ticker') {
      return marketSort.dir * a.ticker.localeCompare(b.ticker);
    }
    // delta% — use previousClose same as render
    var aBase = HIST_MODES.indexOf(closeMode) !== -1 ? (getHistoricalClose(a.ticker, closeMode) || getPositionPreviousClose(a) || getPositionRegularMarketPrice(a)) : ((getPositionMarketState(a) === 'REGULAR') ? (getPositionPreviousClose(a) || getPositionRegularMarketPrice(a)) : ((closeMode === 'prev' ? getPositionPreviousClose(a) : getPositionRegularMarketPrice(a)) || getPositionRegularMarketPrice(a)));
    var bBase = HIST_MODES.indexOf(closeMode) !== -1 ? (getHistoricalClose(b.ticker, closeMode) || getPositionPreviousClose(b) || getPositionRegularMarketPrice(b)) : ((getPositionMarketState(b) === 'REGULAR') ? (getPositionPreviousClose(b) || getPositionRegularMarketPrice(b)) : ((closeMode === 'prev' ? getPositionPreviousClose(b) : getPositionRegularMarketPrice(b)) || getPositionRegularMarketPrice(b)));
    var acur = getPositionCurrent(a), bcur = getPositionCurrent(b);
    va = (acur != null && aBase) ? (acur - aBase) / aBase * 100 : null;
    vb = (bcur != null && bBase) ? (bcur - bBase) / bBase * 100 : null;
    if (marketSort.key === 'absdelta') {
      va = va !== null ? Math.abs(va) : -Infinity;
      vb = vb !== null ? Math.abs(vb) : -Infinity;
      return vb - va;
    }
    if (va === null) va = -Infinity;
    if (vb === null) vb = -Infinity;
    return marketSort.dir * (va > vb ? 1 : va < vb ? -1 : 0);
  });
}
function getWatchlistSorted(items) {
  if (!watchlistSort.key) return items.slice();
  return items.slice().sort(function(a, b) {
    if (watchlistSort.key === 'ticker') return watchlistSort.dir * a.ticker.localeCompare(b.ticker);
    var aBase = getPositionPreviousClose(a) || getPositionRegularMarketPrice(a);
    var bBase = getPositionPreviousClose(b) || getPositionRegularMarketPrice(b);
    var acur = getPositionCurrent(a), bcur = getPositionCurrent(b);
    var va = (acur != null && aBase) ? (acur - aBase) / aBase * 100 : null;
    var vb = (bcur != null && bBase) ? (bcur - bBase) / bBase * 100 : null;
    if (watchlistSort.key === 'absdelta') {
      va = va !== null ? Math.abs(va) : -Infinity;
      vb = vb !== null ? Math.abs(vb) : -Infinity;
      return vb - va;
    }
    if (va === null) va = -Infinity;
    if (vb === null) vb = -Infinity;
    return watchlistSort.dir * (va > vb ? 1 : va < vb ? -1 : 0);
  });
}


// ── View-context predicates ─────────────────────────────────
// Boolean predicates over the current view/portfolio state (globals in index).
function isWatchlist() {
  return !!(currentPortfolio().watchlist);
}
function isSummaryByPortfolio() {
  return SUMMARY_BY_PORTFOLIO_VIEWS.indexOf(viewMode) !== -1;
}
function isAllPositions() {
  return ALL_POSITIONS_VIEWS.indexOf(viewMode) !== -1;
}
function isRealizedAllPositions() {
  return REALIZED_ALL_POSITIONS_VIEWS.indexOf(viewMode) !== -1;
}
function isCrossPortfolioContext() {
  return isSummaryByPortfolio() || isAllPositions() || isRealizedAllPositions();
}
function isArchivePortfolio(p) {
  return !!(p && p.archive);
}
function isAggregated() {
  return currentPortfolio().archive ? aggregatedModeArchive : aggregatedModeActive;
}

// ── Config & misc primitives ─────────────────────────────────
function getApiKey() { return localStorage.getItem('pt_finnhub') || ''; }
function getToken() { return localStorage.getItem('pt_token') || ''; }
function _isArc() { var p = portfolios[currentPortfolioId]; return !!(p && p.archive); }

var catDict = [];
var regDict = [];
var secDict = [];
var brokerDict = [];
var _defaultBroker = null;
// Sets for the ALL POSITIONS context. Portfolio sets ride inside the portfolio
// object (and so reach the cloud for free); this one is top-level and must be
// persisted/synced explicitly.
var allPositionSets = [];

// --- Local storage ---
function loadLocal() {
  positions = currentPortfolio().positions;
}

// ── Chart price cache (localStorage, per-day) ────────────────────
function getHistoricalClose(ticker, mode) {
  var pts = chartCacheGet(ticker, mode);
  return (pts && pts.length > 0) ? pts[0].c : null;
}
function chartCacheKey(ticker, range) {
  return 'chart_hist_' + ticker + '_' + range;
}
function chartCacheGet(ticker, range) {
  var today = new Date().toISOString().slice(0, 10);
  try {
    var raw = localStorage.getItem(chartCacheKey(ticker, range));
    if (!raw) return null;
    var entry = JSON.parse(raw);
    if (entry.date !== today) return null;
    return entry.points;
  } catch(e) { return null; }
}
function chartCacheSet(ticker, range, points) {
  var today = new Date().toISOString().slice(0, 10);
  try {
    // Purge all stale chart cache entries
    var toDelete = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf('chart_hist_') === 0) {
        try {
          var e = JSON.parse(localStorage.getItem(k));
          if (e.date !== today) toDelete.push(k);
        } catch(e2) { toDelete.push(k); }
      }
    }
    toDelete.forEach(function(k) { localStorage.removeItem(k); });
    localStorage.setItem(chartCacheKey(ticker, range), JSON.stringify({ date: today, points: points }));
  } catch(e) {}
}

// ── Dictionary helpers (cat/reg/sec/broker lookups) ───────────────
// Pure lookups over the dict globals (which live in index). The mutating dict
// actions (add/remove/setDefault) stay in index — they re-render the panel.
function loadDicts() {
  try { catDict = JSON.parse(localStorage.getItem('pt_cat_dict')) || []; } catch(e) { catDict = []; }
  try { regDict = JSON.parse(localStorage.getItem('pt_reg_dict')) || []; } catch(e) { regDict = []; }
  try { secDict = JSON.parse(localStorage.getItem('pt_sec_dict')) || []; } catch(e) { secDict = []; }
  try { cashCatDict = JSON.parse(localStorage.getItem('pt_cash_cat_dict')) || []; } catch(e) { cashCatDict = []; }
  try { brokerDict = JSON.parse(localStorage.getItem('pt_broker_dict')) || []; } catch(e) { brokerDict = []; }
  try { _defaultBroker = localStorage.getItem('pt_default_broker') || null; } catch(e) { _defaultBroker = null; }
}
function countPositionsWithBroker(broker) {
  var n = 0;
  Object.keys(portfolios).forEach(function(pid) {
    (portfolios[pid].positions || []).forEach(function(pos) {
      if (pos.broker === broker) n++;
    });
  });
  return n;
}
// Lookup helpers used by the field-driven dict UI (which lives in index).
function _dictHiddenId(field) {
  return field === 'cat' ? 'editCategory'
       : field === 'reg' ? 'editRegion'
       : field === 'sec' ? 'editSector'
       : field === 'ccat' ? 'editCashCategory'
       : field === 'bro' ? 'editBroker'
       : field === 'broAdd' ? 'addBroker'
       : '';
}
function _dictRef(field) {
  return field === 'cat' ? catDict
       : field === 'reg' ? regDict
       : field === 'sec' ? secDict
       : field === 'ccat' ? cashCatDict
       : (field === 'bro' || field === 'broAdd') ? brokerDict
       : null;
}

// ── Position sets: read + per-view selection ────────────────────
// Reading sets and the chart/fundamentals selection (localStorage). The
// mutating actions (save/create/update/delete) stay in index: they go through
// the save path → cloudSave → UI status, so they are not part of the pure layer.
//
// Sets and selection are per CONTEXT, not per portfolio: a regular portfolio is
// its own context, and ALL POSITIONS is a separate cross-portfolio one with its
// own sets (allPositionSets, a top-level store) and its own selection keys.
// Without this, All Positions would silently reuse — and overwrite — the keys of
// whatever portfolio happened to be open last.
var ALL_POSITIONS_CTX = '__all__';
function getSelCtx() {
  return isAllPositions() ? ALL_POSITIONS_CTX : currentPortfolioId;
}
function getPositionSets(ctx) {
  var c = ctx || getSelCtx();
  if (c === ALL_POSITIONS_CTX) return allPositionSets || [];
  var p = portfolios[c];
  return (p && p.positionSets) ? p.positionSets : [];
}
function getChartSelectedSet() {
  // Returns 'portfolio' | setId | null
  try {
    var v = localStorage.getItem('pt_chart_set_' + getSelCtx());
    if (v) return v;
  } catch(e) {}
  // All Positions has no single-portfolio total, so it has no 'portfolio'
  // option — same as a watchlist: a set must be chosen.
  return isAllPositions() ? null : 'portfolio';
}
function setChartSelectedSet(v) {
  try { localStorage.setItem('pt_chart_set_' + getSelCtx(), v); } catch(e) {}
}
function getFundamentalsSelectedSet() {
  try {
    var v = localStorage.getItem('pt_fund_set_' + getSelCtx());
    if (v) return v;
  } catch(e) {}
  return null; // default for fundamentals: no selection
}
function setFundamentalsSelectedSet(v) {
  try {
    if (v == null) localStorage.removeItem('pt_fund_set_' + getSelCtx());
    else localStorage.setItem('pt_fund_set_' + getSelCtx(), v);
  } catch(e) {}
}

// (pad2: zero-padded number, used by date formatting)
function pad2(n) { return n < 10 ? '0' + n : '' + n; }



// --- Chart history cache ---
// Key: chart_hist_{ticker}_{range}, Value: { date, points }
// Expires daily - stale entries purged on each write




var HIST_MODES = ['5d','1mo','3mo','6mo','1y','5y'];

function closeModeLabel(mode) {
  var map = { 'prev': 'PREV.CLOSE', 'reg': 'REG.PRICE', '5d': '5D', '1mo': '1M', '3mo': '3M', '6mo': '6M', '1y': '1Y', '5y': '5Y' };
  return map[mode] || mode.toUpperCase();
}

// ── Chart selection & cache-point helpers ───────────────────────
// Which tickers/set the chart shows, and point bucketing/keys. Pure data.
function getChartSelKey() {
  return 'pt_chart_sel_' + getSelCtx();
}
function getChartSelection() {
  // Returns array of tickers for the currently selected set, or [] if no set
  // selected. 'portfolio' is handled separately (returns all unique tickers).
  var sel = getChartSelectedSet();
  if (sel === 'portfolio') return getChartUniqueTickers();
  var set = getPositionSets().find(function(s) { return s.id === sel; });
  if (!set) return [];
  // Filter to tickers actually present in current portfolio
  var allTickers = getChartUniqueTickers();
  return set.tickers.filter(function(t) { return allTickers.indexOf(t) !== -1; });
}
// Positions the chart draws from, per context. For a regular portfolio that's
// the open portfolio's lots; for ALL POSITIONS it's the union across every
// non-archive portfolio (watchlist included, sold lots excluded) — the same set
// the All Positions views list. No type restriction: charting an index next to
// your holdings is a legitimate comparison.
function getChartContextPositions() {
  if (!isAllPositions()) return positions || [];
  var out = [];
  Object.keys(portfolios).forEach(function(pid) {
    var p = portfolios[pid];
    if (!p || p.archive) return;
    (p.positions || []).forEach(function(pos) {
      if (pos.sold) return;
      out.push(pos);
    });
  });
  return out;
}
function getChartUniqueTickers() {
  var seen = {};
  var result = [];
  getChartContextPositions().forEach(function(p) {
    if (!seen[p.ticker]) { seen[p.ticker] = true; result.push(p.ticker); }
  });
  return result;
}
function saveChartSelection(tickers) {
  try { localStorage.setItem(getChartSelKey(), JSON.stringify(tickers)); } catch(e) {}
}
function pointKey(ts, range) {
  if (range === '1d') return Math.round(ts / 300) * 300 + ''; // 5-min bucket key
  return dateKey(ts);
}
function dateKey(ts) {
  var d = new Date(ts * 1000);
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth()+1) + '-' + pad2(d.getUTCDate());
}
function getChartCurrentPrice(p) {
  return currentMode === 'reg' ? (getPositionRegularMarketPrice(p) || getPositionCurrent(p)) : getPositionCurrent(p);
}
function addTodayPoint(points, p) {
  if (!points || !points.length || !p) return points;
  var price = getChartCurrentPrice(p);
  if (!price) return points;
  var priceTs = p.priceTimestamp || Math.floor(Date.now() / 1000);
  var priceKey = dateKey(priceTs);
  var lastKey = dateKey(points[points.length - 1].t);
  if (lastKey === priceKey) return points;
  return points.concat([{ t: priceTs, c: price }]);
}

// ── Bonds / cash storage readers ──────────────────────────────
// Pure localStorage readers. The matching save* functions stay in index: they
// trigger cloudSave → UI status, so they are not part of the pure layer.
function getBondsDb() {
  try { return JSON.parse(localStorage.getItem('pt_bonds_db') || '[]'); } catch(e) { return []; }
}
function getBondPortfolios() {
  try { return JSON.parse(localStorage.getItem('pt_bond_portfolios') || '{}'); } catch(e) { return {}; }
}
function getCashPortfolios() {
  try { return JSON.parse(localStorage.getItem('pt_cash_portfolios') || '{}'); } catch(e) { return {}; }
}

// ── Misc utilities ──────────────────────────────────────────
// Pure helpers: currency validation, deposit math, stale checks, icon codepoint
// conversion, blink-class mapping, pnl class, fetch-with-timeout.
function validateCurrencyCode(code, callback) {
  if (code === 'USD') { callback(true); return; }
  var baseUrl = getApiKey() ? getApiKey().replace(/\/+$/, '') : '';
  var token = getToken();
  if (!baseUrl) { callback(true); return; } // no backend — skip validation
  var url = baseUrl + '/api/quote?ticker=' + encodeURIComponent(code + 'USD=X');
  var opts = token ? { headers: { 'X-API-Token': token } } : {};
  fetch(url, opts).then(function(r) { return r.json(); }).then(function(d) {
    callback(!!(d.price && d.price > 0));
  }).catch(function() { callback(false); });
}
function calcDeposit(dep, currencyCode) {
  var termYears = dep.termMonths / 12;
  var rate = dep.rate / 100;
  var openDate = new Date(dep.openDate);
  var maturityDate = new Date(openDate);
  maturityDate.setMonth(maturityDate.getMonth() + dep.termMonths);
  var today = new Date(); today.setHours(0,0,0,0);
  var isMatured = maturityDate <= today;
  var profit, annYield;
  if (dep.depositType === 'compounded') {
    var freq = dep.freqPerYear || 12;
    profit = dep.amount * (Math.pow(1 + rate / freq, freq * termYears) - 1);
    annYield = (Math.pow(1 + rate / freq, freq) - 1) * 100;
  } else {
    profit = dep.amount * rate * termYears;
    annYield = dep.rate;
  }
  var ret = dep.amount > 0 ? profit / dep.amount * 100 : null;
  return { profit: profit, ret: ret, annYield: annYield, maturityDate: maturityDate, isMatured: isMatured, currSym: CURRENCY_SYMBOLS[currencyCode] || currencyCode };
}
function fetchWithTimeout(url, opts, ms) {
  ms = ms || 10000;
  var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var timer = null;
  var fetchOpts = controller ? Object.assign({}, opts, { signal: controller.signal }) : opts;
  var p = fetch(url, fetchOpts).then(function(r) { clearTimeout(timer); return r.json(); });
  if (controller) {
    timer = setTimeout(function() { controller.abort(); }, ms);
  }
  return p;
}
// Parse "2600 FE0F" → "☀️". Returns null on invalid hex (caller treats as error).
// Empty string input returns ''.
function iconsCodeToSymbol(code) {
  if (code == null) return '';
  var trimmed = String(code).trim();
  if (!trimmed) return '';
  var parts = trimmed.split(/\s+/);
  var chars = [];
  for (var i = 0; i < parts.length; i++) {
    if (!/^[0-9A-Fa-f]{1,6}$/.test(parts[i])) return null;
    var n = parseInt(parts[i], 16);
    if (isNaN(n) || n < 0 || n > 0x10FFFF) return null;
    try { chars.push(String.fromCodePoint(n)); } catch (e) { return null; }
  }
  return chars.join('');
}
// "☀️" → "2600 FE0F"
function iconsSymbolToCode(symbol) {
  if (!symbol) return '';
  var codes = [];
  for (var i = 0; i < symbol.length; ) {
    var cp = symbol.codePointAt(i);
    codes.push(cp.toString(16).toUpperCase());
    i += cp > 0xFFFF ? 2 : 1;
  }
  return codes.join(' ');
}
function isPortfolioStale(pid) {
  var port = portfolios[pid];
  if (!port || port.archive) return false;
  var poss = port.positions || [];
  for (var i = 0; i < poss.length; i++) {
    if (poss[i].sold) continue;
    if (isPriceStale(poss[i].ticker)) return true;
  }
  return false;
}
function activeTickerCount(p) {
  var seen = {};
  (p.positions || []).forEach(function(pos) {
    // For watchlist/index: count all (they have qty=0 by design)
    // For archive: count all (they're all sold but that's the point)
    // For regular: only active (not sold, qty>0)
    var count = p.watchlist || p.archive ? true : (!pos.sold && pos.qty > 0);
    if (count) seen[pos.ticker] = true;
  });
  return Object.keys(seen).length;
}
function getMarketIcons() {
  try {
    var raw = localStorage.getItem(MARKET_ICONS_STORAGE_KEY);
    if (!raw) return Object.assign({}, MARKET_ICONS_DEFAULTS);
    var parsed = JSON.parse(raw);
    return Object.assign({}, MARKET_ICONS_DEFAULTS, parsed);
  } catch (e) { return Object.assign({}, MARKET_ICONS_DEFAULTS); }
}
function setMarketIcons(icons) {
  try { localStorage.setItem(MARKET_ICONS_STORAGE_KEY, JSON.stringify(icons)); } catch (e) {}
}
// Map (alert count, user's base) → CSS class. Returns null if n < 2 (no blink).
// Progression: starts at user's base level, advances one level per extra alert, clamps at 'fast'.
function blinkClassForCount(n) {
  if (n < 2) return null;
  var base = getBlinkPref();
  var startIdx = BLINK_LEVELS.indexOf(base);
  if (startIdx < 0) startIdx = 1;
  var idx = Math.min(BLINK_LEVELS.length - 1, startIdx + (n - 2));
  return 'alert-blink-' + BLINK_LEVELS[idx];
}
// Color for a triggered alert based on its condition direction.
// '>' (price crossed above) → warm yellow.
// '<' (price crossed below) → sky blue.
function alertColorForCond(cond) {
  return cond === '<' ? '#5bd1f6' : '#f6c15b';
}
function getCloseForMode(p) {
  if (HIST_MODES.indexOf(closeMode) !== -1) return getHistoricalClose(p.ticker, closeMode);
  return closeMode === 'prev' ? (getPositionPreviousClose(p) || getPositionRegularMarketPrice(p) || null) : (getPositionRegularMarketPrice(p) || null);
}
function escapeCustomizeIconsAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function cls(n) {
  if (n === null || n === undefined || isNaN(n)) return 'muted';
  return n >= 0 ? 'pos' : 'neg';
}
function isPriceStale(ticker)    { return !!staleTickers[ticker]; }
function getBlinkPref()      { try { return localStorage.getItem('pt_blink_period') || 'slow'; } catch(e) { return 'slow'; } }
