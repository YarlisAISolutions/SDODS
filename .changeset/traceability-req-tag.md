---
'@sdods/contracts': minor
'@sdods/core': minor
'@sdods/cli': minor
'@sdods/mcp': patch
---

Requirement traceability (#119). A new value tag `@req:<id>` links a scenario to a requirement; it may repeat, and on a `Feature` or `Rule` it applies to every scenario under it. The id is opaque. An optional `traceability:` block in `sdods.project.yaml` (`requirements`: a YAML or CSV list of ids and titles, `link`: a URL template with `{id}`, `require`: boolean) makes lint reject ids missing from the list (`tags/req`) and, with `require: true`, scenarios without a `@req:` tag (`tags/req-missing`).

`sdods report traceability -p <slug> [-e <env>] [--run <id> | --last] [--format json|csv|md|html] [-o <file>]` exports requirement → scenarios (feature, line, name, tags) → final result per runner project in the chosen run (status, browser, attempts, flaky, duration, timestamps), with the run's id, environment, commit and SDODS version, a coverage summary (passed / failed / not run / not covered) and an empty sign-off block that SDODS never fills in. It reads `messages.ndjson` from the run directory, falling back to per-scenario `meta.json`; no database or server is needed. `@sdods/core/analyze` exports `buildTraceabilityReport` and `renderTraceability`.

The agent conventions (`@sdods/mcp` `CONVENTIONS`) list `@req:<id>` among the optional value tags.
