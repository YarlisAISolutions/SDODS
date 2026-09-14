---
'@sdods/core': patch
---

A JSONPath (`$…`) that matches nothing now reads as absent (`undefined`), the same as a dotted path, instead of `[]`. `the response JSON path {string} should exist` fails on a missing key and `should not exist` passes, whatever the path syntax. `I save the response JSON path {string} as {string}`, `should have {int} items` / `at least {int} items` and `the UI should show the text from JSON path {string}` fail with `RUN_FAILED` and a hint when the path matches nothing; a key that is present with the value `null` or `[]` still saves. `getPath` returns `undefined` for no match, the value for one match and an array for two or more, and the new `matchedPath` throws on no match.

Behaviour change: a wildcard over an empty array (`$.items[*]` on `{ "items": [] }`) is now absent rather than `[]`, so `the response JSON path "$.items[*]" should have 0 items` fails. Point the path at the array itself (`$.items`).
