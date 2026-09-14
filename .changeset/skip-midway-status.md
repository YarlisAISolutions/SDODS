---
'@sdods/db': patch
'@sdods/core': patch
---

A scenario that called `test.skip()` part-way is recorded as skipped, not passed, by run ingest and by `sdods report traceability`. playwright-bdd reports the steps before the skip as PASSED and the rest as SKIPPED, and both readers counted any passed step as a pass; the worst step result now wins, as in Cucumber.
