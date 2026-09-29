# @sdods/core

## 0.11.3

### Patch Changes

- @sdods/contracts@0.11.3
  - @sdods/db@0.11.3

## 0.11.2

### Patch Changes

- @sdods/contracts@0.11.2
  - @sdods/db@0.11.2

## 0.11.1

### Patch Changes

- 835d64c: Repository metadata moved to the YarlisAISolutions organisation: `repository.url` and `bugs.url` now point at https://github.com/YarlisAISolutions/SDODS, `sdods feedback` opens issues there, and the documented server image is `ghcr.io/yarlisaisolutions/sdods-server`.
- Updated dependencies [835d64c]
  - @sdods/contracts@0.11.1
  - @sdods/db@0.11.1

## 0.11.0

### Patch Changes

- Updated dependencies [00f2d34]
  - @sdods/db@0.11.0
  - @sdods/contracts@0.11.0

## 0.10.0

### Minor Changes

- 4975711: Process gates judge sharded runs, CLI-ingested runs record their verdict, and `@a11y` can audit every page (#176, #177).
  
  - `sdods report merge --process <name> [-p <slug>]` judges a process's gates on the merged shards: the pass rate and flaky count from the merged results, the `@a11y`/`@perf` evidence from the shards' run directories and the reports attached in the blobs. It prints the same gate table as `sdods run --process`, writes `gates.json` into the `--run` directory and exits 1 with `GATE_FAILED`. Without `--process`, a merge now also judges the process a shard's `run.json` names when that process declares gates.
  - `sdods report merge` merges several shard report directories, including blobs recorded under different checkouts (CI's Playwright container and its bare runner). `playwright merge-reports` reads one directory and refuses mixed test roots, so the reports are staged into one directory with a merge config that pins the root. Before this, CI's merge step failed with "too many arguments" and its `|| echo` hid it. A failed merge now shows Playwright's error rather than the tail of its stack.
  - Ingest records the process gate verdict under `totals_json.gates` and marks a gated-out run failed, for CLI, merged and server-started runs alike (`gates.json` in the run directory, or judged during `sdods report ingest` and server ingest when the run's process has gates). `RunRecord.gates` carries it, and the run page in the web UI shows the gate table.
  - `a11y.scope: final | every-page` (default `final`), overridable per environment. With `every-page`, the `@a11y` hook audits each distinct URL a step leaves the scenario on, after the page settles at the point the `@perf` hook reads it, skips URLs an explicit audit step covered, and fails once at the end naming each violating URL. `sdods/a11y-scenario` carries a `pages` list, and the `a11y` gate counts one audit per URL.

### Patch Changes

- 497222e: Dependencies moved to their latest compatible releases: zod 4.6, yaml 2.9.1, fastify 5.12.4, `@axe-core/playwright` 4.13 (axe-core 4.13 rules), `@anthropic-ai/sdk` 0.125, `@anthropic-ai/claude-agent-sdk` 0.3.272, playwright-bdd 9.2.1 and tar 7.5.22. The installer now pins Bun 1.4.2.
  
  Tooling moves to TypeScript 6.0 and ESLint 10, and `fastify-plugin` to 6. Errors re-thrown from a caught failure (JSON bodies that do not parse after templating, GitHub evidence updates, an OpenAI-compatible server that does not answer) now carry the original error as `cause`.
  
  `sdods init` scaffolds projects on TypeScript 6.0, playwright-bdd 9.2.1 and tsx 4.23.13, and the workflow `sdods schedule` generates uses `actions/checkout@v7`, `actions/setup-node@v7` and `actions/upload-artifact@v7`.
- Updated dependencies [497222e]
- Updated dependencies [4975711]
  - @sdods/contracts@0.10.0
  - @sdods/db@0.10.0

## 0.9.0

### Minor Changes

- 47ac9e2: `@a11y` and `@perf` now run, and process gates are evaluated.
  
  - `@a11y`: at the end of a UI or hybrid scenario, the page it ended on is audited with axe-core (WCAG 2.x A and AA). The scenario fails on any violation at or above the new `a11y.failOn` setting (`serious` by default). `a11y.include` and `a11y.exclude` scope the audit, and an environment can override each key. The result is attached as `sdods/a11y-scenario`. A URL that an explicit whole-page audit step already checked is not audited again.
  - `@perf`: every document the scenario loads records its vitals once it has loaded and painted. At the end of the scenario, each recording is compared with the page budgets in `perf.budgets`, and the p95 of the scenario's live API calls (plus any latency samples) is compared with `apiP95Ms`. The scenario fails in four cases: a budget is breached, a budgeted vital is unmeasured, no budgets are configured (`CONFIG_INVALID`), or no budget applies to anything the scenario measured. The result is attached as `sdods/perf-scenario`.
  - `sdods run --process <name>` evaluates `gates.minPassRate`, `gates.maxFlaky`, `gates.a11y` and `gates.perfBudgets` after the run and prints a gate table. When a gate fails, it exits 1 with the new error code `GATE_FAILED`. The a11y and perf gates also fail when nothing was audited or judged. The verdict is written to `gates.json`, `summary.json` and the `--json` output. The server's run manager records it on the run under `totals_json.gates` and marks a gated-out run failed. Gates are not evaluated on a single shard.
  - The axe audit and the vitals and budget helpers moved out of the step files into `a11y/audit.ts` and `perf/vitals.ts`, so the hooks can use them without registering the steps a second time. The step files still re-export them.
- dd24cdb: User pools no longer starve workers silently (#153).
  
  - `sdods run` stops before generating specs when a selected `@user:<role>` has fewer pool accounts than the scenarios of that role the workers could run at once. It exits `2` with `USER_POOL_TOO_SMALL` and names the role, the account count and the worker count. The count follows the selection (`--layer`, `--browser`, `--tags`, `--module`, `--feature`, `--since`, tag-gate skips, serial files, shards) and is skipped for `mode: shared`, `leaseScope: scenario`, database or OpenAPI datasets, `--list`, `--ui` and `--debug`. `--allow-pool-contention` runs anyway. `sdods doctor` prints accounts per role against the worker count (`-w` to set it).
  - `data.userPool.leaseScope: scenario | worker` (default `worker`, unchanged). With `scenario` an account is released when each scenario ends, including accounts leased by the `I use a leased user …` steps, so one account serialises its scenarios instead of starving whole workers. In that mode `waitMs` defaults to `leaseTtlMs`, and the time spent waiting is added to the scenario's timeout.
  - Waiters for a role are served in arrival order, so a worker that just released an account no longer wins it straight back.
  - **Removed:** `data.userPool.leaseStore: db`. It was accepted and never implemented, so sharded runs that relied on it did not share leases. It is now a configuration error ("leaseStore 'db' was never implemented; use 'file' (see #153)"); use `file`, or give each runner its own accounts.
  - `data.userPool.waitMs` is now optional in the schema (its effective default is unchanged for `leaseScope: worker`).
  - Fix: the shard offset in lease owners used `--workers ?? 1`, so with Playwright's default worker count a worker on shard 2 could share an owner with one on shard 1.
- 3fb1773: Visual baselines you review before they change, per-baseline masks, and Linux baselines from CI.
  
  - `screenshots.maxDiffPixelRatio` (default `0.01`, previously hard-coded) and `screenshots.baselines.<name>` with its own `mask` (added to `screenshots.mask`) and `maxDiffPixelRatio`, in the project or an environment.
  - New step `the page should match the visual baseline {string} masking {string}` with comma-separated selectors.
  - A failed visual check keeps its expected, actual and diff images and a `<name>.failure.json` record under the scenario's `visual/<run target>/` directory, so they survive the CI artifact upload.
  - `sdods baselines diff [--run <id>]` lists failed visual checks; `sdods baselines accept <name…> --run <id>` (or `--all`) copies the actual screenshot to `features/__screenshots__/<run target>/<platform>/` for the platform the run happened on. `sdods run --update-snapshots` still works and now warns that it overwrites without review.
  - Server: `GET /api/runs/:id/baselines` and `POST /api/runs/:id/baselines/accept` (`features:write`, editor role); the web UI shows **Accept as baseline** with the diff on a failed visual step.

### Patch Changes

- Updated dependencies [47ac9e2]
- Updated dependencies [dd24cdb]
- Updated dependencies [3fb1773]
  - @sdods/contracts@0.9.0
  - @sdods/db@0.9.0

## 0.8.0

### Minor Changes

- 4c00473: Canvas steps for graph and node editors (`canvas.steps.ts`): drag an element onto another or by an offset, drag a node by id, connect a handle of one node to a handle of another, select a node, set a field inside a node, and assert the node count, an edge from one node to another (or its absence), a node's visibility and a badge inside a node.
  
  - Drags are real pointer gestures (press, nudge, multi-step moves, a final move onto the target, release), so React Flow, d3-drag and native HTML5 `draggable` palettes all react. The press lands on a plain part of the element, never on a field or handle inside it.
  - New project key `canvas` in `@sdods/contracts`: CSS selector templates for `root`, `nodes`, `node`, `handle`, `edge`, `field`, `badge` and `selected`, defaulting to React Flow's DOM. Templates are validated for their required placeholders (`{id}`, `{handle}`, `{source}`/`{target}`, `{field}`, `{badge}`), and `{testIdAttribute}` expands to the project's attribute.
  - A project whose own steps already use these phrasings can keep them with `steps.core.exclude: [canvas]`.
- 842a700: Email assertions over Mailpit. A new `mail` block in the environment yaml (`provider: mailpit`, `url`, optional basic `auth` with a `${VAR}` password) enables seven steps: clear the inbox for an address, wait for an email with a subject within N seconds, assert the latest email's text or sender, save a link or a one-time code from it, and open its link. "The latest email" is scoped to the scenario: only mail received after the scenario started or after the last clear counts, and the wait step pins the message it matched. `@sdods/core` also exports the `MailInbox` interface and `MailpitInbox` adapter.
- 00930d0: `sdods load -p <project> -e <env> <profile>` runs API load tests through k6. A profile in `projects/<slug>/load/<profile>.yaml` lists requests (method, path relative to `api.baseUrl`, headers, body, expected status and body checks) with k6 `stages` or `vus`/`duration` and `thresholds`. SDODS generates a k6 script whose credentials come from the environment's `api.auth` as `__ENV` lookups, never inlined, prints the target URL and peak virtual users, runs `k6 run --summary-export` (or the `grafana/k6` image with `--runner docker`) and exits `1` when thresholds fail. Load is opt-in: an environment must set `load.allowed: true`, `load.maxVus` caps the peak, and write methods need `load.allowWrites: true`. `--dry-run` writes the script without k6. Results land in `.sdods/runs/<id>/load/<profile>/`.
- 0cc05cb: Per-scenario browser emulation: `@locale:<bcp47>`, `@timezone:<IANA>`, `@theme:<light|dark|no-preference>`, `@viewport:<W>x<H>` and `@device:<name>` set the browser context before it opens, over the environment's `use:` block, on a Scenario, a Feature, a Rule or one `Examples:` block. `sdods lint` validates the values. New steps: `I use the locale {string}`, `I use the timezone {string}`, `I use the {string} color scheme`, `I use the viewport {int} by {int}`, `I use the device {string}`, `the page should reflow without horizontal scrolling`, `the page should have no untranslated keys` and `the page should have no untranslated keys matching {string}`.
  
  Fix: `mobile-chrome` and `mobile-safari` run targets ran in a 1280x720 window instead of the device's viewport, because the generated project set `viewport: undefined`, which Playwright reads as "use the default".
  
  The agent rule lines (`CONVENTIONS` in `@sdods/mcp`, the `sdods` skill in `@sdods/cli`) list the new tags.
- 509b2c8: Role matrices (#118): declare an actor × surface grid once in `projects/<slug>/roles.matrix.yaml` and generate the Scenario Outline examples from it.
  
  - `@sdods/contracts`: `RolesMatrixFileSchema` and `ROLES_MATRIX_FILE`. A matrix lists its `roles`, a `default` outcome, optional `outcomes` and `title`, and `rows` whose extra keys are Examples columns; `expect` is one outcome or a per-role map.
  - `@sdods/core`: `loadRolesMatrices`, `expandFeatureText` and `planMatrixExpansion`. A `Scenario Outline` tagged `@matrix:<name>` gets one `Examples:` block per role, tagged `@user:<role>`, between `# sdods:matrix:begin/end` markers; re-running is idempotent and hand-written Examples are kept. `sdods lint` accepts `@matrix:<name>` and reports an unknown matrix (`tags/matrix`), an invalid matrix file or undeclared role, a misplaced template or unknown placeholder, an out-of-date feature (`matrix/stale`, warning), and a matrix role with no user-pool account in an environment (`matrix/unseeded-role`, warning).
  - `@sdods/cli`: `sdods matrix expand [-p <slug>] [--check] [--dry-run]`; `--check` exits 3 when a feature is out of date, for CI.
  - `@sdods/mcp`: `matrix_expand` stages the expanded features as a proposal instead of writing them. The conventions list `@matrix:<name>` among the value tags.
- 85ac708: Requirement traceability (#119). A new value tag `@req:<id>` links a scenario to a requirement; it may repeat, and on a `Feature` or `Rule` it applies to every scenario under it. The id is opaque. An optional `traceability:` block in `sdods.project.yaml` (`requirements`: a YAML or CSV list of ids and titles, `link`: a URL template with `{id}`, `require`: boolean) makes lint reject ids missing from the list (`tags/req`) and, with `require: true`, scenarios without a `@req:` tag (`tags/req-missing`).
  
  `sdods report traceability -p <slug> [-e <env>] [--run <id> | --last] [--format json|csv|md|html] [-o <file>]` exports requirement → scenarios (feature, line, name, tags) → final result per runner project in the chosen run (status, browser, attempts, flaky, duration, timestamps), with the run's id, environment, commit and SDODS version, a coverage summary (passed / failed / not run / not covered) and an empty sign-off block that SDODS never fills in. It reads `messages.ndjson` from the run directory, falling back to per-scenario `meta.json`; no database or server is needed. `@sdods/core/analyze` exports `buildTraceabilityReport` and `renderTraceability`.
  
  The agent conventions (`@sdods/mcp` `CONVENTIONS`) list `@req:<id>` among the optional value tags.

### Patch Changes

- 8611552: Canvas steps: `the canvas should not contain an edge from … to …` no longer passes on a canvas that has not finished rendering. React Flow keeps unmeasured nodes in the DOM with `visibility: hidden` and draws edges only after measuring them, so right after a reload every edge looked absent. The step now needs at least one visible node, waits until every node is visible and the editor has painted, and only then checks the edge is absent.
- 8611552: Canvas steps: `{testIdAttribute}` in `canvas.root` and `canvas.nodes` is now expanded, as it already was in the other selectors. The schema accepted it, but the node count, the absent-edge check and every lookup scoped to the root used the template as-is and failed with an invalid selector.
- 8611552: `sdods load` refuses a `SDODS_API_BASE_URL` that differs from the environment's `api.baseUrl`, because the opt-in (`load.allowed`) belongs to that environment file and a stray override sent the load to another host. `--dry-run` reports it as a guard problem. An environment whose URL is meant to change per run sets `load.allowBaseUrlOverride: true`.
- 8611552: `sdods load` no longer passes `K6_*` environment variables to k6. k6 reads `K6_VUS`, `K6_STAGES`, `K6_DURATION`, `K6_ITERATIONS`, `K6_SCENARIOS` and the rest as options that override the script, so a stray one bypassed the profile and `load.maxVus`. The run prints a warning naming the variables it left out.
- 8611552: Mailpit: a message read in full now has a real `receivedAt`. Mailpit's full `Message` object carries `Date` and no `Created` (only the search summary has `Created`), so `receivedAt` was always 1970-01-01.
- 8611552: Role matrices: placeholders are checked per `Examples:` block, the way Gherkin fills them. A column that only a hand-written block has is now reported for the generated blocks (it stayed a literal `<column>` in every generated row), and a hand-written block that lacks a placeholder the outline uses is reported on that block.
- 8611552: Role matrices: a custom `title` must use `<role>` and every row column. A title such as `'<surface> → <expect>'` gave two roles with the same outcome the same test title, and Playwright refuses to load duplicate titles. A title that still renders the same text twice (adjacent placeholders) is reported too.
- 8611552: A scenario that called `test.skip()` part-way is recorded as skipped, not passed, by run ingest and by `sdods report traceability`. playwright-bdd reports the steps before the skip as PASSED and the rest as SKIPPED, and both readers counted any passed step as a pass; the worst step result now wins, as in Cucumber.
- Updated dependencies [4c00473]
- Updated dependencies [8611552]
- Updated dependencies [842a700]
- Updated dependencies [8611552]
- Updated dependencies [f950986]
- Updated dependencies [8611552]
- Updated dependencies [00930d0]
- Updated dependencies [8611552]
- Updated dependencies [509b2c8]
- Updated dependencies [8611552]
- Updated dependencies [85ac708]
  - @sdods/contracts@0.8.0
  - @sdods/db@0.8.0

## 0.7.3

### Patch Changes

- ffbf50f: `ApiContext.headers` is now case-insensitive, as HTTP header names are. It is a `HeaderMap` (exported from `@sdods/core`), a `Map` whose `set`, `get`, `has` and `delete` lower-case the name, so `delete('x-api-key')` removes a header set as `X-API-Key` and `get('cookie')` finds one set as `Cookie`. Names are stored lower-cased, and when a scenario sets the same header under two casings the last `set` wins. What goes on the wire is unchanged: the client already lower-cased names when building a request. Project workarounds that installed their own case-insensitive map over the `apiContext` fixture can be removed.
- 732d1e2: A JSONPath (`$…`) that matches nothing now reads as absent (`undefined`), the same as a dotted path, instead of `[]`. `the response JSON path {string} should exist` fails on a missing key and `should not exist` passes, whatever the path syntax. `I save the response JSON path {string} as {string}`, `should have {int} items` / `at least {int} items` and `the UI should show the text from JSON path {string}` fail with `RUN_FAILED` and a hint when the path matches nothing; a key that is present with the value `null` or `[]` still saves. `getPath` returns `undefined` for no match, the value for one match and an array for two or more, and the new `matchedPath` throws on no match.
  
  Behaviour change: a wildcard over an empty array (`$.items[*]` on `{ "items": [] }`) is now absent rather than `[]`, so `the response JSON path "$.items[*]" should have 0 items` fails. Point the path at the array itself (`$.items`).
- @sdods/contracts@0.7.3
  - @sdods/db@0.7.3

## 0.7.2

### Patch Changes

- @sdods/contracts@0.7.2
  - @sdods/db@0.7.2

## 0.7.1

### Patch Changes

- Updated dependencies [805752a]
  - @sdods/contracts@0.7.1
  - @sdods/db@0.7.1

## 0.7.0

### Patch Changes

- @sdods/contracts@0.7.0
  - @sdods/db@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [097aead]
  - @sdods/db@0.6.0
  - @sdods/contracts@0.6.0

## 0.5.2

### Patch Changes

- 45a38a8: Stop publishing Playwright traces, and redact the ones a run keeps (#101).
  
  A `trace.zip` records every request's `Cookie`/`Authorization` headers, `Set-Cookie` responses, the context's `storageState` (cookies, localStorage, IndexedDB — where Firebase keeps its refresh token) and typed values, so for projects with pool accounts it carries live sessions.
  
  - **Integrations never upload, attach or link a trace.** GitHub issues no longer link `trace.zip` through `SDODS_PUBLIC_URL` or the CI artifacts page, and `uploadToRelease` no longer uploads it; Jira no longer attaches it. Both name the trace's local path under a warning that it contains credentials, with the `npx playwright show-trace` command. The video is still linked or uploaded (it shows the screen, not headers or storage).
  - **`sdods run` redacts every trace after the run**, before ingest and integrations: `runner-output/**/trace.zip`, the HTML report's copies under `html-report/data/`, zips nested in blob shard reports, and the BASE64 trace bodies embedded in `messages.ndjson` (which ingest turns back into `trace.zip`). Credential headers (`Cookie`, `Set-Cookie`, `Authorization`, `Proxy-Authorization`, `X-Api-Key` and similar), cookie values, localStorage/sessionStorage/IndexedDB values, `httpCredentials` passwords, password inputs in DOM snapshots and values typed into password/secret/token fields become `[redacted]`. Other entries are copied through unchanged and the trace viewer opens the result. Request/response bodies and page text are not redacted.
  - New `evidence.redactTraces` (default `true`; env files may override it). `evidence.trace` and `sdods run --trace <mode>` already control whether traces are recorded at all.
  - Docs warn that traces are credential-bearing (GitHub and Jira guide, `sdods trace`, `project.yaml` reference).
- Updated dependencies [45a38a8]
  - @sdods/contracts@0.5.2
  - @sdods/db@0.5.2

## 0.5.1

### Patch Changes

- bd833e1: Make every credential an API call carries explicit, and wire two config fields that did nothing.
  
  - `I use an isolated API client` (or `apiContext.isolated = true`) sends the rest of the scenario's calls through a separate request context with an empty cookie jar, created on first use and disposed at teardown. On `@ui`/`@hybrid` the shared `request` context starts from the `@user:<role>` storageState, so "an invalid API key is refused" passed on the session cookie. The raw (`without following redirects`) and event-stream steps honour it. The step library reference documents which layers carry which jar.
  - String bodies are sent as bytes. Playwright JSON-encodes a string that does not parse when the content-type is exactly `application/json`, so `{ this is not json` arrived as `"{ this is not json"`. New step `I send a {method} request to {string} with the raw body:` sends its doc string untouched (not parsed, not template-rendered).
  - `I use a leased user with role {string} for API calls` no longer attaches the user's token behind the scenario's back for `custom` auth strategies, whose `token()` may mint a different credential class than the session. New project setting `auth.apiToken: implicit | explicit` (default: explicit for `custom`, implicit for every other strategy, unchanged) and new step `I authenticate the API with the leased user's token`. Which credential was attached, and from where, is logged at `info`. **Behaviour change** for `custom` strategies that relied on the implicit bearer: add the step, or set `auth.apiToken: implicit`.
  - Recorded API evidence carries `request.auth` (`none`, `bearer`, `basic`, `header:<name>`, never the value) and `request.isolated`.
  - `env.api.auth: { type: oauth-client-credentials }` is implemented: a `client_credentials` grant to `tokenUrl` (with `scope`/`audience` when set), sent as a bearer and cached per worker until 30 s before `expires_in`. A refused grant fails the call as `AUTH_FAILED` instead of sending it anonymous, and an auth type the client does not implement throws `NOT_SUPPORTED`. The `oauth-client-credentials` auth strategy's `token()` shares the implementation. Raw requests now resolve auth exactly like the client, which also makes `I use no authentication` apply to them (`null ?? env` used to fall back to the environment credential).
  - `retries.byTag` reaches the runner. Each entry becomes a sibling runner project with the same name that greps the tag and carries its retries; the base project excludes those tags, and a scenario with several such tags runs once with the highest count. `--retries` still overrides it, and a scenario's own `@retries:N` tag overrides both.
- 0dcaef8: Applying a cached session no longer navigates the page (#99).
  
  - `I use a leased user with role "…"` restored localStorage by `page.goto(origin)`. An app that sends a signed-in visitor away from `/` on the client then had a redirect chain still running when the step returned, and the scenario's first `page.goto` failed with `net::ERR_ABORTED` / "interrupted by another navigation". Cookies are still added to the context; localStorage is now planted by a context init script that runs before the app's own scripts, only on the matching origin (or written straight into the page when it is already on that origin). The page is left where it was.
  - The localStorage is planted once per context: the init script is removed after the first document of that origin loads, so an app that signs out mid-scenario is not silently signed back in on the next navigation.
- 0940ec6: `I should not see the text` checks what the user can see, and the text steps get exact variants.
  
  - `I should not see the text {string}` passes when no VISIBLE element contains the text. It used to assert that no element in the DOM contained it, so a closed FAQ answer (`hidden`) or a collapsed panel failed the step although nothing was on screen. It now filters on visibility (`getByText(...).filter({ visible: true })` + `toHaveCount(0)`), which is strict-mode safe and retries until the text goes away.
  - `I should see the text {string}` looks past hidden matches: a hidden copy earlier in the DOM no longer fails the step when a visible copy is on the page.
  - New `I should see the exact text {string}` and `I should not see the exact text {string}` match an element's whole text, so `"already"` no longer collides with "the clients you already serve".
  - Migration: new `the page should not contain the text {string}` keeps the old DOM-absence check (substring, hidden elements included). A scenario that relied on `I should not see the text` failing for hidden text should switch to it.
  - All new steps render `{{variables}}` through `renderStrict()`, so an unset variable fails the step instead of passing a negative check.
- Updated dependencies [bd833e1]
  - @sdods/contracts@0.5.1
  - @sdods/db@0.5.1

## 0.5.0

### Minor Changes

- f179b8e: Trace, video, parallelism and a setup tier are now configurable instead of hard-coded in the runner config.
  
  - `evidence: { trace, video, screenshot }` in `sdods.project.yaml`, overridable per key in `envs/<env>.yaml`, with `sdods run --trace <mode>` / `--video <mode>` and `SDODS_TRACE` / `SDODS_VIDEO` on top. Values are Playwright's modes and are validated. Defaults are unchanged (`on-first-retry`, `retain-on-failure`, `off`); with `retries.local: 0` the old default meant no trace locally, so `--trace on` is now the way to get one without forcing a retry.
  - `fullyParallel` (default `true`) per project and per process. `false` keeps the scenarios of a feature file in order.
  - `setup: { tags: '@setup' }` per project, or per process (`setup: false` to turn it off): each run target gets a `<target>--setup` companion that runs the matching scenarios first, in the same browser, and the target depends on it, so the rest of the run does not start when a probe or login fails. Setup scenarios ignore `--tags` and run once.
  - `parseRunnerProjectName` reads the new `<project>--<layer>[--<browser>]--setup` names as their real layer and browser with `phase: 'setup'`.
  - A config value that is invalid only after `${VAR}`, `SDODS_*` or CLI overrides now fails with a configuration error naming the path instead of a raw validation error.

### Patch Changes

- a6d6c99: `sdods auth capture` loads `steps/auth.ts` the same way `sdods run` does.
  
  - A project's `steps/auth.ts` that imports a sibling helper the conventional way (`import './helper.js'` for `helper.ts`) worked under `sdods run`, which goes through Playwright's TypeScript loader, and crashed `sdods auth capture` with `Cannot find module .../helper.js`: capture used a bare `import()`, so the published CLI handed the file to Node's native type stripping, which does not map `.js` to `.ts`. Capture now imports it through tsx, which maps `.js` to `.ts`, transpiles full TypeScript (enums included) and honours the project's module type, like Playwright's loader. The hooks are registered for that import only and removed afterwards. `tsx` is now a dependency of `@sdods/core`.
  - A project without `"type": "module"` has its `auth` export read from the CommonJS module too, instead of silently falling back to the yaml strategy.
- a6d6c99: `sdods lint` reports ambiguous step definitions instead of passing a suite bddgen cannot generate.
  
  - New `steps/ambiguous` error: a feature step matched by more than one definition, which makes bddgen fail with "Multiple definitions matched scenario step". Lint reads the definitions from the same files the runner loads (the core step libraries minus `steps.core.exclude`, plus the project's `steps/` and `pages/`, decorator steps included) and matches them against the scenario step text with the same Cucumber expression engine and rules as bddgen: keywords ignored, tag-scoped steps filtered, `@skip`/`@fixme` scenarios left out. Findings are grouped by where the definitions live, so 67 collisions with one library come back as one error. Each names both `file:line`s and, when a core library is involved, the `steps.core.exclude: [<library>]` that removes it. The check runs in `sdods lint` and in the lint step before `sdods run`.
  - New `steps/duplicate` warning: the same phrasing defined twice with a project file involved, before any feature uses it.
  - An unknown name in `steps.core.exclude` is a `steps/core-exclude` lint error instead of a crash at run time.
  - `sdods lint --undefined-steps` no longer reports "no findings" when bddgen fails for a reason other than a missing step. An ambiguity bddgen reports is surfaced as `steps/ambiguous`; any other generation failure is `steps/bddgen`, with the end of its output.
- 33416fd: Cucumber messages record which step passed or failed again.
  
  On Playwright below 1.63, a workspace that installs SDODS from npm recorded every Gherkin step `SKIPPED` in `messages.ndjson` (and the cucumber HTML report), with failures attached to a hook. playwright-bdd matches a step's result by its line in the generated spec, and those Playwright versions report the line in their transformed copy instead. Measured on 1.60.0, 1.61.1, 1.62.0 and 1.62.1 against 1.63.0.
  
  - `@playwright/test` 1.63.0 is now the floor: `sdods init` scaffolds `^1.63.0`, `@sdods/core` declares `>=1.63` as its peer range, and the server image uses `mcr.microsoft.com/playwright:v1.63.0-noble`.
  - `sdods run` warns and `sdods doctor` fails a "step results" check when the workspace resolves an older `@playwright/test`, and both name the upgrade command.
- 3f2b734: Built-in steps render every `{{variable}}` the same way, and field steps no longer trip over a control whose label merely contains the field's.
  
  - Every built-in step renders its string arguments through one shared helper, `renderStrict()`. `the page URL should contain`, `the page title should contain`, the test-id, dropdown, checkbox, upload, visual-baseline and mock steps rendered nothing before, so `"/workspace/{{fixtureWorkspaceId}}"` was matched with its braces and could never pass. The API steps now also render JSON paths, header names and values, regex patterns and schema names.
  - A variable with no value now fails the step with `no such variable: <name>` instead of being matched as the literal `{{name}}`. For a negative assertion that is the difference between a check and a no-op: `I should not see the text "{{tenantBDatasetId}}"` used to pass whatever the page showed, and a request to `/datasets/{{tenantBDatasetId}}` used to go out and 404. Doc-string bodies (JSON, HTML, raw text) still render leniently, since free text may carry `{{…}}` of its own. Arguments that name the variable being written (`… as {string}`) are identifiers and are not rendered.
  - `I fill the {string} field with {string}`, `I fill the form:`, `I select … dropdown`, `I check … checkbox` and `I upload …` prefer an exact label and a control whose role fits the action, then fall back to the partial label. `getByLabel('Password')` also matched a "Show password" toggle, and the fill failed on a strict-mode violation.
  - `Healer.resolve()` treats a visible locator that matches several elements as a heal trigger for click, fill, select and check: it narrows to the one element whose role fits the action and records a HealEvent, or fails with `HEAL_FAILED` naming the match count. It used to return the ambiguous locator, so the action threw a strict-mode violation that healing never saw. Assertions and hovers are unchanged.
- Updated dependencies [f179b8e]
  - @sdods/contracts@0.5.0
  - @sdods/db@0.5.0

## 0.4.0

### Minor Changes

- 4abc389: Projects can now be created, imported and deleted from the dashboard.
  
  - `sdods project delete <slug> --yes` moves a project to `.sdods/trash/<slug>-<timestamp>` so it can be restored by hand (`--purge` removes it outright). `DELETE /api/projects/:slug?confirm=<slug>` does the same from the web UI, after taking the project's schedules down — the scheduler arms every row it finds without checking that the project still exists, so schedules left behind would keep firing runs against a directory that is gone. The DB row is kept and flagged `archived`, because runs, results and insights all reference it.
  - `sdods project import <source>` registers an existing project from a directory, a `.zip` or a git URL, re-homing its `slug`/`organization`/`workspace` and leaving `.auth/` and `.env*` behind. `--dry-run` reports what it found without writing. `POST /api/projects/import` exposes it, with path and git sources limited to admins since they are read with the server's own credentials.
  - `sdods project create` takes `--description`, and `POST /api/projects` accepts it. That body is now strict: it silently dropped every field it did not name, so a project created from the web form lost its description, tags, routes, modules, processes and environments.
  - Creating a project now validates the target workspace against `sdods.workspace.yaml` as well as the database. A workspace that exists only in the database made `ProjectRegistry.discover` throw for *every* project on the next reload.
  - `VERSION` is read from the package manifest instead of a hand-maintained constant. It had drifted to 0.2.2 while the packages were at 0.3.2, and `sdods init` writes `^${VERSION}` into every scaffolded workspace — where a caret does not cross a 0.x minor, pinning those workspaces to a CLI far behind the server talking to it.
  - `GET /api/health` reports the capabilities of the CLI the server spawns, so the dashboard can explain that an action needs `sdods upgrade --apply` instead of surfacing `unknown command`.

### Patch Changes

- 4abc389: A run that executes no scenarios now fails instead of passing.
  
  - `sdods run` exits `2` when the selection matches nothing, and says so. Zero scenarios with exit `0` looked exactly like a green run, so a mistyped `--tags` or `--feature` kept CI passing while testing nothing. One shard of several may still come back empty, and `--allow-empty` restores the old behaviour for a run that is expected to select nothing.
  - A malformed tag expression (`--tags "@smoke and ("`) is a configuration error (exit `2`) naming the expression, raised before specs are generated; it used to crash bddgen with a stack trace and a hint about undefined steps.
  - `--feature` must name a feature file in the project. It accepts a path relative to `features/`, to the project, to the repository, or an absolute one; a path that does not exist is refused instead of selecting nothing.
  - `sdods features list --tags` evaluates full tag expressions, the same way `sdods run` does. It compared the whole expression to each tag, so `@ui and @smoke` listed nothing.
- 33416fd: Cucumber messages record which step passed or failed again.
  
  On Playwright below 1.63, a workspace that installs SDODS from npm recorded every Gherkin step `SKIPPED` in `messages.ndjson` (and the cucumber HTML report), with failures attached to a hook. playwright-bdd matches a step's result by its line in the generated spec, and those Playwright versions report the line in their transformed copy instead. Measured on 1.60.0, 1.61.1, 1.62.0 and 1.62.1 against 1.63.0.
  
  - `@playwright/test` 1.63.0 is now the floor: `sdods init` scaffolds `^1.63.0`, `@sdods/core` declares `>=1.63` as its peer range, and the server image uses `mcr.microsoft.com/playwright:v1.63.0-noble`.
  - `sdods run` warns and `sdods doctor` fails a "step results" check when the workspace resolves an older `@playwright/test`, and both name the upgrade command.
- 4abc389: Close access-control holes in the server and in agent jobs.
  
  - Run ids `.` and `..` are refused. The router decodes `%2E%2E` before the id check ran, so `GET /api/runs/%2E%2E/files/sdods.db` returned the platform database to anyone with `artifacts:read`.
  - Run files, trees, comparisons, artifacts and HTML reports check the caller's workspace role for the run's project (from the database, a live job, or the run's `run.json`). `/reports/*` sat outside `/api/` and needed no session at all. Ingest refuses to write into a run, or file a manifest under a project, the caller cannot edit.
  - HTML, SVG and XML served from run directories carry `Content-Security-Policy: sandbox` and `nosniff`, so an uploaded page runs with an opaque origin instead of the viewer's session. Uploaded `artifacts.tgz` archives can no longer write `html-report/`, which is served unsandboxed because the Playwright report needs `localStorage`.
  - The auth gate matches the routed path. `/%61pi/tokens` reached `/api/tokens` while skipping authentication and the CSRF check.
  - Sign-ins are throttled per username as well as per IP. `trustProxy` is now `SDODS_TRUST_PROXY` (default `false`); it was always on, so a forged `X-Forwarded-For` gave every guess a fresh address. The Cloud Run deploy sets it to `true`.
  - Agent job `plan` and `spec` must be regular files inside the project, outside dotfiles and hidden directories. They were read verbatim, so `spec: "/proc/self/environ"` streamed the server's environment back through the job log.
  - Agent CLIs (claude-code, codex) start the sdods MCP server without the `agents` capability and disallow `proposal_accept` / `proposal_reject`, so a job can no longer accept its own proposal. Claude Code is limited to the role's tools. Playwright's own MCP server is no longer attached by default, and the bridge used by the OpenAI-compatible and Ollama adapters drops `browser_run_code_unsafe`, `browser_run_code` and `browser_evaluate` from it.
  - `sdods config show` (plain, `--json`, `--explain`) masks header-auth values and credential-looking headers such as `X-Api-Key`; `--explain` reads from the same redacted tree instead of a weaker regex of its own.
- Updated dependencies [4abc389]
  - @sdods/db@0.4.0
  - @sdods/contracts@0.4.0

## 0.3.2

### Patch Changes

- 8370778: The tag gate now really does decide before a pool account is leased.
  
  0.3.0 claimed it did, on the strength of `$sdodsTagGate` being declared first in
  test scope. Declaration order is not an ordering guarantee: Playwright
  instantiates fixtures in DEPENDENCY order, and `user` is pulled in by
  `storageState`, which the browser context needs. So the lease ran first.
  
  An `@env:local @user:noconsent` scenario run against staging therefore failed
  with `No users with role "noconsent" in dataset "users"` instead of skipping.
  Sixteen of seventy-two `@env:local` scenarios failed that way in one run,
  including two whose whole purpose is to fire a deliberate burst at a rate
  limiter — exactly the scenarios the tag exists to keep off a shared environment.
  
  `user` now depends on `$sdodsTagGate`, which is the only ordering guarantee
  Playwright offers. Same run afterwards: 72 skipped, 0 failed.
- @sdods/contracts@0.3.2
  - @sdods/db@0.3.2

## 0.3.1

### Patch Changes

- 77c4a03: `steps.core.exclude` — the migration path 0.3.0 should have shipped with.
  
  0.3.0 added ten step libraries at once. They share ONE step namespace with a
  project's own steps, and playwright-bdd fails generation outright when two
  definitions match the same text, so the upgrade broke every consumer that had
  already written those phrasings — before a single scenario ran, with
  `Multiple definitions matched scenario step`. The first repo to upgrade hit 67
  collisions, which is not a coincidence: the core libraries were modelled on the
  gaps that project documented.
  
  The only remedy was to rewrite all 67 in one commit, unverified, because the
  suite could not run until every one was gone.
  
      steps:
        core:
          exclude: [a11y, browser, dom, net, perf]
  
  excludes by file basename. With nothing excluded the pattern is byte-identical
  to what shipped before, so projects that never set it are unaffected. An unknown
  name throws `CONFIG_INVALID` listing what is available — a typo that silently
  excluded nothing would leave the author believing the collision was handled
  while generation still failed, pointing at the step rather than at the typo.
- Updated dependencies [77c4a03]
  - @sdods/contracts@0.3.1
  - @sdods/db@0.3.1

## 0.3.0

### Minor Changes

- 560e20d: Four tags the runner validated and then ignored now actually do something.
  
  `@env:`, `@skip:<browser>` and `@flag:` were checked at lint time and had no
  runtime path at all — the linter confirmed the tag was spelled correctly and the
  runner ignored it, so a project could carry hundreds of `@env:` tags and still
  point every one of them at production. `@quarantine` was not a tag this
  framework knew about, so every recipe excluded it by hand in a tag expression
  that drifts and that nobody can audit centrally.
  
  `scenarioSkipReason()` is a pure function in `config/tags.ts`, applied by a new
  automatic fixture declared first in test scope — so a scenario is excluded
  before an account is leased, a browser context is built, or a session is minted.
  The reason is recorded as an annotation as well as a skip, because a report that
  says "skipped" without saying why is how parked scenarios go unnoticed.
  
  `@flag:` gates only when the environment declares a flag list. An absent list
  means "not known", and a gate that fails closed on missing metadata would
  silently skip an entire suite.
  
  `sdods run --since <range>` selects only the features a git range could have
  broken, using the `analyzeChangeImpact` mapping that already existed and was
  reachable only through MCP. When nothing is impacted it says so and runs
  nothing, rather than running everything or exiting green on an empty run.
- 01b5c6e: Five new step libraries, and a publish path that cannot ship a stale build.
  
  `a11y.steps.ts` runs a real axe-core audit through `@axe-core/playwright` and adds
  the structural checks a rule engine cannot make — heading outline, alt text,
  per-rule isolation. `gates.a11y` and the `@a11y` tag stop being schema-only.
  
  `perf.steps.ts` wires the previously inert `PerfBudgetsSchema`: `pageLoadMs`,
  `lcpMs`, `fcpMs`, `ttfbMs` from real web-vitals, and `apiP95Ms` from sampled
  request latency.
  
  `net.steps.ts` adds download capture (filename, content type, CSV rows, JSON path)
  and SSE/streaming assertions. `dom.steps.ts` adds focus trapping, dialog and
  popover state, and keyboard navigation. `browser.steps.ts` adds cookies, storage,
  viewport and colour-scheme control, and console-error capture.
  
  Every step that quantifies over a set fails when the set is empty. "Every image
  has an alt" over a page with no images is silence, not a pass, and silence is what
  makes an accessibility suite worthless.
  
  `scripts/publish-npm.sh` now builds clean instead of relying on incremental
  `tsc -b`, and refuses to publish a package whose staged `dist/` is older than its
  `src/`. `@sdods/core@0.2.2` shipped `apiContext.auth = undefined` while its source
  said `auth = null`; because the publish loop skips versions already on the
  registry, that tarball can never be corrected at that version.
- 36cc9d2: Five step libraries for the surfaces Gherkin could not reach.
  
  `iframe.steps.ts` — a frame is entered, acted in, and left. Threading an
  optional frame through every UI step would touch every signature for a surface
  most scenarios never see, so the scope is per-page state instead. Unblocks
  hosted checkout, which is the commonest untestable surface there is.
  
  `tabs.steps.ts` — the action that opens a tab and the wait for it are ONE step.
  `waitForEvent('page')` after the click is a race that loses a fast popup.
  Switching is explicit, because a library that silently re-points `page` makes
  every later assertion ambiguous about which document it read.
  
  `db.steps.ts` — read-only assertions over the existing Kysely fixture, which
  had no step reading it. There is deliberately no INSERT: seeding through the
  database is how a suite comes to assert against states the product cannot
  produce. Table and column names are validated against a strict identifier
  pattern, because an identifier is interpolated rather than parameterised.
  
  `clock.steps.ts` — installing the clock is separate from moving it, and must
  come first. A 55-minute session TTL is not a thing a suite can wait through, so
  without this those scenarios are not slow, they are unwritable.
  
  `webhook.steps.ts` — an ephemeral loopback receiver whose URL is published as
  `{{callback.url}}`, torn down after every scenario including a failing one.
  Deliveries are asserted by polling, never by sleeping.

### Patch Changes

- 949b455: Seven analyzer and auth-strategy defects, each of which stated something false with confidence.
  
  `detectPackageManager` now walks up to the workspace root, so scanning a member
  directory of a monorepo no longer reports `unknown` / `monorepo: false`.
  
  Base URLs are ranked by how specifically the variable NAME claims to be the base
  URL, instead of first-wins by file order — `SIM_AGENT_API_URL` no longer beats
  `NEXT_PUBLIC_API_URL` from 39 lines above it.
  
  An express dependency no longer forces `api = ui`: the `.listen()` port is only
  trusted when it names a different origin, so a full-stack app falls through to
  `ui + '/api'` as intended.
  
  Gitignored `.env*` files are skipped rather than read and republished into the
  report. `.env.example` no longer outranks a real environment for base URLs.
  
  `detectAuth` breaks ties by an explicit precedence and reports the ambiguity —
  with an epsilon, because these scores are sums of decimal weights and an exact
  `===` would call a 2e-16 difference a clear winner.
  
  `sdods analyze` gains `--max-files` / `--max-depth`, and the default file budget
  rises from 8,000 to 25,000: a single real app was 6,400 files, so the walk
  truncated before reaching `.github/` and then reported "no CI" as a fact.
  
  The `sso` and `token` auth strategies throw with a hint instead of silently
  returning no browser session.
- 564cd0e: `sdods auth capture` no longer skips the token when the login state is fresh.
  
  The login state and the API token are two artefacts with two lifetimes, and the
  freshness check covered only the first — but it `continue`d past the whole user,
  so a role could hold a fresh browser session and no token file at all. The API
  layer reads that file (`steps/data.steps.ts`), so every `@user:<role>` scenario
  fell through to a live `token()` mint: one identity-provider sign-in per
  scenario. In mybotbox-qa#57 that produced 1,010 `QUOTA_EXCEEDED` records in a
  single run, which is 67% of that suite's API-layer failures.
  
  The freshness check now gates the login only. The token is minted when there is
  no token file yet, or when `--force` asks for a fresh one — so repeated captures
  no longer leak a new API key into the application under test on every call, which
  the previous unconditional mint did.
- @sdods/contracts@0.3.0
  - @sdods/db@0.3.0
