// core.js — stable lower-level layer for Portfolio Terminal.
//
// Holds the parts that change rarely: low-level position/ticker accessors,
// formatters, data migrations, and cloud/network primitives. Loaded before
// fundamentals.js and the main index.html script, so every one of its
// definitions is available to them. This is a shared-globals split (ES5, no
// modules): functions and vars declared here live in the same global scope as
// the rest of the app — there is no import/export.
//
// (Currently empty — code is migrated here in small, verified batches.)

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
var NULLABLE_POSITION_FIELDS = ['note', 'purchaseDate', 'broker'];
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

// ── Ticker & alert accessors ────────────────────────────────────────────────
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
