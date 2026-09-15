---
'@sdods/core': minor
'@sdods/contracts': minor
'@sdods/cli': minor
'@sdods/server': patch
---

`@a11y` and `@perf` now run, and process gates are evaluated.

- `@a11y`: at the end of a UI or hybrid scenario, the page it ended on is audited with axe-core (WCAG 2.x A and AA). The scenario fails on any violation at or above the new `a11y.failOn` setting (`serious` by default). `a11y.include` and `a11y.exclude` scope the audit, and an environment can override each key. The result is attached as `sdods/a11y-scenario`. A URL that an explicit whole-page audit step already checked is not audited again.
- `@perf`: every document the scenario loads records its vitals once it has loaded and painted. At the end of the scenario, each recording is compared with the page budgets in `perf.budgets`, and the p95 of the scenario's live API calls (plus any latency samples) is compared with `apiP95Ms`. The scenario fails in four cases: a budget is breached, a budgeted vital is unmeasured, no budgets are configured (`CONFIG_INVALID`), or no budget applies to anything the scenario measured. The result is attached as `sdods/perf-scenario`.
- `sdods run --process <name>` evaluates `gates.minPassRate`, `gates.maxFlaky`, `gates.a11y` and `gates.perfBudgets` after the run and prints a gate table. When a gate fails, it exits 1 with the new error code `GATE_FAILED`. The a11y and perf gates also fail when nothing was audited or judged. The verdict is written to `gates.json`, `summary.json` and the `--json` output. The server's run manager records it on the run under `totals_json.gates` and marks a gated-out run failed. Gates are not evaluated on a single shard.
- The axe audit and the vitals and budget helpers moved out of the step files into `a11y/audit.ts` and `perf/vitals.ts`, so the hooks can use them without registering the steps a second time. The step files still re-export them.
