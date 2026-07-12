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
