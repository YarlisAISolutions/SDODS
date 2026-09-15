---
'@sdods/cli': minor
'@sdods/contracts': minor
'@sdods/core': minor
'@sdods/db': minor
'@sdods/server': minor
---

Process gates judge sharded runs, CLI-ingested runs record their verdict, and `@a11y` can audit every page (#176, #177).

- `sdods report merge --process <name> [-p <slug>]` judges a process's gates on the merged shards: the pass rate and flaky count from the merged results, the `@a11y`/`@perf` evidence from the shards' run directories and the reports attached in the blobs. It prints the same gate table as `sdods run --process`, writes `gates.json` into the `--run` directory and exits 1 with `GATE_FAILED`. Without `--process`, a merge now also judges the process a shard's `run.json` names when that process declares gates.
- `sdods report merge` merges several shard report directories, including blobs recorded under different checkouts (CI's Playwright container and its bare runner). `playwright merge-reports` reads one directory and refuses mixed test roots, so the reports are staged into one directory with a merge config that pins the root. Before this, CI's merge step failed with "too many arguments" and its `|| echo` hid it. A failed merge now shows Playwright's error rather than the tail of its stack.
- Ingest records the process gate verdict under `totals_json.gates` and marks a gated-out run failed, for CLI, merged and server-started runs alike (`gates.json` in the run directory, or judged during `sdods report ingest` and server ingest when the run's process has gates). `RunRecord.gates` carries it, and the run page in the web UI shows the gate table.
- `a11y.scope: final | every-page` (default `final`), overridable per environment. With `every-page`, the `@a11y` hook audits each distinct URL a step leaves the scenario on, after the page settles at the point the `@perf` hook reads it, skips URLs an explicit audit step covered, and fails once at the end naming each violating URL. `sdods/a11y-scenario` carries a `pages` list, and the `a11y` gate counts one audit per URL.
