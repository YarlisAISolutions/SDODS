---
'@sdods/cli': patch
'@sdods/core': patch
---

Cucumber messages record which step passed or failed again.

On Playwright below 1.63, a workspace that installs SDODS from npm recorded every Gherkin step `SKIPPED` in `messages.ndjson` (and the cucumber HTML report), with failures attached to a hook. playwright-bdd matches a step's result by its line in the generated spec, and those Playwright versions report the line in their transformed copy instead. Measured on 1.60.0, 1.61.1, 1.62.0 and 1.62.1 against 1.63.0.

- `@playwright/test` 1.63.0 is now the floor: `sdods init` scaffolds `^1.63.0`, `@sdods/core` declares `>=1.63` as its peer range, and the server image uses `mcr.microsoft.com/playwright:v1.63.0-noble`.
- `sdods run` warns and `sdods doctor` fails a "step results" check when the workspace resolves an older `@playwright/test`, and both name the upgrade command.
