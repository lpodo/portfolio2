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
