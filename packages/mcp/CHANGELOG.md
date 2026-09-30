# @sdods/mcp

## 0.12.0

### Patch Changes

- @sdods/contracts@0.12.0

## 0.11.3

### Patch Changes

- @sdods/contracts@0.11.3

## 0.11.2

### Patch Changes

- @sdods/contracts@0.11.2

## 0.11.1

### Patch Changes

- 835d64c: Repository metadata moved to the YarlisAISolutions organisation: `repository.url` and `bugs.url` now point at https://github.com/YarlisAISolutions/SDODS, `sdods feedback` opens issues there, and the documented server image is `ghcr.io/yarlisaisolutions/sdods-server`.
- Updated dependencies [835d64c]
  - @sdods/contracts@0.11.1

## 0.11.0

### Patch Changes

- @sdods/contracts@0.11.0

## 0.10.0

### Patch Changes

- 497222e: Dependencies moved to their latest compatible releases: zod 4.6, yaml 2.9.1, fastify 5.12.4, `@axe-core/playwright` 4.13 (axe-core 4.13 rules), `@anthropic-ai/sdk` 0.125, `@anthropic-ai/claude-agent-sdk` 0.3.272, playwright-bdd 9.2.1 and tar 7.5.22. The installer now pins Bun 1.4.2.
  
  Tooling moves to TypeScript 6.0 and ESLint 10, and `fastify-plugin` to 6. Errors re-thrown from a caught failure (JSON bodies that do not parse after templating, GitHub evidence updates, an OpenAI-compatible server that does not answer) now carry the original error as `cause`.
  
  `sdods init` scaffolds projects on TypeScript 6.0, playwright-bdd 9.2.1 and tsx 4.23.13, and the workflow `sdods schedule` generates uses `actions/checkout@v7`, `actions/setup-node@v7` and `actions/upload-artifact@v7`.
- Updated dependencies [497222e]
- Updated dependencies [4975711]
  - @sdods/contracts@0.10.0

## 0.9.0

### Patch Changes

- Updated dependencies [47ac9e2]
- Updated dependencies [dd24cdb]
- Updated dependencies [3fb1773]
  - @sdods/contracts@0.9.0

## 0.8.0

### Minor Changes

- 509b2c8: Role matrices (#118): declare an actor × surface grid once in `projects/<slug>/roles.matrix.yaml` and generate the Scenario Outline examples from it.
  
  - `@sdods/contracts`: `RolesMatrixFileSchema` and `ROLES_MATRIX_FILE`. A matrix lists its `roles`, a `default` outcome, optional `outcomes` and `title`, and `rows` whose extra keys are Examples columns; `expect` is one outcome or a per-role map.
  - `@sdods/core`: `loadRolesMatrices`, `expandFeatureText` and `planMatrixExpansion`. A `Scenario Outline` tagged `@matrix:<name>` gets one `Examples:` block per role, tagged `@user:<role>`, between `# sdods:matrix:begin/end` markers; re-running is idempotent and hand-written Examples are kept. `sdods lint` accepts `@matrix:<name>` and reports an unknown matrix (`tags/matrix`), an invalid matrix file or undeclared role, a misplaced template or unknown placeholder, an out-of-date feature (`matrix/stale`, warning), and a matrix role with no user-pool account in an environment (`matrix/unseeded-role`, warning).
  - `@sdods/cli`: `sdods matrix expand [-p <slug>] [--check] [--dry-run]`; `--check` exits 3 when a feature is out of date, for CI.
  - `@sdods/mcp`: `matrix_expand` stages the expanded features as a proposal instead of writing them. The conventions list `@matrix:<name>` among the value tags.

### Patch Changes

- b0ae3b9: Add `@sdods/mcp/gherkin`: `parseGherkin`, `basicTagCheck` and `similarity` without the CLI, file system or tool registry, for code that checks a feature it was handed. The root export is unchanged.
- 0cc05cb: Per-scenario browser emulation: `@locale:<bcp47>`, `@timezone:<IANA>`, `@theme:<light|dark|no-preference>`, `@viewport:<W>x<H>` and `@device:<name>` set the browser context before it opens, over the environment's `use:` block, on a Scenario, a Feature, a Rule or one `Examples:` block. `sdods lint` validates the values. New steps: `I use the locale {string}`, `I use the timezone {string}`, `I use the {string} color scheme`, `I use the viewport {int} by {int}`, `I use the device {string}`, `the page should reflow without horizontal scrolling`, `the page should have no untranslated keys` and `the page should have no untranslated keys matching {string}`.
  
  Fix: `mobile-chrome` and `mobile-safari` run targets ran in a 1280x720 window instead of the device's viewport, because the generated project set `viewport: undefined`, which Playwright reads as "use the default".
  
  The agent rule lines (`CONVENTIONS` in `@sdods/mcp`, the `sdods` skill in `@sdods/cli`) list the new tags.
- 85ac708: Requirement traceability (#119). A new value tag `@req:<id>` links a scenario to a requirement; it may repeat, and on a `Feature` or `Rule` it applies to every scenario under it. The id is opaque. An optional `traceability:` block in `sdods.project.yaml` (`requirements`: a YAML or CSV list of ids and titles, `link`: a URL template with `{id}`, `require`: boolean) makes lint reject ids missing from the list (`tags/req`) and, with `require: true`, scenarios without a `@req:` tag (`tags/req-missing`).
  
  `sdods report traceability -p <slug> [-e <env>] [--run <id> | --last] [--format json|csv|md|html] [-o <file>]` exports requirement → scenarios (feature, line, name, tags) → final result per runner project in the chosen run (status, browser, attempts, flaky, duration, timestamps), with the run's id, environment, commit and SDODS version, a coverage summary (passed / failed / not run / not covered) and an empty sign-off block that SDODS never fills in. It reads `messages.ndjson` from the run directory, falling back to per-scenario `meta.json`; no database or server is needed. `@sdods/core/analyze` exports `buildTraceabilityReport` and `renderTraceability`.
  
  The agent conventions (`@sdods/mcp` `CONVENTIONS`) list `@req:<id>` among the optional value tags.
- Updated dependencies [4c00473]
- Updated dependencies [842a700]
- Updated dependencies [8611552]
- Updated dependencies [f950986]
- Updated dependencies [8611552]
- Updated dependencies [00930d0]
- Updated dependencies [8611552]
- Updated dependencies [509b2c8]
- Updated dependencies [85ac708]
  - @sdods/contracts@0.8.0

## 0.7.3

### Patch Changes

- @sdods/contracts@0.7.3

## 0.7.2

### Patch Changes

- 0865fee: Add `@sdods/mcp/gherkin`: `parseGherkin`, `basicTagCheck` and `similarity` without the CLI, file system or tool registry, for code that checks a feature it was handed. The root export is unchanged.
- @sdods/contracts@0.7.2

## 0.7.1

### Patch Changes

- Updated dependencies [805752a]
  - @sdods/contracts@0.7.1

## 0.7.0

### Minor Changes

- 5b69426: SDODS for AI coding tools.
  
  - `sdods skills list` and `sdods skills install [--agent claude,agents,cursor,copilot,gemini] [--global]` copy the bundled Agent Skills (`sdods`, `sdods-run`, `sdods-record`, `sdods-start-ui`) to where Claude Code, Codex, Cursor, Copilot and Gemini CLI read them; `npx -y @sdods/cli skills install` needs no global install. `sdods init` installs the same set into `.claude/skills` and `.agents/skills`, and no longer copies SDODS's own release skills.
  - `sdods mcp install gemini` writes `.gemini/settings.json`.
  - Every stdio snippet now launches `npx -y @sdods/cli mcp`. `npx sdods mcp` pointed at a package that does not exist, so clients configured from `mcp install --file`, `agent install`, the web UI or `/api/mcp/info` failed with CONNECTION_CLOSED outside a checkout.
  - `sdods mcp install claude|codex --http-url` passes the bearer token (`${SDODS_TOKEN}` / `--bearer-token-env-var SDODS_TOKEN`); before, both registered a server that answered 401.
  - `sdods mcp install windsurf` writes Windsurf's real config, `~/.codeium/windsurf/mcp_config.json`, with `serverUrl` for remote servers.

### Patch Changes

- @sdods/contracts@0.7.0

## 0.6.0

### Patch Changes

- @sdods/contracts@0.6.0

## 0.5.2

### Patch Changes

- Updated dependencies [45a38a8]
  - @sdods/contracts@0.5.2

## 0.5.1

### Patch Changes

- Updated dependencies [bd833e1]
  - @sdods/contracts@0.5.1

## 0.5.0

### Patch Changes

- Updated dependencies [f179b8e]
  - @sdods/contracts@0.5.0

## 0.4.0

### Patch Changes

- @sdods/contracts@0.4.0

## 0.3.2

### Patch Changes

- @sdods/contracts@0.3.2

## 0.3.1

### Patch Changes

- Updated dependencies [77c4a03]
  - @sdods/contracts@0.3.1

## 0.3.0

### Patch Changes

- @sdods/contracts@0.3.0
