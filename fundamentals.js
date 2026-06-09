// fundamentals.js — Yahoo Finance research data
// 4th-row compact display in expanded positions + fullscreen More screen

(function() {
'use strict';

/* ── Constants ──────────────────────────────────────────────────────────── */
var FUND_CACHE_TTL  = 4 * 60 * 60 * 1000;
var FUND_CACHE_VER  = 1;
var FUND_ROW_MODS   = 'financialData,defaultKeyStatistics,recommendationTrend,upgradeDowngradeHistory';
var FUND_ACCENT     = '#5b9cf6';
var FUND_HIST_DAYS  = 100;
var FUND_HIST_DFLT  = 30;

/* ── CSS ────────────────────────────────────────────────────────────────── */
(function injectCss() {
  var s = document.getElementById('fund-css');
  if (!s) { s = document.createElement('style'); s.id = 'fund-css'; document.head.appendChild(s); }
  s.textContent =
    '#fund-overlay{position:fixed;inset:0;z-index:9999;background:var(--bg);display:flex;flex-direction:column;overflow:hidden}' +
    '#fund-overlay table{min-width:0}' +
    '#fund-overlay td{font-weight:normal;letter-spacing:0}' +
    '#fund-overlay tr:hover td{background:none}' +
    '#fund-hdr{display:flex;align-items:center;gap:6px;padding:6px 12px;border-bottom:1px solid var(--border);flex-shrink:0;flex-wrap:wrap}' +
    '.ftab{background:none;border:none;border-bottom:2px solid transparent;color:var(--dim);font-family:var(--font);font-size:11px;letter-spacing:1px;padding:4px 8px;cursor:pointer}' +
    '.ftab.on{color:' + FUND_ACCENT + ';border-bottom-color:' + FUND_ACCENT + '}' +
    '#fund-body{flex:1;overflow-y:auto;padding:16px;font-family:var(--font);font-size:13px}' +
    '.ff-list{display:flex;flex-direction:column;gap:1px;max-width:480px}' +
    '.ff-row{display:flex;justify-content:space-between;align-items:baseline;padding:3px 0;gap:16px}' +
    '.ff-lbl{color:var(--dim)}' +
    '.ff-val{font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}' +
    '.ff-div{border-top:1px solid var(--border);margin:8px 0}' +
    '.ff-comp{padding:3px 0;white-space:nowrap;overflow-x:auto}' +
    '.ff-comp .lbl{color:var(--dim)}' +
    '.fq-tbl{border-collapse:collapse;font-variant-numeric:tabular-nums;table-layout:fixed;width:100%}' +
    '.fq-tbl th{text-align:right;padding:6px 0;font-weight:normal;color:var(--dim);font-size:10px;text-transform:uppercase;border-bottom:1px solid var(--border)}' +
    '.fq-tbl th:first-child{text-align:left}' +
    '.fq-tbl td{padding:5px 0;text-align:right}' +
    '.fq-tbl td:first-child{text-align:left;color:var(--dim)}' +
    '.fa-top{display:flex;align-items:flex-start;gap:16px}' +
    '.fa-left{display:grid;grid-template-columns:auto auto auto;column-gap:8px;row-gap:4px;align-items:baseline}' +
    '.fa-right{display:grid;grid-template-columns:auto auto;column-gap:4px;row-gap:4px;align-items:baseline}' +
    '.fa-div{width:1px;align-self:stretch;background:var(--border)}' +
    '.fa-sum{margin-top:12px;display:grid;grid-template-columns:auto auto;column-gap:8px;row-gap:4px;align-items:baseline;width:max-content}' +
    '.fa-lbl{color:var(--dim)}' +
    '.fa-val{text-align:right;font-variant-numeric:tabular-nums}' +
    '.fa-pct{text-align:right;color:var(--dim);font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap}' +
    '.fh-wrap{margin-top:20px;padding-top:16px;border-top:1px solid var(--border)}' +
    '.fh-sum{display:grid;grid-template-columns:auto auto auto;column-gap:14px;row-gap:6px;align-items:baseline;margin-bottom:14px}' +
    '.fh-sum .slbl{color:var(--dim)}' +
    '.fh-sum .sval{font-variant-numeric:tabular-nums;text-align:right}' +
    '.fh-sum .spct{font-variant-numeric:tabular-nums;font-size:11px;color:var(--dim);white-space:nowrap}' +
    '.fh-days{width:44px;padding:1px 6px;margin:0 2px;text-align:center;font-family:var(--font);font-size:13px;background:var(--bg);border:1px solid var(--border);vertical-align:baseline}' +
    '.fh-scroll{overflow-x:auto}' +
    '.fh-tbl{border-collapse:collapse;font-variant-numeric:tabular-nums}' +
    '.fh-tbl th{font-weight:normal;color:var(--dim);font-size:10px;text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid var(--border);padding:6px 16px 6px 0;text-align:left;white-space:nowrap}' +
    '.fh-tbl td{padding:5px 16px 5px 0;white-space:nowrap;text-align:left}' +
    '.fh-tbl th:last-child,.fh-tbl td:last-child{padding-right:0}' +
    '.fh-tbl th.n,.fh-tbl td.n{text-align:right}' +
    '.fh-tbl td.d{color:var(--dim)}';
  document.head.appendChild(s);
})();

/* ── Value utilities ────────────────────────────────────────────────────── */
function fundEsc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function fundGetVal(obj, path) {
  var parts = path.split('.');
  var v = obj;
  for (var i = 0; i < parts.length; i++) {
    if (v == null || typeof v !== 'object') return undefined;
    v = v[parts[i]];
  }
  return v;
}

function fundUseful(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === 'object' && !Array.isArray(v)) {
    if ('fmt' in v && v.fmt) return true;
    if ('raw' in v && v.raw !== null && v.raw !== undefined) return true;
    return false;
  }
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

function fundRawNum(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object' && 'raw' in v && typeof v.raw === 'number' && Number.isFinite(v.raw)) return v.raw;
  return null;
}

function fundNormFmt(s) {
  if (typeof s !== 'string') return s;
  return s.replace(/\.(\d)(?!\d)/, '.$10');
}

function fundFmtPrim(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return String(v);
    if (Number.isInteger(v)) return v.toLocaleString('en-US');
    return v.toFixed(2);
  }
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

function fundFmtOrRaw(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if ('fmt' in v && v.fmt) return fundNormFmt(v.fmt);
    if ('raw' in v && v.raw != null) return fundFmtPrim(v.raw);
    return '';
  }
  return fundFmtPrim(v) || '';
}

function fundUnixDate(sec) {
  var d = new Date(sec * 1000);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function fundFormatField(value, format) {
  if (!fundUseful(value)) return null;
  if (typeof value === 'object' && !Array.isArray(value)) {
    if (format === 'date') {
      if ('raw' in value && typeof value.raw === 'number') return fundUnixDate(value.raw);
      return value.fmt || null;
    }
    if ('fmt' in value && value.fmt) return fundNormFmt(value.fmt);
    if ('raw' in value) return fundFmtPrim(value.raw);
    return null;
  }
  if (Array.isArray(value)) {
    if (format === 'date-range') {
      var dates = value.map(function(v2) {
        if (v2 && typeof v2 === 'object') {
          if ('raw' in v2 && typeof v2.raw === 'number') return fundUnixDate(v2.raw);
          return v2.fmt || null;
        }
        if (typeof v2 === 'number') return fundUnixDate(v2);
        return null;
      }).filter(Boolean);
      if (!dates.length) return null;
      return dates.length === 1 ? dates[0] : dates[0] + ' – ' + dates[dates.length - 1];
    }
    return JSON.stringify(value);
  }
  if (format === 'date' && typeof value === 'number') return fundUnixDate(value);
  return fundFmtPrim(value);
}

/* ── localStorage cache ─────────────────────────────────────────────────── */
function fundCacheKey(ticker) { return 'yfund_' + ticker.toUpperCase(); }

function fundCacheGet(ticker) {
  try {
    var raw = localStorage.getItem(fundCacheKey(ticker));
    if (!raw) return null;
    var entry = JSON.parse(raw);
    if (!entry || !entry.ts) return null;
    if (entry.v !== FUND_CACHE_VER) return null;
    if (Date.now() - entry.ts > FUND_CACHE_TTL) return null;
    return entry;
  } catch(e) { return null; }
}

function fundCacheSet(ticker, data) {
  try {
    var obj = { v: FUND_CACHE_VER, ts: Date.now() };
    var keys = Object.keys(data);
    for (var i = 0; i < keys.length; i++) obj[keys[i]] = data[keys[i]];
    localStorage.setItem(fundCacheKey(ticker), JSON.stringify(obj));
  } catch(e) {}
}

/* ── Fetch helpers ──────────────────────────────────────────────────────── */
function fundWorkerBase() { return (localStorage.getItem('pt_finnhub') || '').replace(/\/$/, ''); }
function fundWorkerToken() { return localStorage.getItem('pt_token') || ''; }

var fundInflight = {};

function fundFetchRow(ticker) {
  var base  = fundWorkerBase();
  var token = fundWorkerToken();
  if (!base || !token) return Promise.resolve();
  var url = base + '/api/quotesummary?ticker=' + encodeURIComponent(ticker)
    + '&modules=' + encodeURIComponent(FUND_ROW_MODS);
  return fetch(url, { headers: { 'X-API-Token': token } })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      var result = (!data._error && data.quoteSummary)
        ? (data.quoteSummary.result && data.quoteSummary.result[0])
        : null;
      var fd     = (result && result.financialData)         || null;
      var dks    = (result && result.defaultKeyStatistics)  || null;
      var rt     = (result && result.recommendationTrend)   || null;
      var udh    = (result && result.upgradeDowngradeHistory) || null;
      var trend0 = (rt && rt.trend && rt.trend[0])          || null;

      // Filter upgrade/downgrade history to last FUND_HIST_DAYS days,
      // keep only {date, target} for entries with a valid target price.
      var targets = [];
      var hist = udh && udh.history;
      if (Array.isArray(hist)) {
        var cutoff = Math.floor(Date.now() / 1000) - FUND_HIST_DAYS * 86400;
        for (var i = 0; i < hist.length; i++) {
          var h = hist[i];
          var hd = h && h.epochGradeDate;
          var ht = h && fundRawNum(h.currentPriceTarget);
          if (hd && hd >= cutoff && ht !== null && ht > 0) {
            targets.push({ date: hd, target: ht });
          }
        }
      }

      // Always cache (including nulls for ETFs) to avoid repeated fetches.
      // Schema is flat — raw Yahoo modules are extracted into individual
      // parameters and the modules themselves are discarded.
      fundCacheSet(ticker, {
        strongBuy:       trend0 ? fundRawNum(trend0.strongBuy)  : null,
        buy:             trend0 ? fundRawNum(trend0.buy)        : null,
        hold:            trend0 ? fundRawNum(trend0.hold)       : null,
        sell:            trend0 ? fundRawNum(trend0.sell)       : null,
        strongSell:      trend0 ? fundRawNum(trend0.strongSell) : null,
        targetMeanPrice: fd  ? fundRawNum(fd.targetMeanPrice)   : null,
        currentPrice:    fd  ? fundRawNum(fd.currentPrice)      : null,
        trailingEps:     dks ? fundRawNum(dks.trailingEps)      : null,
        forwardPE:       dks ? fundRawNum(dks.forwardPE)        : null,
        targets:         targets
      });
    })
    .catch(function() {}); // Network error: don't cache, allow retry next time
}

function fundFetchModules(ticker, modules) {
  var base  = fundWorkerBase();
  var token = fundWorkerToken();
  if (!base || !token) return Promise.reject(new Error('Worker not configured'));
  var url = base + '/api/quotesummary?ticker=' + encodeURIComponent(ticker)
    + '&modules=' + encodeURIComponent(modules);
  return fetch(url, { headers: { 'X-API-Token': token } })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data._error) throw new Error(data._error);
      var yErr = data.quoteSummary && data.quoteSummary.error;
      if (yErr) throw new Error((yErr.description || yErr.code) || 'Yahoo error');
      var result = data.quoteSummary && data.quoteSummary.result && data.quoteSummary.result[0];
      if (!result) throw new Error('No data');
      return result;
    });
}

/* ── 4th-row builder ────────────────────────────────────────────────────── */
function fundAvgInWindow(targets, cutoffSec) {
  if (!Array.isArray(targets) || !targets.length) return null;
  var sum = 0, n = 0;
  for (var i = 0; i < targets.length; i++) {
    var t = targets[i];
    if (t && t.date >= cutoffSec && typeof t.target === 'number') {
      sum += t.target;
      n++;
    }
  }
  return n > 0 ? sum / n : null;
}

function buildFundamentalsRows(ticker) {
  if (!fundWorkerBase() || !fundWorkerToken()) return '';

  var cached = fundCacheGet(ticker);

  if (!cached) {
    if (!fundInflight[ticker]) {
      fundInflight[ticker] = fundFetchRow(ticker).then(function() {
        delete fundInflight[ticker];
        if (typeof render === 'function') render();
      });
    }
    return '';
  }

  var ROW = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:5px;font-size:10px;letter-spacing:1px';
  var DIM = 'color:var(--dim)';
  var BRT = 'color:var(--bright)';
  var html = '';

  // Line 1: analyst vote breakdown — label dim, count bright
  var trend = cached;
  if (trend) {
    var votes = ['strongBuy','buy','hold','sell','strongSell'].map(function(k) {
      var v = trend[k];
      return (v != null)
        ? '<span><span style="' + DIM + '">' + fundEsc(k) + '</span> <span style="' + BRT + '">' + fundEsc(String(v)) + '</span></span>'
        : null;
    }).filter(Boolean);
    if (votes.length) {
      html += '<div style="display:flex;flex-wrap:wrap;gap:3px 10px;margin-top:5px;font-size:10px;letter-spacing:1px">'
        + votes.join('') + '</div>';
    }
  }

  // Line 2: Avg target (if available)
  {
    var targetMean   = cached.targetMeanPrice;
    var currentPrice = cached.currentPrice;
    var line2 = '';

    if (targetMean !== null && currentPrice !== null && currentPrice > 0) {
      var pct = (targetMean - currentPrice) / currentPrice * 100;
      var pctStr = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
      line2 += '<span style="' + DIM + '">Avg&nbsp;tgt</span>'
        + '<span style="' + BRT + '">' + fundEsc(targetMean.toFixed(2)) + '</span>'
        + '<span style="' + DIM + '">(' + fundEsc(pctStr) + ')</span>';
    }

    if (currentPrice !== null && currentPrice > 0 && Array.isArray(cached.targets) && cached.targets.length) {
      var nowSec = Math.floor(Date.now() / 1000);
      var avg = fundAvgInWindow(cached.targets, nowSec - 30 * 86400);
      var lbl = '30d';
      if (avg === null) {
        avg = fundAvgInWindow(cached.targets, nowSec - 100 * 86400);
        lbl = '100d';
      }
      if (avg !== null) {
        var hpct = (avg - currentPrice) / currentPrice * 100;
        var hpctStr = (hpct >= 0 ? '+' : '') + hpct.toFixed(2) + '%';
        line2 += '<span style="' + DIM + '">' + lbl + '&nbsp;tgt</span>'
          + '<span style="' + BRT + '">' + fundEsc(avg.toFixed(2)) + '</span>'
          + '<span style="' + DIM + '">(' + fundEsc(hpctStr) + ')</span>';
      }
    }

    if (line2) {
      html += '<div style="' + ROW + '">' + line2 + '</div>';
    }
  }

  // Line 3: P/E, fw P/E, [More]
  var moreBtn = '<span onclick="openMore(\'' + ticker.replace(/'/g, "\\'") + '\')"'
    + ' style="cursor:pointer;font-size:10px;color:' + FUND_ACCENT + ';border:1px solid '
    + FUND_ACCENT + ';padding:1px 6px;font-family:var(--font);user-select:none">&#8250;</span>';

  var line3 = '<div style="' + ROW + '">';
  {
    var price3 = cached.currentPrice;
    var tEps3  = cached.trailingEps;
    if (price3 !== null && tEps3 !== null && tEps3 !== 0) {
      var pe3 = price3 / tEps3;
      if (pe3 > 0 && pe3 < 10000) {
        line3 += '<span style="' + DIM + '">P/E</span>&nbsp;<span style="' + BRT + '">' + fundEsc(pe3.toFixed(2)) + '</span>&nbsp;&nbsp;';
      }
    }
  }
  {
    var fwPE3 = cached.forwardPE;
    if (fwPE3 !== null && fwPE3 > 0 && fwPE3 < 10000) {
      line3 += '<span style="' + DIM + '">fw&nbsp;P/E</span>&nbsp;<span style="' + BRT + '">' + fundEsc(fwPE3.toFixed(2)) + '</span>&nbsp;&nbsp;';
    }
  }
  line3 += moreBtn + '</div>';
  html += line3;

  return html;
}

/* ── FIELDS catalog ─────────────────────────────────────────────────────── */
var FUND_FIELDS = {
  regularMarketPrice:    { paths: ['price.regularMarketPrice'] },
  bid:                   { paths: ['summaryDetail.bid',  'price.bid'] },
  bidSize:               { paths: ['summaryDetail.bidSize', 'price.bidSize'] },
  ask:                   { paths: ['summaryDetail.ask',  'price.ask'] },
  askSize:               { paths: ['summaryDetail.askSize', 'price.askSize'] },
  dayLow:                { paths: ['price.regularMarketDayLow',  'summaryDetail.dayLow'] },
  dayHigh:               { paths: ['price.regularMarketDayHigh', 'summaryDetail.dayHigh'] },
  '52WeekLow':           { paths: ['summaryDetail.fiftyTwoWeekLow'] },
  '52WeekHigh':          { paths: ['summaryDetail.fiftyTwoWeekHigh'] },
  '50DayAverage':        { paths: ['summaryDetail.fiftyDayAverage',       'price.fiftyDayAverage'] },
  '200DayAverage':       { paths: ['summaryDetail.twoHundredDayAverage',  'price.twoHundredDayAverage'] },
  allTimeHigh:           { paths: ['price.allTimeHigh', 'summaryDetail.allTimeHigh'] },
  volume:                { paths: ['summaryDetail.volume', 'price.regularMarketVolume'] },
  averageVolume:         { paths: ['summaryDetail.averageVolume'] },
  averageVolume10days:   { paths: ['summaryDetail.averageVolume10days', 'summaryDetail.averageDailyVolume10Day'] },
  beta:                  { paths: ['summaryDetail.beta'] },
  marketCap:             { paths: ['price.marketCap', 'summaryDetail.marketCap'] },
  totalAssets:           { paths: ['defaultKeyStatistics.totalAssets'] },
  totalCash:             { paths: ['financialData.totalCash'] },
  totalDebt:             { paths: ['financialData.totalDebt'] },
  operatingCashflow:     { paths: ['financialData.operatingCashflow'] },
  freeCashflow:          { paths: ['financialData.freeCashflow'] },
  totalRevenue:          { paths: ['financialData.totalRevenue'] },
  revenueGrowth:         { paths: ['financialData.revenueGrowth'] },
  netIncomeToCommon:     { paths: ['defaultKeyStatistics.netIncomeToCommon'] },
  earningsGrowth:        { paths: ['financialData.earningsGrowth', 'defaultKeyStatistics.earningsQuarterlyGrowth'] },
  profitMargins:         { paths: ['financialData.profitMargins'] },
  trailingPE:            { paths: ['summaryDetail.trailingPE', 'defaultKeyStatistics.trailingPE'] },
  forwardPE:             { paths: ['summaryDetail.forwardPE',  'defaultKeyStatistics.forwardPE'] },
  priceToSalesTrailing12Months: { paths: ['summaryDetail.priceToSalesTrailing12Months'] },
  priceToBook:           { paths: ['defaultKeyStatistics.priceToBook'] },
  trailingEps:           { paths: ['defaultKeyStatistics.trailingEps'] },
  forwardEps:            { paths: ['defaultKeyStatistics.forwardEps'] },
  pegRatio:              { paths: ['defaultKeyStatistics.pegRatio', 'financialData.pegRatio'] },
  lastDividendValue:     { paths: ['defaultKeyStatistics.lastDividendValue'] },
  lastDividendDate:      { paths: ['defaultKeyStatistics.lastDividendDate'], format: 'date' },
  exDividendDate:        { paths: ['calendarEvents.exDividendDate'], format: 'date' },
  earningsDate:          { paths: ['calendarEvents.earnings.earningsDate'], format: 'date-range' },
  heldPercentInsiders:   { paths: ['defaultKeyStatistics.heldPercentInsiders'] },
  heldPercentInstitutions: { paths: ['defaultKeyStatistics.heldPercentInstitutions'] },
  sharesShort:           { paths: ['defaultKeyStatistics.sharesShort'] },
  sharesShortPriorMonth: { paths: ['defaultKeyStatistics.sharesShortPriorMonth'] },
  shortPercentOfFloat:   { paths: ['defaultKeyStatistics.shortPercentOfFloat'] },
};

// Sentinel objects for composite rows in MARKET_GROUPS
var _PRICES = { prices: true };
var _BASK   = { bidask: true };

var FUND_MARKET_GROUPS = [
  [_PRICES, _BASK],
  ['dayLow','dayHigh','52WeekLow','52WeekHigh','50DayAverage','200DayAverage','allTimeHigh'],
  ['volume','averageVolume10days','averageVolume'],
  ['beta'],
];
var FUND_STATS_GROUPS = [
  ['marketCap','totalAssets'],
  ['totalCash','totalDebt','operatingCashflow','freeCashflow'],
  ['totalRevenue','revenueGrowth','netIncomeToCommon','earningsGrowth','profitMargins'],
  ['trailingPE','forwardPE','priceToSalesTrailing12Months','priceToBook','trailingEps','forwardEps','pegRatio'],
  ['lastDividendValue','lastDividendDate','exDividendDate'],
  ['earningsDate'],
];
var FUND_SENT_GROUPS = [
  ['heldPercentInsiders','heldPercentInstitutions'],
  ['sharesShort','sharesShortPriorMonth','shortPercentOfFloat'],
];

/* ── renderFieldGroups ──────────────────────────────────────────────────── */
function fundBidAskRow(data) {
  var bidRaw     = fundRawNum(fundGetVal(data, 'summaryDetail.bid'));
  if (bidRaw === null) bidRaw = fundRawNum(fundGetVal(data, 'price.bid'));
  var bidSizeRaw = fundRawNum(fundGetVal(data, 'summaryDetail.bidSize'));
  if (bidSizeRaw === null) bidSizeRaw = fundRawNum(fundGetVal(data, 'price.bidSize'));
  var askRaw     = fundRawNum(fundGetVal(data, 'summaryDetail.ask'));
  if (askRaw === null) askRaw = fundRawNum(fundGetVal(data, 'price.ask'));
  var askSizeRaw = fundRawNum(fundGetVal(data, 'summaryDetail.askSize'));
  if (askSizeRaw === null) askSizeRaw = fundRawNum(fundGetVal(data, 'price.askSize'));
  if (bidRaw === null && askRaw === null) return null;
  var fmt = function(n) { return (n === null || n === 0) ? '—' : (fundFmtPrim(n) || '—'); };
  var SM = 'color:var(--dim);font-size:11px';
  return '<div class="ff-comp">'
    + '<span class="lbl">bid</span> <span>' + fundEsc(fmt(bidRaw)) + '</span>'
    + '<span style="' + SM + ';margin:0 1px">\xd7</span><span style="' + SM + '">' + fundEsc(fmt(bidSizeRaw)) + '</span>'
    + '&nbsp;&nbsp;'
    + '<span class="lbl">ask</span> <span>' + fundEsc(fmt(askRaw)) + '</span>'
    + '<span style="' + SM + ';margin:0 1px">\xd7</span><span style="' + SM + '">' + fundEsc(fmt(askSizeRaw)) + '</span>'
    + '</div>';
}

// Renders regularMarketPrice + optional pre/postMarketPrice as a
// 3-column grid so label, value, and change columns align across rows.
function fundPriceBlock(data) {
  var regPriceFmt = fundFormatField(fundGetVal(data, 'price.regularMarketPrice'));
  if (!regPriceFmt) return null;

  // Detect which extended-hours session (if any) is most recent
  var regTime   = fundRawNum(fundGetVal(data, 'price.regularMarketTime'));
  var postTime  = fundRawNum(fundGetVal(data, 'price.postMarketTime'));
  var preTime   = fundRawNum(fundGetVal(data, 'price.preMarketTime'));
  var postPrice = fundGetVal(data, 'price.postMarketPrice');
  var prePrice  = fundGetVal(data, 'price.preMarketPrice');

  var candidates = [
    { kind: 'regular', t: regTime,  ok: regTime  !== null },
    { kind: 'post',    t: postTime, ok: postTime !== null && fundUseful(postPrice) },
    { kind: 'pre',     t: preTime,  ok: preTime  !== null && fundUseful(prePrice) },
  ].filter(function(c) { return c.ok; });

  var useSession = null;
  if (candidates.length) {
    candidates.sort(function(a, b) { return b.t - a.t; });
    var winner = candidates[0].kind;
    if (winner !== 'regular') useSession = winner;
  } else {
    if (fundUseful(postPrice)) useSession = 'post';
    else if (fundUseful(prePrice)) useSession = 'pre';
  }

  var DIM3 = 'color:var(--dim);font-size:11px;white-space:nowrap';
  var html = '<div style="display:grid;grid-template-columns:auto auto auto;column-gap:8px;row-gap:4px;align-items:baseline">';

  // Row 1: regularMarketPrice | value | (empty change column)
  html += '<span class="ff-lbl">regularMarketPrice</span>'
    + '<span class="ff-val">' + fundEsc(regPriceFmt) + '</span>'
    + '<span></span>';

  // Row 2 (optional): pre/postMarketPrice | value | change pct
  if (useSession) {
    var label    = useSession === 'post' ? 'postMarketPrice' : 'preMarketPrice';
    var priceVal = useSession === 'post' ? postPrice : prePrice;
    var changeVal = fundGetVal(data, useSession === 'post'
      ? 'price.postMarketChange' : 'price.preMarketChange');
    var pctVal    = fundGetVal(data, useSession === 'post'
      ? 'price.postMarketChangePercent' : 'price.preMarketChangePercent');
    var priceFmt = fundFormatField(priceVal);
    if (priceFmt) {
      var changeFmt = fundUseful(changeVal) ? fundFormatField(changeVal) : null;
      var pctFmt    = fundUseful(pctVal)    ? fundFormatField(pctVal)    : null;
      var changePart = '';
      if (changeFmt) changePart += fundEsc(changeFmt);
      if (pctFmt)    changePart += (changePart ? ' ' : '') + '(' + fundEsc(pctFmt) + ')';
      html += '<span class="ff-lbl">' + fundEsc(label) + '</span>'
        + '<span class="ff-val">' + fundEsc(priceFmt) + '</span>'
        + '<span style="' + DIM3 + '">' + changePart + '</span>';
    }
  }

  html += '</div>';
  return html;
}

function fundRenderFieldGroups(groups, data, container) {
  var renderedGroups = [];
  for (var gi = 0; gi < groups.length; gi++) {
    var group = groups[gi];
    var rowsHtml = [];
    for (var ii = 0; ii < group.length; ii++) {
      var item = group[ii];
      var rowHtml = null;
      if (typeof item === 'string') {
        var desc = FUND_FIELDS[item];
        if (!desc) continue;
        var value;
        for (var pi = 0; pi < desc.paths.length; pi++) {
          var cand = fundGetVal(data, desc.paths[pi]);
          if (fundUseful(cand)) { value = cand; break; }
        }
        var formatted = fundFormatField(value, desc.format);
        if (formatted === null) continue;
        rowHtml = '<div class="ff-row"><span class="ff-lbl">' + fundEsc(item) + '</span>'
          + '<span class="ff-val">' + fundEsc(formatted) + '</span></div>';
      } else if (item === _PRICES) {
        rowHtml = fundPriceBlock(data);
      } else if (item === _BASK) {
        rowHtml = fundBidAskRow(data);
      }
      if (rowHtml) rowsHtml.push(rowHtml);
    }
    if (rowsHtml.length) renderedGroups.push(rowsHtml);
  }
  if (!renderedGroups.length) {
    container.innerHTML = '<div style="color:var(--dim);padding:8px 0">No data available.</div>';
    return;
  }
  var html = '<div class="ff-list">';
  for (var rgi = 0; rgi < renderedGroups.length; rgi++) {
    if (rgi > 0) html += '<div class="ff-div"></div>';
    html += renderedGroups[rgi].join('');
  }
  html += '</div>';
  container.innerHTML = html;
}

/* ── Quarterly renderer ─────────────────────────────────────────────────── */
function fundParseQDate(s) {
  var m = /^(\d)Q(\d{4})$/.exec(String(s));
  if (!m) return 0;
  return parseInt(m[2], 10) + (parseInt(m[1], 10) - 1) * 0.25;
}

function fundComputeMargin(earnings, revenue) {
  var e = fundRawNum(earnings);
  var r = fundRawNum(revenue);
  if (e === null || r === null || r === 0) return '';
  return (e / r * 100).toFixed(2) + '%';
}

// Pick "nice" tick values within [min, max], roughly `count` of them.
function fundNiceTicks(min, max, count) {
  if (min === max) return [min];
  var range = max - min;
  var rawStep = range / Math.max(1, count - 1);
  var pow = Math.pow(10, Math.floor(Math.log(rawStep) / Math.LN10));
  var rel = rawStep / pow;
  var niceStep;
  if (rel < 1.5)      niceStep = 1 * pow;
  else if (rel < 3)   niceStep = 2 * pow;
  else if (rel < 7)   niceStep = 5 * pow;
  else                niceStep = 10 * pow;
  var ticks = [];
  var t = Math.floor(min / niceStep) * niceStep;
  while (t <= max + niceStep * 0.0001) {
    if (t >= min - niceStep * 0.0001) ticks.push(Number(t.toFixed(10)));
    t += niceStep;
  }
  return ticks;
}

// Compact dollar amount: 12500000000 → "12.5B", -250000 → "-250K", 0 → "0".
function fundFmtDollarShort(v) {
  if (v === 0) return '0';
  var abs = Math.abs(v);
  var sign = v < 0 ? '-' : '';
  if (abs >= 1e9)  return sign + (abs / 1e9).toFixed(abs >= 1e10 ? 0 : 1) + 'B';
  if (abs >= 1e6)  return sign + (abs / 1e6).toFixed(abs >= 1e7 ? 0 : 1) + 'M';
  if (abs >= 1e3)  return sign + (abs / 1e3).toFixed(0) + 'K';
  return sign + abs.toFixed(0);
}

// Build SVG chart: revenue + earnings bars (left $ axis) + net margin line (right % axis).
// Bars and line use the same X positions; auto-ranged on both axes.
function fundBuildQuarterlyChart(quarters, width) {
  if (!quarters || !quarters.length) return '';

  var data = quarters.map(function(q) {
    var rev = fundRawNum(q.revenue);
    var ern = fundRawNum(q.earnings);
    var mgn = (ern != null && rev != null && rev !== 0) ? (ern / rev * 100) : null;
    return { date: q.date, rev: rev, ern: ern, mgn: mgn };
  });

  var dollarVals = [], marginVals = [];
  for (var i = 0; i < data.length; i++) {
    if (data[i].rev != null) dollarVals.push(data[i].rev);
    if (data[i].ern != null) dollarVals.push(data[i].ern);
    if (data[i].mgn != null) marginVals.push(data[i].mgn);
  }
  if (!dollarVals.length) return '';

  var dMin = Math.min.apply(null, dollarVals);
  var dMax = Math.max.apply(null, dollarVals);
  if (dMin > 0) dMin = 0;
  if (dMax < 0) dMax = 0;

  var mMin = marginVals.length ? Math.min.apply(null, marginVals) : 0;
  var mMax = marginVals.length ? Math.max.apply(null, marginVals) : 100;
  if (mMin > 0) mMin = 0;
  if (mMax < 0) mMax = 0;
  if (mMin === mMax) { mMin -= 5; mMax += 5; }

  var W = width || 340, H = 180;
  var padL = 42, padR = 38, padT = 8, padB = 22;
  var innerW = W - padL - padR;
  var innerH = H - padT - padB;

  function xCenter(i) { return padL + (i + 0.5) * (innerW / data.length); }
  function yLeft(v) {
    var range = dMax - dMin;
    if (range === 0) return padT + innerH / 2;
    return padT + (1 - (v - dMin) / range) * innerH;
  }
  function yRight(v) {
    var range = mMax - mMin;
    if (range === 0) return padT + innerH / 2;
    return padT + (1 - (v - mMin) / range) * innerH;
  }

  var colW = innerW / data.length;
  var barW = Math.max(4, colW * 0.32);
  var barGap = 1;

  var C_REV = '#5b9cf6', C_ERN = '#5bf6e4', C_MGN = '#c4a000';
  var s = '';

  // Zero / baseline line on left axis
  var zeroYL = yLeft(0);
  s += '<line x1="' + padL + '" y1="' + zeroYL.toFixed(1) + '" x2="' + (padL + innerW) + '" y2="' + zeroYL.toFixed(1) + '" stroke="var(--border)" stroke-width="' + (dMin < 0 && dMax > 0 ? 1 : 0.5) + '"/>';

  // Bars
  for (var bi = 0; bi < data.length; bi++) {
    var d = data[bi], cx = xCenter(bi);
    if (d.rev != null) {
      var rTop = yLeft(Math.max(0, d.rev)), rBot = yLeft(Math.min(0, d.rev));
      s += '<rect x="' + (cx - barW - barGap/2).toFixed(1) + '" y="' + rTop.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + Math.max(1, rBot - rTop).toFixed(1) + '" fill="' + C_REV + '"/>';
    }
    if (d.ern != null) {
      var eTop = yLeft(Math.max(0, d.ern)), eBot = yLeft(Math.min(0, d.ern));
      s += '<rect x="' + (cx + barGap/2).toFixed(1) + '" y="' + eTop.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + Math.max(1, eBot - eTop).toFixed(1) + '" fill="' + C_ERN + '"/>';
    }
  }

  // Net margin line + markers
  var pts = [];
  for (var pi = 0; pi < data.length; pi++) {
    if (data[pi].mgn != null) pts.push({ x: xCenter(pi), y: yRight(data[pi].mgn) });
  }
  if (pts.length >= 2) {
    s += '<path d="M ' + pts.map(function(p) { return p.x.toFixed(1) + ' ' + p.y.toFixed(1); }).join(' L ') + '" stroke="' + C_MGN + '" stroke-width="1.5" fill="none"/>';
  }
  for (var pj = 0; pj < pts.length; pj++) {
    s += '<circle cx="' + pts[pj].x.toFixed(1) + '" cy="' + pts[pj].y.toFixed(1) + '" r="3" fill="' + C_MGN + '"/>';
  }

  // X-axis quarter labels
  for (var xi = 0; xi < data.length; xi++) {
    var lbl = data[xi].date ? data[xi].date.replace(/(\d)Q(20)(\d\d)/, "Q$1'$3") : '';
    s += '<text x="' + xCenter(xi).toFixed(1) + '" y="' + (H - 6) + '" fill="var(--dim)" font-size="9" text-anchor="middle">' + fundEsc(lbl) + '</text>';
  }

  // Left Y-axis ($)
  var lt = fundNiceTicks(dMin, dMax, 4);
  for (var lti = 0; lti < lt.length; lti++) {
    s += '<text x="' + (padL - 4) + '" y="' + (yLeft(lt[lti]) + 3).toFixed(1) + '" fill="var(--dim)" font-size="8" text-anchor="end">' + fundFmtDollarShort(lt[lti]) + '</text>';
  }

  // Right Y-axis (%)
  var rt = fundNiceTicks(mMin, mMax, 4);
  for (var rti = 0; rti < rt.length; rti++) {
    s += '<text x="' + (padL + innerW + 4) + '" y="' + (yRight(rt[rti]) + 3).toFixed(1) + '" fill="var(--dim)" font-size="8" text-anchor="start">' + rt[rti].toFixed(0) + '%</text>';
  }

  return '<svg width="' + W + '" height="' + H + '" style="display:block;margin-top:6px">' + s + '</svg>';
}

function fundRenderQuarterly(data, container) {
  var sub = window.earningsSubView || 'quarterly';

  // Toggle buttons (Quarterly | Yearly)
  function tBtn(key, label) {
    var active = sub === key;
    return '<button onclick="setEarningsSubView(\'' + key + '\')" style="font-size:9px;letter-spacing:1px;padding:4px 10px;border:1px solid '
      + (active ? 'var(--green)' : 'var(--border)') + ';background:'
      + (active ? 'var(--bg2)' : 'var(--bg)') + ';color:'
      + (active ? 'var(--green)' : 'var(--dim)') + ';cursor:pointer;font-family:var(--font)">' + label + '</button>';
  }
  var toggleHtml = '<div style="display:flex;gap:6px;margin-bottom:12px">' + tBtn('quarterly', 'QUARTERLY') + tBtn('yearly', 'YEARLY') + '</div>';

  // Legend (rendered below the chart)
  var legendHtml = '<div style="font-size:9px;color:var(--dim);display:flex;gap:14px;flex-wrap:wrap;margin-top:12px">'
    + '<span style="display:inline-flex;align-items:center;gap:4px"><span style="display:inline-block;width:10px;height:10px;background:#5b9cf6"></span>Revenue</span>'
    + '<span style="display:inline-flex;align-items:center;gap:4px"><span style="display:inline-block;width:10px;height:10px;background:#5bf6e4"></span>Earnings</span>'
    + '<span style="display:inline-flex;align-items:center;gap:4px"><span style="display:inline-block;width:12px;height:2px;background:#c4a000"></span>Net Margin</span>'
    + '</div>';

  var chartW = Math.max(280, container.clientWidth || 340);

  if (sub === 'yearly') {
    var yearly = data.earnings && data.earnings.financialsChart && data.earnings.financialsChart.yearly;
    if (!yearly || !yearly.length) {
      container.innerHTML = toggleHtml + '<div style="color:var(--dim)">No yearly data available.</div>';
      return;
    }
    var years = yearly.slice().sort(function(a, b) { return (Number(a.date) || 0) - (Number(b.date) || 0); });

    var tbl = '<table class="fq-tbl"><thead><tr>'
      + '<th>Year</th><th>Revenue</th><th>Earnings</th><th>Net Margin</th>'
      + '</tr></thead><tbody>';
    for (var yk = 0; yk < years.length; yk++) {
      var y2 = years[yk];
      tbl += '<tr><td>' + fundEsc(y2.date || '—') + '</td>'
        + '<td>' + fundEsc(fundFmtOrRaw(y2.revenue)) + '</td>'
        + '<td>' + fundEsc(fundFmtOrRaw(y2.earnings)) + '</td>'
        + '<td>' + fundEsc(fundComputeMargin(y2.earnings, y2.revenue)) + '</td></tr>';
    }
    tbl += '</tbody></table>';

    container.innerHTML = toggleHtml
      + tbl
      + '<div style="margin-top:18px">' + fundBuildQuarterlyChart(years, chartW) + '</div>'
      + legendHtml;
    return;
  }

  // Quarterly (default)
  var fin = data.earnings && data.earnings.financialsChart && data.earnings.financialsChart.quarterly;
  var eps = data.earnings && data.earnings.earningsChart   && data.earnings.earningsChart.quarterly;
  if (!fin || !fin.length) {
    container.innerHTML = toggleHtml + '<div style="color:var(--dim)">No quarterly data available.</div>';
    return;
  }
  var byDate = {};
  for (var i = 0; i < fin.length; i++) {
    var q = fin[i];
    if (q.date) byDate[q.date] = { date: q.date, revenue: q.revenue, earnings: q.earnings, eps: null };
  }
  if (Array.isArray(eps)) {
    for (var j = 0; j < eps.length; j++) {
      var e = eps[j];
      if (!e.date) continue;
      if (byDate[e.date]) byDate[e.date].eps = e.actual;
      else byDate[e.date] = { date: e.date, revenue: null, earnings: null, eps: e.actual };
    }
  }
  var quarters = Object.keys(byDate).map(function(k) { return byDate[k]; })
    .sort(function(a, b) { return fundParseQDate(a.date) - fundParseQDate(b.date); });

  var html = '<table class="fq-tbl"><thead><tr>'
    + '<th>Quarter</th><th>Revenue</th><th>Earnings</th><th>Net Margin</th><th>EPS</th>'
    + '</tr></thead><tbody>';
  for (var k = 0; k < quarters.length; k++) {
    var q2 = quarters[k];
    var qlbl = q2.date ? q2.date.replace(/(Q)(20\d\d)/, "$1'$2") : '—';
    html += '<tr><td>' + fundEsc(qlbl) + '</td>'
      + '<td>' + fundEsc(fundFmtOrRaw(q2.revenue)) + '</td>'
      + '<td>' + fundEsc(fundFmtOrRaw(q2.earnings)) + '</td>'
      + '<td>' + fundEsc(fundComputeMargin(q2.earnings, q2.revenue)) + '</td>'
      + '<td>' + fundEsc(fundFmtOrRaw(q2.eps)) + '</td></tr>';
  }
  html += '</tbody></table>';

  container.innerHTML = toggleHtml
    + html
    + '<div style="margin-top:18px">' + fundBuildQuarterlyChart(quarters, chartW) + '</div>'
    + legendHtml;
}

// Switch between Quarterly and Yearly within the Earnings tab. State lives in
// window.earningsSubView (resets to 'quarterly' on page reload, persists within session).
function setEarningsSubView(view) {
  window.earningsSubView = view;
  if (moreState && moreState.tab === 'quarterly') {
    moreFetchAndRender('quarterly');
  }
}

/* ── Analyst renderer ───────────────────────────────────────────────────── */
function fundAvgTarget(history, days, currentPrice) {
  if (!Array.isArray(history) || !Number.isFinite(days) || days <= 0) return null;
  var cutoff = Math.floor(Date.now() / 1000) - days * 86400;
  var targets = [];
  for (var i = 0; i < history.length; i++) {
    if ((history[i].epochGradeDate || 0) >= cutoff) {
      var t = fundRawNum(history[i].currentPriceTarget);
      if (t !== null && t > 0) targets.push(t);
    }
  }
  if (!targets.length) return null;
  var sum = 0;
  for (var j = 0; j < targets.length; j++) sum += targets[j];
  var avg = sum / targets.length;
  var pctStr = '';
  if (currentPrice !== null && currentPrice > 0) {
    var p = (avg - currentPrice) / currentPrice * 100;
    pctStr = (p >= 0 ? '+' : '') + p.toFixed(2) + '%';
  }
  return { avg: avg, count: targets.length, pctStr: pctStr };
}

function fundRenderAnalyst(data, container) {
  var fd      = data.financialData;
  var trend   = data.recommendationTrend
    && data.recommendationTrend.trend && data.recommendationTrend.trend[0];
  var history = data.upgradeDowngradeHistory && data.upgradeDowngradeHistory.history;
  var currentPrice = fd ? fundRawNum(fd.currentPrice) : null;

  var targetItems  = [];
  var rightItems   = [];
  var summaryItems = [];

  if (fd) {
    var pushTarget = function(label, value) {
      if (!fundUseful(value)) return;
      var pct = '';
      var raw = fundRawNum(value);
      if (raw !== null && currentPrice !== null && currentPrice > 0) {
        var p2 = (raw - currentPrice) / currentPrice * 100;
        pct = (p2 >= 0 ? '+' : '') + p2.toFixed(2) + '%';
      }
      targetItems.push({ label: label, value: fundFmtOrRaw(value), pct: pct });
    };
    var pushPlain = function(arr, label, value) {
      if (!fundUseful(value)) return;
      arr.push({ label: label, value: fundFmtOrRaw(value) });
    };
    if (fundUseful(fd.currentPrice)) {
      targetItems.push({ label: 'currentPrice', value: fundFmtOrRaw(fd.currentPrice), pct: '' });
    }
    pushTarget('targetHighPrice',   fd.targetHighPrice);
    pushTarget('targetLowPrice',    fd.targetLowPrice);
    pushTarget('targetMeanPrice',   fd.targetMeanPrice);
    pushTarget('targetMedianPrice', fd.targetMedianPrice);
    pushPlain(summaryItems, 'recommendationMean', fd.recommendationMean);
    pushPlain(summaryItems, 'recommendationKey',  fd.recommendationKey);
    if (fundUseful(fd.numberOfAnalystOpinions)) {
      summaryItems.push({ label: '# of analysts', value: fundFmtOrRaw(fd.numberOfAnalystOpinions) });
    }
  }

  if (trend) {
    var voteKeys = ['strongBuy','buy','hold','sell','strongSell'];
    for (var ki = 0; ki < voteKeys.length; ki++) {
      var v = trend[voteKeys[ki]];
      if (v != null) rightItems.push({ label: voteKeys[ki], value: fundFmtOrRaw(v) });
    }
  }

  var hasTop     = targetItems.length > 0 || rightItems.length > 0;
  var hasSummary = summaryItems.length > 0;
  var hasHistory = Array.isArray(history) && history.length > 0;

  if (!hasTop && !hasSummary && !hasHistory) {
    container.innerHTML = '<div style="color:var(--dim)">No analyst data available.</div>';
    return;
  }

  var html = '';
  if (hasTop) {
    html += '<div style="overflow-x:auto"><div class="fa-top">';
    if (targetItems.length) {
      html += '<div class="fa-left">';
      for (var ti = 0; ti < targetItems.length; ti++) {
        html += '<span class="fa-lbl">' + fundEsc(targetItems[ti].label) + '</span>'
          + '<span class="fa-val">' + fundEsc(targetItems[ti].value) + '</span>'
          + '<span class="fa-pct">' + fundEsc(targetItems[ti].pct)   + '</span>';
      }
      html += '</div>';
    }
    if (rightItems.length) {
      if (targetItems.length) html += '<div class="fa-div"></div>';
      html += '<div class="fa-right">';
      for (var ri = 0; ri < rightItems.length; ri++) {
        html += '<span class="fa-lbl">' + fundEsc(rightItems[ri].label) + '</span>'
          + '<span class="fa-val">' + fundEsc(rightItems[ri].value) + '</span>';
      }
      html += '</div>';
    }
    html += '</div></div>';
  }
  if (hasSummary) {
    html += '<div class="fa-sum">';
    for (var si = 0; si < summaryItems.length; si++) {
      html += '<span class="fa-lbl">' + fundEsc(summaryItems[si].label) + '</span>'
        + '<span class="fa-val">' + fundEsc(summaryItems[si].value) + '</span>';
    }
    html += '</div>';
  }
  if (hasHistory) {
    var cutoff2 = Math.floor(Date.now() / 1000) - FUND_HIST_DAYS * 86400;
    var recent = history
      .filter(function(e2) { return (e2.epochGradeDate || 0) >= cutoff2; })
      .sort(function(a, b) { return (b.epochGradeDate || 0) - (a.epochGradeDate || 0); });
    var avgFixed = fundAvgTarget(history, FUND_HIST_DAYS, currentPrice);

    html += '<div class="fh-wrap"><div class="fh-sum">';
    html += '<span class="slbl">Avg&nbsp;target&nbsp;(' + FUND_HIST_DAYS + 'd)</span>';
    html += '<span class="sval">' + (avgFixed ? fundEsc(avgFixed.avg.toFixed(2)) : '—') + '</span>';
    html += '<span class="spct">' + (avgFixed ? fundEsc(avgFixed.pctStr) : '') + '</span>';
    html += '<span class="slbl">Avg&nbsp;target&nbsp;(<input type="text" class="fh-days" id="fund-cdays" maxlength="2" inputmode="numeric" value="' + FUND_HIST_DFLT + '">d)</span>';
    html += '<span class="sval" id="fund-cavg">—</span>';
    html += '<span class="spct" id="fund-cpct"></span>';
    html += '</div>';

    if (!recent.length) {
      html += '<div style="color:var(--dim);font-size:12px">No activity in last ' + FUND_HIST_DAYS + ' days.</div>';
    } else {
      html += '<div class="fh-scroll"><table class="fh-tbl"><thead><tr>'
        + '<th>Date</th><th>Firm</th><th>Grade</th><th class="n">Target</th><th class="n">Prior</th>'
        + '</tr></thead><tbody>';
      for (var hi = 0; hi < recent.length; hi++) {
        var he = recent[hi];
        var dt = he.epochGradeDate ? fundUnixDate(he.epochGradeDate) : '';
        var tgt = he.currentPriceTarget != null ? (fundFmtPrim(he.currentPriceTarget) || '') : '';
        var pri = he.priorPriceTarget   != null ? (fundFmtPrim(he.priorPriceTarget)   || '') : '';
        html += '<tr><td class="d">' + fundEsc(dt) + '</td>'
          + '<td>' + fundEsc(he.firm    || '') + '</td>'
          + '<td>' + fundEsc(he.toGrade || '') + '</td>'
          + '<td class="n">' + fundEsc(tgt) + '</td>'
          + '<td class="n">' + fundEsc(pri) + '</td></tr>';
      }
      html += '</tbody></table></div>';
    }
    html += '</div>';
  }

  container.innerHTML = html;

  if (hasHistory) {
    var daysInput = container.querySelector('#fund-cdays');
    if (daysInput) {
      var avgValEl = container.querySelector('#fund-cavg');
      var avgPctEl = container.querySelector('#fund-cpct');
      var updateCustom = function() {
        var days2 = parseInt(daysInput.value, 10);
        var result = fundAvgTarget(history, days2, currentPrice);
        avgValEl.textContent = result ? result.avg.toFixed(2) : '—';
        avgPctEl.textContent = result ? result.pctStr : '';
      };
      daysInput.addEventListener('input', function() {
        daysInput.value = daysInput.value.replace(/\D/g, '').slice(0, 2);
        updateCustom();
      });
      updateCustom();
    }
  }
}

/* ── More screen ────────────────────────────────────────────────────────── */
var MORE_TABS = {
  market:     { label: 'MARKET',    mods: ['price', 'summaryDetail'] },
  statistics: { label: 'KEY STATS', mods: ['defaultKeyStatistics', 'financialData', 'calendarEvents'] },
  quarterly:  { label: 'EARNINGS',  mods: ['earnings'] },
  analyst:    { label: 'ANALYSTS',  mods: ['financialData', 'recommendationTrend', 'upgradeDowngradeHistory'] },
  sentiment:  { label: 'SENTIMENT', mods: ['defaultKeyStatistics'] },
};

var moreState = null; // { ticker, modules, tab }

function moreFetchAndRender(tab) {
  var tabCfg = MORE_TABS[tab];
  var state  = moreState;
  if (!tabCfg || !state) return;
  var ticker = state.ticker;
  var body   = document.getElementById('fund-body');
  if (!body) return;

  var missing = tabCfg.mods.filter(function(m) { return !(m in state.modules); });

  // Persistent earnings cache (12h TTL) — read-through: if cached, skip refetch.
  // Shared with the Fundamentals side-by-side view.
  if (missing.indexOf('earnings') !== -1) {
    var ye = yearnCacheGet(ticker);
    if (ye) {
      state.modules.earnings = ye.data;
      missing = missing.filter(function(m) { return m !== 'earnings'; });
    }
  }

  function doRender() {
    if (!moreState || moreState.tab !== tab) return;
    var ct = document.getElementById('fund-body');
    if (!ct) return;
    var d = state.modules;
    if (tab === 'market') {
      fundRenderFieldGroups(FUND_MARKET_GROUPS, d, ct);
      var currency = (d.price && d.price.currency) || (d.summaryDetail && d.summaryDetail.currency);
      var currEl = document.getElementById('fund-currency');
      if (currEl && currency) currEl.textContent = currency;
    } else if (tab === 'statistics') {
      fundRenderFieldGroups(FUND_STATS_GROUPS, d, ct);
    } else if (tab === 'quarterly') {
      fundRenderQuarterly(d, ct);
    } else if (tab === 'analyst') {
      fundRenderAnalyst(d, ct);
    } else if (tab === 'sentiment') {
      fundRenderFieldGroups(FUND_SENT_GROUPS, d, ct);
    }
  }

  if (!missing.length) { doRender(); return; }

  body.innerHTML = '<div style="color:var(--dim);font-size:12px;font-family:var(--font)">Loading…</div>';

  fundFetchModules(ticker, missing.join(','))
    .then(function(result) {
      if (!moreState || moreState.ticker !== ticker) return;
      for (var i = 0; i < missing.length; i++) {
        state.modules[missing[i]] = (missing[i] in result) ? result[missing[i]] : null;
      }
      // Persistent earnings cache: write-through if earnings was just fetched
      if (missing.indexOf('earnings') !== -1) {
        yearnCacheSet(ticker, result.earnings || null);
      }
      if (result.price) {
        var currency2 = result.price.currency;
        var currEl2 = document.getElementById('fund-currency');
        if (currEl2 && currency2) currEl2.textContent = currency2;
      }
      doRender();
    })
    .catch(function(err) {
      var ct2 = document.getElementById('fund-body');
      if (ct2 && moreState && moreState.ticker === ticker) {
        ct2.innerHTML = '<div style="color:var(--dim);font-size:12px;font-family:var(--font)">Error: '
          + fundEsc(err.message || String(err)) + '</div>';
      }
    });
}

function openMore(ticker) {
  var existing = document.getElementById('fund-overlay');
  if (existing) existing.parentNode.removeChild(existing);

  moreState = { ticker: ticker, modules: {}, tab: 'market' };

  var tabBtns = Object.keys(MORE_TABS).map(function(tab) {
    return '<button class="ftab' + (tab === 'market' ? ' on' : '')
      + '" data-tab="' + tab + '" onclick="moreSwitchTab(\'' + tab + '\')">'
      + MORE_TABS[tab].label + '</button>';
  }).join('');

  var overlay = document.createElement('div');
  overlay.id = 'fund-overlay';
  overlay.innerHTML =
    '<div id="fund-hdr">'
    + '<span style="font-family:var(--font);font-size:13px;font-weight:600;letter-spacing:1px;color:var(--bright)">' + fundEsc(ticker) + '</span>'
    + '<span id="fund-currency" style="font-family:var(--font);font-size:11px;color:var(--dim)"></span>'
    + '<div style="flex:1;display:flex;gap:0;flex-wrap:wrap">' + tabBtns + '</div>'
    + '<button onclick="closeMore()" style="background:none;border:none;color:var(--dim);font-size:18px;cursor:pointer;padding:2px 8px;font-family:var(--font);line-height:1">✕</button>'
    + '</div>'
    + '<div id="fund-body"><div style="color:var(--dim);font-size:12px;font-family:var(--font)">Loading…</div></div>';

  overlay._escHandler = function(ev) { if (ev.key === 'Escape') closeMore(); };
  document.addEventListener('keydown', overlay._escHandler);
  document.body.appendChild(overlay);

  moreFetchAndRender('market');
}

function closeMore() {
  var overlay = document.getElementById('fund-overlay');
  if (!overlay) return;
  if (overlay._escHandler) document.removeEventListener('keydown', overlay._escHandler);
  overlay.parentNode.removeChild(overlay);
  moreState = null;
}

function moreSwitchTab(tab) {
  if (!moreState || tab === moreState.tab) return;
  moreState.tab = tab;
  var overlay = document.getElementById('fund-overlay');
  if (overlay) {
    overlay.querySelectorAll('.ftab').forEach(function(btn) {
      btn.classList.toggle('on', btn.dataset.tab === tab);
    });
  }
  moreFetchAndRender(tab);
}

/* ── Public API ─────────────────────────────────────────────────────────── */
window.buildFundamentalsRows = buildFundamentalsRows;
/* ── Side-by-side Fundamentals view: shared helpers ────────────────────── */

// Returns { tdCell, expandedRow } for a ticker.
// - tdCell: a <td> containing the ticker name, clickable to toggle expand
// - expandedRow: a full <tr><td colspan>...</td></tr> with the lite-expanded inner,
//   or '' if the row is not currently expanded
function fundTickerCellAndExpanded(ticker, cellStyle, colspan) {
  var hasPositions = (typeof positions !== 'undefined' && positions);
  var pos = hasPositions ? positions.find(function(p) { return p.ticker === ticker; }) : null;
  if (!pos) {
    return { tdCell: '<td style="' + cellStyle + '">' + fundEsc(ticker) + '</td>', expandedRow: '' };
  }
  var tdCell = '<td style="' + cellStyle + ';cursor:pointer" onclick="toggleExpand(' + pos.id + ')">' + fundEsc(ticker) + '</td>';
  var expandedRow = '';
  if (typeof expandedId !== 'undefined' && expandedId === pos.id && typeof buildExpandedInnerLite === 'function') {
    var group = positions.filter(function(p) { return p.ticker === ticker; });
    expandedRow = '<tr><td colspan="' + colspan + '" style="padding:10px 8px;background:var(--bg2);border-bottom:1px solid var(--border)">'
      + buildExpandedInnerLite(pos, group)
      + '</td></tr>';
  }
  return { tdCell: tdCell, expandedRow: expandedRow };
}

/* ── Side-by-side Fundamentals view: Targets sub-view ──────────────────── */
function fundFmtPrice(v) {
  if (v == null || isNaN(v)) return '<span style="color:var(--dim)">&mdash;</span>';
  return Number(v).toFixed(2);
}

function fundFmtPct(v) {
  if (v == null || isNaN(v)) return '<span style="color:var(--dim)">&mdash;</span>';
  var sign = v >= 0 ? '+' : '';
  var cls  = v >= 0 ? 'var(--green)' : 'var(--red)';
  return '<span style="color:' + cls + '">' + sign + Number(v).toFixed(2) + '%</span>';
}

function fundFmtPE(v) {
  if (v == null || isNaN(v) || v <= 0) return '<span style="color:var(--dim)">&mdash;</span>';
  return Number(v).toFixed(2);
}

function buildFundamentalsTargetsTable(tickers, currentMode, targetWindow) {
  if (!fundWorkerBase() || !fundWorkerToken()) {
    return '<div style="padding:36px 0;text-align:center;color:var(--dim);font-size:11px;letter-spacing:2px">CONFIGURE WORKER URL/TOKEN TO LOAD FUNDAMENTALS</div>';
  }

  var nowSec    = Math.floor(Date.now() / 1000);
  var cutoffSec = nowSec - targetWindow * 86400;

  var TH_DIM = 'text-align:right;padding:6px 8px;font-size:9px;color:var(--dim);letter-spacing:1px;border-bottom:1px solid var(--border);white-space:nowrap';
  var TH_GRN = 'text-align:right;padding:6px 8px;font-size:9px;letter-spacing:1px;border-bottom:1px solid var(--border);white-space:nowrap;cursor:pointer;color:var(--green)';
  var TD     = 'text-align:right;padding:6px 8px;font-size:11px;color:var(--bright);white-space:nowrap';
  // Group-edge borders: BL = left edge of a group, BR = right edge of a group.
  // With border-collapse:collapse, adjacent BR+BL merge into a single line.
  var BL = ';border-left:1px solid var(--border)';
  var BR = ';border-right:1px solid var(--border)';

  var curLabel = currentMode === 'reg' ? 'REG.PRICE' : 'CURRENT';
  var winLabel = targetWindow + 'D TGT';

  var head = '<thead><tr>'
    + '<th style="text-align:left;padding:6px 8px;font-size:9px;color:var(--dim);letter-spacing:1px;border-bottom:1px solid var(--border)">TICKER</th>'
    + '<th style="' + TH_GRN + '" onclick="toggleFundCurrentMenu(this)">' + curLabel + '</th>'
    + '<th style="' + TH_DIM + BL + '">AVG TGT</th>'
    + '<th style="' + TH_DIM + BR + '">%</th>'
    + '<th style="' + TH_GRN + BL + '" onclick="toggleFundWindowMenu(this)">' + winLabel + '</th>'
    + '<th style="' + TH_DIM + BR + '">%</th>'
    + '<th style="' + TH_DIM + '">P/E</th>'
    + '<th style="' + TH_DIM + '">FW P/E</th>'
    + '</tr></thead>';

  var TD_TICKER = 'text-align:left;padding:6px 8px;font-size:11px;color:var(--bright);white-space:nowrap';
  var rows = '';
  for (var i = 0; i < tickers.length; i++) {
    var ticker = tickers[i];
    var pos = (typeof positions !== 'undefined' && positions)
      ? positions.find(function(p) { return p.ticker === ticker; })
      : null;
    var live = pos ? (currentMode === 'reg' ? pos.regularMarketPrice : pos.current) : null;
    if (live == null && pos) live = pos.current;

    var cellInfo = fundTickerCellAndExpanded(ticker, TD_TICKER, 8);

    var cached = fundCacheGet(ticker);
    if (!cached) {
      if (!fundInflight[ticker]) {
        fundInflight[ticker] = fundFetchRow(ticker).then(function() {
          delete fundInflight[ticker];
          if (typeof render === 'function') render();
        });
      }
      rows += '<tr>'
        + cellInfo.tdCell
        + '<td style="' + TD + '">' + fundFmtPrice(live) + '</td>'
        + '<td colspan="6" style="text-align:center;padding:6px 8px;font-size:11px;color:var(--dim)">&hellip;</td>'
        + '</tr>'
        + cellInfo.expandedRow;
      continue;
    }

    var avgTgt   = cached.targetMeanPrice;
    var winTgt   = fundAvgInWindow(cached.targets, cutoffSec);
    var trailEps = cached.trailingEps;
    var trailPE  = (live != null && trailEps != null && trailEps > 0) ? (live / trailEps) : null;
    var fwdPE    = cached.forwardPE;

    var avgPct = (live != null && avgTgt != null && live > 0) ? ((avgTgt / live - 1) * 100) : null;
    var winPct = (live != null && winTgt != null && live > 0) ? ((winTgt / live - 1) * 100) : null;

    rows += '<tr>'
      + cellInfo.tdCell
      + '<td style="' + TD + '">' + fundFmtPrice(live) + '</td>'
      + '<td style="' + TD + BL + '">' + fundFmtPrice(avgTgt) + '</td>'
      + '<td style="' + TD + BR + '">' + fundFmtPct(avgPct) + '</td>'
      + '<td style="' + TD + BL + '">' + fundFmtPrice(winTgt) + '</td>'
      + '<td style="' + TD + BR + '">' + fundFmtPct(winPct) + '</td>'
      + '<td style="' + TD + '">' + fundFmtPE(trailPE) + '</td>'
      + '<td style="' + TD + '">' + fundFmtPE(fwdPE) + '</td>'
      + '</tr>'
      + cellInfo.expandedRow;
  }

  return '<div style="overflow-x:auto;margin-top:6px"><table style="border-collapse:collapse;width:100%">'
    + head
    + '<tbody>' + rows + '</tbody>'
    + '</table></div>';
}

window.buildFundamentalsTargetsTable = buildFundamentalsTargetsTable;

function fundFmtCount(v) {
  if (v == null || isNaN(v)) return '<span style="color:var(--dim)">&mdash;</span>';
  return String(Math.round(v));
}

function buildFundamentalsRatingsTable(tickers) {
  if (!fundWorkerBase() || !fundWorkerToken()) {
    return '<div style="padding:36px 0;text-align:center;color:var(--dim);font-size:11px;letter-spacing:2px">CONFIGURE WORKER URL/TOKEN TO LOAD FUNDAMENTALS</div>';
  }

  // All columns same fixed width — narrow; long headers wrap onto multiple lines.
  var COL_W_PX = 50;
  var COL_W = COL_W_PX + 'px';
  var TBL_W = (COL_W_PX * 6) + 'px';
  // Header styles: allow wrap, vertical-align center for visual balance with single-word headers.
  var TH_DIM = 'text-align:right;padding:6px 4px;font-size:9px;color:var(--dim);letter-spacing:1px;border-bottom:1px solid var(--border);vertical-align:middle;width:' + COL_W;
  var TH_TICKER = 'text-align:left;padding:6px 4px;font-size:9px;color:var(--dim);letter-spacing:1px;border-bottom:1px solid var(--border);vertical-align:middle;width:' + COL_W;
  // Body cells: numbers never wrap, stay on one line.
  var TD     = 'text-align:right;padding:6px 4px;font-size:11px;color:var(--bright);white-space:nowrap;width:' + COL_W;
  var TD_TICKER = 'text-align:left;padding:6px 4px;font-size:11px;color:var(--bright);white-space:nowrap;width:' + COL_W;

  var head = '<thead><tr>'
    + '<th style="' + TH_TICKER + '">TICKER</th>'
    + '<th style="' + TH_DIM + '">STRONG BUY</th>'
    + '<th style="' + TH_DIM + '">BUY</th>'
    + '<th style="' + TH_DIM + '">HOLD</th>'
    + '<th style="' + TH_DIM + '">SELL</th>'
    + '<th style="' + TH_DIM + '">STRONG SELL</th>'
    + '</tr></thead>';

  var rows = '';
  for (var i = 0; i < tickers.length; i++) {
    var ticker = tickers[i];
    var cellInfo = fundTickerCellAndExpanded(ticker, TD_TICKER, 6);
    var cached = fundCacheGet(ticker);

    if (!cached) {
      if (!fundInflight[ticker]) {
        fundInflight[ticker] = fundFetchRow(ticker).then(function() {
          delete fundInflight[ticker];
          if (typeof render === 'function') render();
        });
      }
      rows += '<tr>'
        + cellInfo.tdCell
        + '<td colspan="5" style="text-align:center;padding:6px 4px;font-size:11px;color:var(--dim)">&hellip;</td>'
        + '</tr>'
        + cellInfo.expandedRow;
      continue;
    }

    rows += '<tr>'
      + cellInfo.tdCell
      + '<td style="' + TD + '">' + fundFmtCount(cached.strongBuy) + '</td>'
      + '<td style="' + TD + '">' + fundFmtCount(cached.buy) + '</td>'
      + '<td style="' + TD + '">' + fundFmtCount(cached.hold) + '</td>'
      + '<td style="' + TD + '">' + fundFmtCount(cached.sell) + '</td>'
      + '<td style="' + TD + '">' + fundFmtCount(cached.strongSell) + '</td>'
      + '</tr>'
      + cellInfo.expandedRow;
  }

  return '<div style="overflow-x:auto;margin-top:6px"><table style="border-collapse:collapse;table-layout:fixed;width:' + TBL_W + ';min-width:0">'
    + head
    + '<tbody>' + rows + '</tbody>'
    + '</table></div>';
}

window.buildFundamentalsRatingsTable = buildFundamentalsRatingsTable;

/* ── Earnings cache (yearn_<TICKER>) ────────────────────────────────────
   Stores the raw `earnings` module from Yahoo, 12h TTL, schema-versioned.
   Used by Fundamentals view (Earnings/EPS sub-views) and by More (Quarterly).
   The same cache entry is read/written from both call sites. */
var YEARN_CACHE_TTL = 12 * 60 * 60 * 1000;
var YEARN_CACHE_VER = 1;
var yearnInflight = {};

function yearnCacheKey(ticker) { return 'yearn_' + ticker.toUpperCase(); }

function yearnCacheGet(ticker) {
  try {
    var raw = localStorage.getItem(yearnCacheKey(ticker));
    if (!raw) return null;
    var entry = JSON.parse(raw);
    if (!entry || !entry.ts) return null;
    if (entry.v !== YEARN_CACHE_VER) return null;
    if (Date.now() - entry.ts > YEARN_CACHE_TTL) return null;
    return entry; // caller reads entry.data (may be null for ETFs with no earnings)
  } catch(e) { return null; }
}

function yearnCacheSet(ticker, earningsModule) {
  try {
    var obj = { v: YEARN_CACHE_VER, ts: Date.now(), data: earningsModule || null };
    localStorage.setItem(yearnCacheKey(ticker), JSON.stringify(obj));
  } catch(e) {}
}

// Standalone fetch with normalized error handling — caches null for ETFs / no-data,
// skips cache write only on network/parse errors (so next attempt can retry).
function yearnFetch(ticker) {
  var base  = fundWorkerBase();
  var token = fundWorkerToken();
  if (!base || !token) return Promise.resolve();
  var url = base + '/api/quotesummary?ticker=' + encodeURIComponent(ticker) + '&modules=earnings';
  return fetch(url, { headers: { 'X-API-Token': token } })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      var result = (!data._error && data.quoteSummary && !data.quoteSummary.error)
        ? (data.quoteSummary.result && data.quoteSummary.result[0])
        : null;
      var earnings = result && result.earnings ? result.earnings : null;
      yearnCacheSet(ticker, earnings);
    })
    .catch(function() {}); // network error: don't cache, allow retry next time
}

/* ── Side-by-side Fundamentals view: Earnings + EPS sub-views ─────────── */

// "1Q2024" → "Q1-24"
function fundFormatQuarter(dateStr) {
  if (!dateStr) return '';
  var m = String(dateStr).match(/^(\d)Q(\d{4})$/);
  if (!m) return String(dateStr);
  return 'Q' + m[1] + '-' + m[2].slice(2);
}

// Growth percentage with abs-denominator (works correctly across negative bases).
function fundFmtGrowthPct(curr, prev) {
  if (curr == null || prev == null || isNaN(curr) || isNaN(prev) || prev === 0) {
    return '<span style="color:var(--dim)">&mdash;</span>';
  }
  var pct = (curr - prev) / Math.abs(prev) * 100;
  var sign = pct >= 0 ? '+' : '';
  var cls  = pct >= 0 ? 'var(--green)' : 'var(--red)';
  return '<span style="color:' + cls + '">' + sign + pct.toFixed(1) + '%</span>';
}

function fundFmtEps(v) {
  if (v == null || isNaN(v)) return '<span style="color:var(--dim)">&mdash;</span>';
  return Number(v).toFixed(2);
}

// Helper: trigger fetch + render-on-arrival pattern for a ticker.
function yearnEnsure(ticker) {
  if (yearnInflight[ticker]) return;
  yearnInflight[ticker] = yearnFetch(ticker).then(function() {
    delete yearnInflight[ticker];
    if (typeof render === 'function') render();
  });
}

function buildFundamentalsEarningsTable(tickers) {
  if (!fundWorkerBase() || !fundWorkerToken()) {
    return '<div style="padding:36px 0;text-align:center;color:var(--dim);font-size:11px;letter-spacing:2px">CONFIGURE WORKER URL/TOKEN TO LOAD FUNDAMENTALS</div>';
  }

  // Collect data and pick quarter labels from the first ticker that has ≥3 quarters.
  var rowData = [];
  var quarterLabels = null;

  for (var i = 0; i < tickers.length; i++) {
    var ticker = tickers[i];
    var entry  = yearnCacheGet(ticker);
    if (!entry) {
      yearnEnsure(ticker);
      rowData.push({ ticker: ticker, fin: null, loading: true });
      continue;
    }
    var fin = entry.data && entry.data.financialsChart && entry.data.financialsChart.quarterly;
    fin = Array.isArray(fin) ? fin : null;
    rowData.push({ ticker: ticker, fin: fin, loading: false });
    if (!quarterLabels && fin && fin.length >= 3) {
      quarterLabels = fin.slice(-3).map(function(q) { return fundFormatQuarter(q.date); });
    }
  }
  if (!quarterLabels) quarterLabels = ['—', '—', '—'];

  var COL_W_PX = 50;
  var COL_W = COL_W_PX + 'px';
  var TBL_W = (COL_W_PX * 7) + 'px'; // 1 ticker + 3 quarters × 2 sub-cols
  var TH_TICKER = 'text-align:left;padding:6px 4px;font-size:9px;color:var(--dim);letter-spacing:1px;border-bottom:1px solid var(--border);vertical-align:middle;width:' + COL_W;
  var TH_Q  = 'text-align:center;padding:6px 4px;font-size:9px;color:var(--dim);letter-spacing:1px;border-bottom:1px solid var(--border);vertical-align:middle';
  var TH_SUB = 'text-align:right;padding:4px 4px;font-size:9px;color:var(--dim);letter-spacing:1px;border-bottom:1px solid var(--border);vertical-align:middle;width:' + COL_W;
  var TD     = 'text-align:right;padding:6px 4px;font-size:11px;color:var(--bright);white-space:nowrap;width:' + COL_W;
  var TD_TICKER = 'text-align:left;padding:6px 4px;font-size:11px;color:var(--bright);white-space:nowrap;width:' + COL_W;
  var TD_DASH = '<span style="color:var(--dim)">&mdash;</span>';
  // Group-edge borders for quarter blocks: BL = left edge, BR = right edge.
  var BL = ';border-left:1px solid var(--border)';
  var BR = ';border-right:1px solid var(--border)';

  var head = '<thead>'
    + '<tr>'
    + '<th rowspan="2" style="' + TH_TICKER + '">TICKER</th>'
    + '<th colspan="2" style="' + TH_Q + BL + BR + '">' + fundEsc(quarterLabels[0]) + '</th>'
    + '<th colspan="2" style="' + TH_Q + BL + BR + '">' + fundEsc(quarterLabels[1]) + '</th>'
    + '<th colspan="2" style="' + TH_Q + BL + BR + '">' + fundEsc(quarterLabels[2]) + '</th>'
    + '</tr>'
    + '<tr>'
    + '<th style="' + TH_SUB + BL + '">REV</th><th style="' + TH_SUB + BR + '">EARN</th>'
    + '<th style="' + TH_SUB + BL + '">REV</th><th style="' + TH_SUB + BR + '">EARN</th>'
    + '<th style="' + TH_SUB + BL + '">REV</th><th style="' + TH_SUB + BR + '">EARN</th>'
    + '</tr>'
    + '</thead>';

  function qVal(q, field) { return q ? fundRawNum(q[field]) : null; }
  function pairCells(prev, curr) {
    return '<td style="' + TD + BL + '">' + fundFmtGrowthPct(qVal(curr, 'revenue'), qVal(prev, 'revenue')) + '</td>'
         + '<td style="' + TD + BR + '">' + fundFmtGrowthPct(qVal(curr, 'earnings'), qVal(prev, 'earnings')) + '</td>';
  }

  var rows = '';
  rowData.forEach(function(rd) {
    var cellInfo = fundTickerCellAndExpanded(rd.ticker, TD_TICKER, 7);
    if (rd.loading) {
      rows += '<tr>'
        + cellInfo.tdCell
        + '<td colspan="6" style="text-align:center;padding:6px 4px;font-size:11px;color:var(--dim)">&hellip;</td>'
        + '</tr>'
        + cellInfo.expandedRow;
      return;
    }
    var fin = rd.fin;
    if (!fin || fin.length < 2) {
      rows += '<tr>'
        + cellInfo.tdCell
        + '<td style="' + TD + BL + '">' + TD_DASH + '</td><td style="' + TD + BR + '">' + TD_DASH + '</td>'
        + '<td style="' + TD + BL + '">' + TD_DASH + '</td><td style="' + TD + BR + '">' + TD_DASH + '</td>'
        + '<td style="' + TD + BL + '">' + TD_DASH + '</td><td style="' + TD + BR + '">' + TD_DASH + '</td>'
        + '</tr>'
        + cellInfo.expandedRow;
      return;
    }
    var n = fin.length;
    // Column 0 = growth at fin[n-3] (needs fin[n-4])
    // Column 1 = growth at fin[n-2] (needs fin[n-3])
    // Column 2 = growth at fin[n-1] (needs fin[n-2])
    var prev0 = n >= 4 ? fin[n-4] : null, curr0 = n >= 3 ? fin[n-3] : null;
    var prev1 = n >= 3 ? fin[n-3] : null, curr1 = n >= 2 ? fin[n-2] : null;
    var prev2 = n >= 2 ? fin[n-2] : null, curr2 = n >= 1 ? fin[n-1] : null;

    rows += '<tr>'
      + cellInfo.tdCell
      + pairCells(prev0, curr0)
      + pairCells(prev1, curr1)
      + pairCells(prev2, curr2)
      + '</tr>'
      + cellInfo.expandedRow;
  });

  return '<div style="overflow-x:auto;margin-top:6px"><table style="border-collapse:collapse;table-layout:fixed;width:' + TBL_W + ';min-width:0">'
    + head
    + '<tbody>' + rows + '</tbody>'
    + '</table></div>';
}

function buildFundamentalsEpsTable(tickers) {
  if (!fundWorkerBase() || !fundWorkerToken()) {
    return '<div style="padding:36px 0;text-align:center;color:var(--dim);font-size:11px;letter-spacing:2px">CONFIGURE WORKER URL/TOKEN TO LOAD FUNDAMENTALS</div>';
  }

  var rowData = [];
  var quarterLabels = null;

  for (var i = 0; i < tickers.length; i++) {
    var ticker = tickers[i];
    var entry  = yearnCacheGet(ticker);
    if (!entry) {
      yearnEnsure(ticker);
      rowData.push({ ticker: ticker, eps: null, loading: true });
      continue;
    }
    var eps = entry.data && entry.data.earningsChart && entry.data.earningsChart.quarterly;
    eps = Array.isArray(eps) ? eps : null;
    rowData.push({ ticker: ticker, eps: eps, loading: false });
    if (!quarterLabels && eps && eps.length >= 1) {
      var lastFour = eps.slice(-4);
      while (lastFour.length < 4) lastFour.unshift(null);
      quarterLabels = lastFour.map(function(q) { return q ? fundFormatQuarter(q.date) : '—'; });
    }
  }
  if (!quarterLabels) quarterLabels = ['—','—','—','—'];

  var COL_W_PX = 50;
  var COL_W = COL_W_PX + 'px';
  var TBL_W = (COL_W_PX * 5) + 'px';
  var TH_DIM = 'text-align:right;padding:6px 4px;font-size:9px;color:var(--dim);letter-spacing:1px;border-bottom:1px solid var(--border);vertical-align:middle;width:' + COL_W;
  var TH_TICKER = 'text-align:left;padding:6px 4px;font-size:9px;color:var(--dim);letter-spacing:1px;border-bottom:1px solid var(--border);vertical-align:middle;width:' + COL_W;
  var TD     = 'text-align:right;padding:6px 4px;font-size:11px;color:var(--bright);white-space:nowrap;width:' + COL_W;
  var TD_TICKER = 'text-align:left;padding:6px 4px;font-size:11px;color:var(--bright);white-space:nowrap;width:' + COL_W;
  var TD_DASH = '<span style="color:var(--dim)">&mdash;</span>';

  var head = '<thead><tr>'
    + '<th style="' + TH_TICKER + '">TICKER</th>'
    + quarterLabels.map(function(q) { return '<th style="' + TH_DIM + '">' + fundEsc(q) + '</th>'; }).join('')
    + '</tr></thead>';

  var rows = '';
  rowData.forEach(function(rd) {
    var cellInfo = fundTickerCellAndExpanded(rd.ticker, TD_TICKER, 5);
    if (rd.loading) {
      rows += '<tr>'
        + cellInfo.tdCell
        + '<td colspan="4" style="text-align:center;padding:6px 4px;font-size:11px;color:var(--dim)">&hellip;</td>'
        + '</tr>'
        + cellInfo.expandedRow;
      return;
    }
    var eps = rd.eps;
    if (!eps || !eps.length) {
      rows += '<tr>'
        + cellInfo.tdCell
        + '<td style="' + TD + '">' + TD_DASH + '</td>'
        + '<td style="' + TD + '">' + TD_DASH + '</td>'
        + '<td style="' + TD + '">' + TD_DASH + '</td>'
        + '<td style="' + TD + '">' + TD_DASH + '</td>'
        + '</tr>'
        + cellInfo.expandedRow;
      return;
    }
    var last4 = eps.slice(-4);
    while (last4.length < 4) last4.unshift(null);

    rows += '<tr>'
      + cellInfo.tdCell
      + last4.map(function(q) {
          var v = q && q.actual ? fundRawNum(q.actual) : null;
          return '<td style="' + TD + '">' + fundFmtEps(v) + '</td>';
        }).join('')
      + '</tr>'
      + cellInfo.expandedRow;
  });

  return '<div style="overflow-x:auto;margin-top:6px"><table style="border-collapse:collapse;table-layout:fixed;width:' + TBL_W + ';min-width:0">'
    + head
    + '<tbody>' + rows + '</tbody>'
    + '</table></div>';
}

window.buildFundamentalsEarningsTable = buildFundamentalsEarningsTable;
window.buildFundamentalsEpsTable      = buildFundamentalsEpsTable;

window.openMore              = openMore;
window.closeMore             = closeMore;
window.moreSwitchTab         = moreSwitchTab;
window.setEarningsSubView    = setEarningsSubView;

})();
