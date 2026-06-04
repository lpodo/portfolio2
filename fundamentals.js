// fundamentals.js — Yahoo Finance research data
// 4th-row compact display in expanded positions + fullscreen More screen

(function() {
'use strict';

/* ── Constants ──────────────────────────────────────────────────────────── */
var FUND_CACHE_TTL  = 4 * 60 * 60 * 1000;
var FUND_ROW_MODS   = 'financialData,defaultKeyStatistics,recommendationTrend';
var FUND_ACCENT     = '#5b9cf6';
var FUND_HIST_DAYS  = 100;
var FUND_HIST_DFLT  = 30;

/* ── CSS ────────────────────────────────────────────────────────────────── */
(function injectCss() {
  var s = document.getElementById('fund-css');
  if (!s) { s = document.createElement('style'); s.id = 'fund-css'; document.head.appendChild(s); }
  s.textContent =
    '#fund-overlay{position:fixed;inset:0;z-index:9999;background:var(--bg);display:flex;flex-direction:column;overflow:hidden}' +
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
    if (Date.now() - entry.ts > FUND_CACHE_TTL) return null;
    return entry;
  } catch(e) { return null; }
}

function fundCacheSet(ticker, data) {
  try {
    var obj = { ts: Date.now() };
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
      // Always cache (including nulls for ETFs) to avoid repeated fetches
      fundCacheSet(ticker, {
        financialData:        (result && result.financialData)        || null,
        defaultKeyStatistics: (result && result.defaultKeyStatistics) || null,
        recommendationTrend:  (result && result.recommendationTrend)  || null
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

  var fd  = cached.financialData;
  var dks = cached.defaultKeyStatistics;
  var rt  = cached.recommendationTrend;
  var ROW = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:5px;font-size:10px;letter-spacing:1px';
  var DIM = 'color:var(--dim)';
  var BRT = 'color:var(--bright)';
  var html = '';

  // Line 1: analyst vote breakdown — label dim, count bright
  var trend = rt && rt.trend && rt.trend[0];
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
  if (fd) {
    var targetMean   = fundRawNum(fd.targetMeanPrice);
    var currentPrice = fundRawNum(fd.currentPrice);
    if (targetMean !== null && currentPrice !== null && currentPrice > 0) {
      var pct = (targetMean - currentPrice) / currentPrice * 100;
      var pctStr = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
      html += '<div style="' + ROW + '">'
        + '<span style="' + DIM + '">Avg&nbsp;target</span>'
        + '<span style="' + BRT + '">' + fundEsc(targetMean.toFixed(2)) + '</span>'
        + '<span style="' + DIM + '">(' + fundEsc(pctStr) + ')</span>'
        + '</div>';
    }
  }

  // Line 3: P/E, fw P/E, [More]
  var moreBtn = '<span onclick="openMore(\'' + ticker.replace(/'/g, "\\'") + '\')"'
    + ' style="cursor:pointer;font-size:10px;color:' + FUND_ACCENT + ';border:1px solid '
    + FUND_ACCENT + ';padding:1px 6px;font-family:var(--font);user-select:none">&#8250;</span>';

  var line3 = '<div style="' + ROW + '">';
  if (fd && dks) {
    var price = fundRawNum(fd.currentPrice);
    var tEps  = fundRawNum(dks.trailingEps);
    if (price !== null && tEps !== null && tEps !== 0) {
      var pe = price / tEps;
      if (pe > 0 && pe < 10000) {
        line3 += '<span style="' + DIM + '">P/E</span>&nbsp;<span style="' + BRT + '">' + fundEsc(pe.toFixed(2)) + '</span>&nbsp;&nbsp;';
      }
    }
  }
  if (dks) {
    var fwPE = fundRawNum(dks.forwardPE);
    if (fwPE !== null && fwPE > 0 && fwPE < 10000) {
      line3 += '<span style="' + DIM + '">fw&nbsp;P/E</span>&nbsp;<span style="' + BRT + '">' + fundEsc(fwPE.toFixed(2)) + '</span>&nbsp;&nbsp;';
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

function fundRenderQuarterly(data, container) {
  var fin = data.earnings && data.earnings.financialsChart && data.earnings.financialsChart.quarterly;
  var eps = data.earnings && data.earnings.earningsChart   && data.earnings.earningsChart.quarterly;
  if (!fin || !fin.length) {
    container.innerHTML = '<div style="color:var(--dim)">No quarterly data available.</div>';
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
  container.innerHTML = html;
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
  quarterly:  { label: 'QUARTERLY', mods: ['earnings'] },
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
window.openMore              = openMore;
window.closeMore             = closeMore;
window.moreSwitchTab         = moreSwitchTab;

})();
