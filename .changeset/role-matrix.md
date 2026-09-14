---
'@sdods/contracts': minor
'@sdods/core': minor
'@sdods/cli': minor
'@sdods/mcp': minor
---

Role matrices (#118): declare an actor × surface grid once in `projects/<slug>/roles.matrix.yaml` and generate the Scenario Outline examples from it.

- `@sdods/contracts`: `RolesMatrixFileSchema` and `ROLES_MATRIX_FILE`. A matrix lists its `roles`, a `default` outcome, optional `outcomes` and `title`, and `rows` whose extra keys are Examples columns; `expect` is one outcome or a per-role map.
- `@sdods/core`: `loadRolesMatrices`, `expandFeatureText` and `planMatrixExpansion`. A `Scenario Outline` tagged `@matrix:<name>` gets one `Examples:` block per role, tagged `@user:<role>`, between `# sdods:matrix:begin/end` markers; re-running is idempotent and hand-written Examples are kept. `sdods lint` accepts `@matrix:<name>` and reports an unknown matrix (`tags/matrix`), an invalid matrix file or undeclared role, a misplaced template or unknown placeholder, an out-of-date feature (`matrix/stale`, warning), and a matrix role with no user-pool account in an environment (`matrix/unseeded-role`, warning).
- `@sdods/cli`: `sdods matrix expand [-p <slug>] [--check] [--dry-run]`; `--check` exits 3 when a feature is out of date, for CI.
- `@sdods/mcp`: `matrix_expand` stages the expanded features as a proposal instead of writing them. The conventions list `@matrix:<name>` among the value tags.
