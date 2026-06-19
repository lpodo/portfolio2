# Refactoring proposal: move GBp (and similar) currency normalization fully into worker

**Status:** Proposed, not implemented. Currently the codebase uses **option C**
(normalization split between worker and frontend by data type). This document
captures the analysis of an alternative — option D — for possible future
revisiting if the current arrangement becomes unwieldy.

## Current state (option C, as of GBp bug fix)

GBp normalization is split between two layers:

1. **Worker** normalizes price-tick fields in real-time endpoints:
   - `/api/quote` divides price by 100 for `meta.currency === 'GBp'`,
     returns `currency: 'GBP'`.
   - `/api/history` does the same for the closes array.
   - `/api/quotesummary` is a pure passthrough (no normalization).

2. **Frontend** (`fundamentals.js`) normalizes fundamentals-data fields:
   - `fundFetchRow` requests the `price` module to detect
     `price.currency === 'GBp'`, then divides `currentPrice`,
     `targetMeanPrice`, `targets[].target`, and `forwardPE` by 100 before
     caching. Downstream consumers read clean GBP values from the cache.

**Why this split exists:** historical. Worker handled quote/history GBp
from day one (single hot path, easy fix). Fundamentals GBp surfaced later
during the RR.L bug and was patched at the frontend layer to avoid
disturbing working worker code.

**Cost of the split:**
- Aesthetic inconsistency: two layers know about GBp.
- If a new field is added that needs GBp handling, you have to remember
  which layer to add it in (depends on which endpoint serves it).
- New developers (or future-self) need to learn both places.

## Option D: full migration into worker

**Idea:** worker becomes the single point of truth for all currency
normalization. Frontend code never sees raw GBp values from any endpoint.

### Implementation sketch

1. Worker would normalize **all** Yahoo responses, not just chart-price.

2. For `/api/quotesummary`, worker would:
   - Parse response JSON.
   - Detect GBp from `result.price.currency` (force-inject `price` module
     into the upstream request if client didn't include it).
   - Walk known fields, dividing currency-denominated values by 100.
   - Compensate for Yahoo's `forwardPE` 100x bug.
   - Re-serialize and return.

3. Worker would maintain a list of GBp-affected fields per Yahoo module:
   - `financialData`: `currentPrice`, `targetMeanPrice`, `targetHighPrice`,
     `targetLowPrice`, `targetMedianPrice`, possibly others.
   - `upgradeDowngradeHistory.history[].currentPriceTarget`.
   - `defaultKeyStatistics.forwardPE` (Yahoo bug compensation).
   - `summaryDetail.dayLow`, `dayHigh`, `regularMarketPrice`, etc.
   - `price.regularMarketPrice`, `regularMarketDayHigh`, etc.

4. Worker exposes all responses with `currency: 'GBP'` (normalized).

5. Frontend can be simplified: remove GBp logic from `fundFetchRow`,
   remove the `price` module from `FUND_ROW_MODS` (unless needed for
   other reasons).

### Pros

- **Single source of truth.** All currency-related quirks live in worker.
- **Frontend stays naive.** Application code never thinks about pence vs
  pounds; worker has already handled it.
- **Future currencies easier.** Adding ZAc (South African cents), ILA
  (Israeli agorot), and other sub-currencies is one place.
- **API contract clarity.** Worker's documented behavior: "currency-
  denominated fields are always in the major unit (GBP, not GBp)".

### Cons / risks

- **Worker grows from passthrough to interpreter.** Currently
  `/api/quotesummary` is a thin proxy. After D, it parses the response
  and modifies it. CPU cost is negligible per request but architectural
  weight increases.
- **Worker becomes coupled to Yahoo's response structure.** Need to know
  which modules contain which fields. If Yahoo changes their schema, both
  worker and frontend need updates.
- **`forwardPE` bug compensation in worker is debatable.** Worker is the
  right place for unit normalization but a questionable place for vendor
  bug workarounds. Could be split: GBp at worker, forwardPE at frontend
  (but that recreates the current split, just in a different shape).
- **Worker must inject `price` module** if client didn't request it (to
  detect GBp). That means worker rewrites client query parameters. More
  logic.
- **CPU budget on Cloudflare.** Negligible for personal use but real for
  scaled deployment.
- **Slower dev iteration.** Worker changes require Cloudflare deploy;
  frontend changes are GitHub Pages instant.
- **More fragile.** Single bug in worker normalization affects all
  consumers. Bug in frontend normalization affects only that code path.

### Migration plan (if chosen)

1. **Phase 1:** add normalization in worker for `/api/quotesummary`.
   Keep frontend C-logic running — both layers normalize, second call is
   a no-op since worker already returns clean GBP.
2. **Phase 2:** verify worker normalization is correct via testing.
3. **Phase 3:** remove frontend C-logic. Bump `FUND_CACHE_VER`.
4. **Phase 4:** consider extending to other endpoints (`/api/profile`,
   etc.) if they have GBp-affected fields.

Phase 1 ensures backward compatibility: if either layer is buggy or
missing, the other catches it.

## When to revisit option D

Consider option D if any of these happen:

- We add a new fetch endpoint that needs GBp handling (third call site
  creates a real pattern, not just an outlier).
- We discover another sub-currency (ZAc, ILA, etc.) — adding it would
  touch multiple places under C but one place under D.
- A bug surfaces from someone reading raw Yahoo values directly
  (e.g., adding new fundamentals data without remembering to apply
  GBp normalization).
- We want to expose the worker as a clean API to other clients beyond
  this app.

## Decision history

- **2026-06-XX**: GBp bug discovered with RR.L showing pence values in
  Avg tgt, P/E, fw P/E (expanded row and targets table). Options A
  (rawCurrency field), B (keep GBp as currency code), C (frontend
  detection), D (worker normalization) discussed.
- Decision: ship **C** as immediate fix. D documented here for future
  revisit. Refactoring D for purely aesthetic reasons doesn't justify
  the cost in a single-user personal app.

## Notes

- Option C's split is not arbitrary: worker handles "simple universal
  fields" (single price per endpoint); frontend handles "complex
  multi-field response" (`quotesummary` with many denominated fields).
  This is a defensible boundary, just not a clean one.
- If D is implemented, the documentation should explicitly state that
  worker is "the currency normalization layer" and downstream code MUST
  NOT do its own currency handling. Otherwise we end up with both
  layers doing it.
