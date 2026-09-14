---
'@sdods/db': patch
---

Run ingest no longer stores a skipped scenario as passed. A passing before or after hook counted as a pass, so a scenario whose Gherkin steps were all skipped (`@skip:<browser>`) was recorded as passed in the results database. Hooks now only fail a scenario; passed and skipped come from its Gherkin steps, as in the traceability reader.
