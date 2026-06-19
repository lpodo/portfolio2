# Refactoring proposal: move GBp normalization fully into frontend (thin-worker direction)

**Status:** Planned future direction, not yet implemented. The codebase
currently uses **option C** (GBp normalization split between worker and
frontend by data type). This document describes the intended target
state — **option E** — where the worker becomes a true thin proxy and
all currency normalization lives in one frontend module.

For an alternative direction (move everything into the worker), see the
companion document `REFACTORING_GBp_to_worker.md` describing **option D**.
D was analyzed and rejected in favor of E because the project's
deliberate design choice is to keep the worker lightweight.

## Current state (option C, as of GBp bug fix)

GBp normalization happens in two layers:

1. **Worker** normalizes price-tick fields in real-time endpoints:
   - `/api/quote` divides price by 100 for `meta.currency === 'GBp'`,
     returns `currency: 'GBP'`.
   - `/api/history` does the same for the closes array.
   - `/api/quotesummary` is a pure passthrough.

2. **Frontend** (`fundamentals.js`) normalizes fundamentals-data fields:
   - `fundFetchRow` requests the `price` module, detects
     `price.currency === 'GBp'`, divides `currentPrice`,
     `targetMeanPrice`, `targets[].target`, and `forwardPE` by 100
     before caching.

This works correctly but has an architectural asymmetry: two layers
encode knowledge about GBp. Option E removes the asymmetry by pulling
the worker's GBp logic out and centralizing everything in frontend.

## Option E: thin worker, frontend handles all GBp

**Idea:** worker becomes a near-pure proxy that does not modify Yahoo's
units. Frontend has one module (or one clearly-scoped section) that
knows everything about GBp and applies normalization at each fetch
boundary.

### What changes

**Worker becomes:**
- `/api/quote`: returns `currency: 'GBp'` and price in pence, raw from
  Yahoo. The `if (rawCurrency === 'GBp') lastPrice = lastPrice / 100`
  block is removed (currently lines ~225-227, ~284 in worker.js, plus
  the normalization of `meta.currency` to `'GBP'`).
- `/api/history`: returns `currency: 'GBp'` and closes in pence, raw
  from Yahoo. The normalization in `/api/history` (currently around
  lines ~158-170) is removed.
- `/api/quotesummary`: unchanged (already a passthrough).
- All worker GBp-related code is removed. Worker no longer knows that
  GBp is a thing.

**Frontend gains a centralized normalization module:**
- Functions, all in one place (suggested location: a new section near
  the top of `fundamentals.js`, or a dedicated `gbp.js` if scope grows):
  - `normalizeQuoteResponse(data)` — for `/api/quote` responses.
  - `normalizeHistoryResponse(data)` — for `/api/history` responses.
  - `normalizeQuotesummaryResponse(data)` — for `/api/quotesummary`
    responses (replaces the inline logic currently in `fundFetchRow`).
- Each function knows its own list of fields to convert when GBp is
  detected. The detection rule is the same across all: check
  `data.currency` (or `data.quoteSummary.result[0].price.currency`)
  against `'GBp'`.
- Optional: a tiny shared helper `gbpScale(value)` that returns
  `value / 100` for clarity in call sites.

**Call sites in frontend:**
- `fetchPrice` (in `index.html`): after receiving response from worker,
  apply `normalizeQuoteResponse` before assigning to `__currency`,
  `__regularMarketPrice`, etc.
- Chart history loader (in `index.html`, likely `loadChartData` /
  `loadPositionsChartData`): apply `normalizeHistoryResponse` before
  passing closes to the chart renderer.
- `fundFetchRow` (in `fundamentals.js`): use
  `normalizeQuotesummaryResponse` instead of the inline `px()` helper.

### Pros

- **Single source of truth.** Anyone curious about how GBp works opens
  one file and sees all the rules in one section.
- **Worker truly thin.** Closer to the project's original design intent
  — worker is a network adapter and auth proxy, not a data interpreter.
- **Adding new currencies is one place.** If ZAc (South African cents)
  or ILA (Israeli agorot) ever surfaces, add one branch in the
  normalization module and update each field-list.
- **Adding new fields is one place.** If we start consuming a new field
  from `/api/quotesummary` that's GBp-affected, registering it goes
  next to other field registrations.
- **Easier to test in isolation.** Normalization is a pure function:
  input data → output data. Can be unit-tested without touching network.
- **Worker re-usable as is.** Anyone wanting raw Yahoo values gets them
  cleanly from the worker; normalization is opt-in at the consumer.

### Cons / risks

- **Touches multiple frontend call sites.** Three (fetchPrice, history
  loader, fundFetchRow) in two files. Each must be updated and tested.
- **Worker change risks regression.** The GBp conversion in
  `/api/quote` and `/api/history` has been working stably for a long
  time. Removing it requires confidence that the frontend handles every
  call site.
- **Synchronized deploy required.** Frontend must be deployed before
  worker, or there's a window where worker still returns normalized
  data but frontend assumes raw — except the frontend normalizer
  conditions on `currency === 'GBp'`, so it's a no-op for old worker
  responses. So safe order is: frontend first, then worker. Not atomic
  but no broken state in between.
- **Cache compatibility.** The chart history cache (`chart_hist_*`)
  contains already-converted GBP closes from the current worker. After
  worker stops normalizing, new fetches return GBp. Existing cache
  entries would be in GBP, new ones would be normalized by frontend
  also resulting in GBP. So no version bump strictly needed, but a
  bump on `CHART_HIST_VER` (if it exists) is a clean safety net.
  `fundCache` was already bumped to v2 in option C.

### Migration plan

1. **Phase 1 — frontend prep:**
   - Add normalization module to frontend with three functions.
   - Wire `fetchPrice` to call `normalizeQuoteResponse`.
   - Wire chart history loader to call `normalizeHistoryResponse`.
   - Refactor `fundFetchRow` to use `normalizeQuotesummaryResponse`
     (currently uses inline `px()`).
   - Deploy frontend. Verify behavior unchanged — worker still
     normalizes quote/history, so frontend normalizers are no-ops for
     those (currency is already 'GBP', branch doesn't fire). Behavior
     is identical to option C state.

2. **Phase 2 — worker simplification:**
   - Remove GBp conversion from `/api/quote` (the
     `if (rawCurrency === 'GBp')` blocks in `getQuote`).
   - Remove GBp conversion from `/api/history`.
   - Remove `meta.currency = 'GBP'` normalization.
   - Deploy worker. Now responses contain raw GBp values and
     `currency: 'GBp'`. Frontend normalizers activate.

3. **Phase 3 — verification:**
   - Test with a known UK ticker (e.g., RR.L). Verify prices, charts,
     fundamentals all show pound values.
   - Check that non-UK tickers are unaffected.

4. **Phase 4 — cleanup (optional):**
   - Bump cache versions if any stale data could be in pence.
   - Remove the `price` module from `FUND_ROW_MODS` if no longer needed
     — actually it stays, because frontend still needs it to detect
     `price.currency`.

### Why E over D

D pulls everything into the worker; E pulls everything into the
frontend. The choice between them is driven by where you want
non-trivial logic to live.

This project's design favors a thin worker (the comment in `worker.js`
and the user's stated preference). Putting interpretive logic in the
worker would contradict that. E aligns with the project's design
philosophy; D contradicts it.

### Why not just leave C

C is fine and shipping. Reasons to do E anyway:
- Reduces cognitive load when working on currency-related code (one
  place instead of two layers).
- Aligns architecture with project's stated thin-worker goal.
- Sets a clean pattern for any future sub-currency or unit conversion.

Reasons to leave C alone:
- C works.
- Refactor effort vs benefit ratio is low for a single-user app.
- The split in C is defensible: worker handles simple universal fields
  in hot path, frontend handles complex multi-field responses. It's
  not arbitrary, even if it's not pretty.

## When to revisit option E

Trigger E when:
- A new sub-currency emerges (ZAc, ILA, etc.) — implementing it in
  multiple places under C creates more pain than the E refactor.
- A new fetch endpoint is added that needs currency awareness — three
  call sites becomes four, and the pattern stops looking exceptional.
- We do a worker rewrite for any other reason — opportunistic timing
  to align worker scope with the thin-proxy goal.
- A bug surfaces from someone touching worker's currency logic without
  realizing it interacts with frontend assumptions.

## Decision history

- **2026-06-XX**: GBp bug discovered with RR.L. Options A (rawCurrency
  field on position), B (keep GBp as a first-class currency code), C
  (frontend detection from Yahoo response, per-endpoint normalization),
  D (full migration to worker), E (full migration to frontend with
  thin worker) discussed.
- Decision: ship **C** as immediate fix. **E** documented here as
  the intended future refactor direction. **D** documented in
  `REFACTORING_GBp_to_worker.md` as a considered-and-rejected
  alternative.

## Notes on implementation when the time comes

- The `normalizeQuotesummaryResponse` function should accept the raw
  Yahoo response shape (not a flat object). It should know about the
  module structure: `result.financialData.currentPrice.raw`, etc.
  Currently `fundFetchRow` flattens before caching; the normalizer
  should run before flattening so it operates on the full nested form.
  Alternative: run normalizer on the flattened object — simpler but
  requires the flattening code to be aware of which fields came from
  where.
- The currency check inside `normalizeQuoteResponse` is on the
  flattened response (`data.currency`), but for
  `normalizeQuotesummaryResponse` it's on
  `result.price.currency` — different shape. The functions don't share
  the check logic but they do share the conversion logic (`/100`).
- `forwardPE` remains a special case: it's not a unit conversion, it's
  a Yahoo bug compensation. The code comment must continue to make
  this distinction clear. Architecturally one could argue forwardPE
  belongs in a separate "Yahoo bug workarounds" section rather than a
  "GBp normalizer" section, but co-locating them is pragmatic since
  the trigger (`price.currency === 'GBp'`) is the same.
