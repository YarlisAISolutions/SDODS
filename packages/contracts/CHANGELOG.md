# @sdods/contracts

## 0.11.1

### Patch Changes

- 835d64c: Repository metadata moved to the YarlisAISolutions organisation: `repository.url` and `bugs.url` now point at https://github.com/YarlisAISolutions/SDODS, `sdods feedback` opens issues there, and the documented server image is `ghcr.io/yarlisaisolutions/sdods-server`.

## 0.11.0

No changes in this release.

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

## 0.8.0

### Minor Changes

- 4c00473: Canvas steps for graph and node editors (`canvas.steps.ts`): drag an element onto another or by an offset, drag a node by id, connect a handle of one node to a handle of another, select a node, set a field inside a node, and assert the node count, an edge from one node to another (or its absence), a node's visibility and a badge inside a node.
  
  - Drags are real pointer gestures (press, nudge, multi-step moves, a final move onto the target, release), so React Flow, d3-drag and native HTML5 `draggable` palettes all react. The press lands on a plain part of the element, never on a field or handle inside it.
  - New project key `canvas` in `@sdods/contracts`: CSS selector templates for `root`, `nodes`, `node`, `handle`, `edge`, `field`, `badge` and `selected`, defaulting to React Flow's DOM. Templates are validated for their required placeholders (`{id}`, `{handle}`, `{source}`/`{target}`, `{field}`, `{badge}`), and `{testIdAttribute}` expands to the project's attribute.
  - A project whose own steps already use these phrasings can keep them with `steps.core.exclude: [canvas]`.
- 842a700: Email assertions over Mailpit. A new `mail` block in the environment yaml (`provider: mailpit`, `url`, optional basic `auth` with a `${VAR}` password) enables seven steps: clear the inbox for an address, wait for an email with a subject within N seconds, assert the latest email's text or sender, save a link or a one-time code from it, and open its link. "The latest email" is scoped to the scenario: only mail received after the scenario started or after the last clear counts, and the wait step pins the message it matched. `@sdods/core` also exports the `MailInbox` interface and `MailpitInbox` adapter.
- f950986: GitHub issues can embed evidence that renders inline in private repositories (#82). With `integrations.github.evidence.host: branch` (off by default), screenshots, `video.webm` and a GIF preview (when ffmpeg is on PATH) go to an orphan `sdods-evidence` branch through the git data API, in one fast-forward commit per run that is retried when another job moved the branch first, and are embedded as `blob/<branch>/<path>?raw=true`. The evidence can go to a separate repository with its own token (`evidence.repo`, `evidence.tokenEnv`). Per-file and per-run size caps apply (`maxFileBytes` 5 MB, `maxRunBytes` 25 MB), and files over them are listed in the issue. `sdods integrations test` checks that the token can push to the evidence repository, and `sdods integrations evidence prune [--older-than 14d]` rewrites the branch without old runs. Traces are never uploaded.
- 00930d0: `sdods load -p <project> -e <env> <profile>` runs API load tests through k6. A profile in `projects/<slug>/load/<profile>.yaml` lists requests (method, path relative to `api.baseUrl`, headers, body, expected status and body checks) with k6 `stages` or `vus`/`duration` and `thresholds`. SDODS generates a k6 script whose credentials come from the environment's `api.auth` as `__ENV` lookups, never inlined, prints the target URL and peak virtual users, runs `k6 run --summary-export` (or the `grafana/k6` image with `--runner docker`) and exits `1` when thresholds fail. Load is opt-in: an environment must set `load.allowed: true`, `load.maxVus` caps the peak, and write methods need `load.allowWrites: true`. `--dry-run` writes the script without k6. Results land in `.sdods/runs/<id>/load/<profile>/`.
- 509b2c8: Role matrices (#118): declare an actor × surface grid once in `projects/<slug>/roles.matrix.yaml` and generate the Scenario Outline examples from it.
  
  - `@sdods/contracts`: `RolesMatrixFileSchema` and `ROLES_MATRIX_FILE`. A matrix lists its `roles`, a `default` outcome, optional `outcomes` and `title`, and `rows` whose extra keys are Examples columns; `expect` is one outcome or a per-role map.
  - `@sdods/core`: `loadRolesMatrices`, `expandFeatureText` and `planMatrixExpansion`. A `Scenario Outline` tagged `@matrix:<name>` gets one `Examples:` block per role, tagged `@user:<role>`, between `# sdods:matrix:begin/end` markers; re-running is idempotent and hand-written Examples are kept. `sdods lint` accepts `@matrix:<name>` and reports an unknown matrix (`tags/matrix`), an invalid matrix file or undeclared role, a misplaced template or unknown placeholder, an out-of-date feature (`matrix/stale`, warning), and a matrix role with no user-pool account in an environment (`matrix/unseeded-role`, warning).
  - `@sdods/cli`: `sdods matrix expand [-p <slug>] [--check] [--dry-run]`; `--check` exits 3 when a feature is out of date, for CI.
  - `@sdods/mcp`: `matrix_expand` stages the expanded features as a proposal instead of writing them. The conventions list `@matrix:<name>` among the value tags.
- 85ac708: Requirement traceability (#119). A new value tag `@req:<id>` links a scenario to a requirement; it may repeat, and on a `Feature` or `Rule` it applies to every scenario under it. The id is opaque. An optional `traceability:` block in `sdods.project.yaml` (`requirements`: a YAML or CSV list of ids and titles, `link`: a URL template with `{id}`, `require`: boolean) makes lint reject ids missing from the list (`tags/req`) and, with `require: true`, scenarios without a `@req:` tag (`tags/req-missing`).
  
  `sdods report traceability -p <slug> [-e <env>] [--run <id> | --last] [--format json|csv|md|html] [-o <file>]` exports requirement → scenarios (feature, line, name, tags) → final result per runner project in the chosen run (status, browser, attempts, flaky, duration, timestamps), with the run's id, environment, commit and SDODS version, a coverage summary (passed / failed / not run / not covered) and an empty sign-off block that SDODS never fills in. It reads `messages.ndjson` from the run directory, falling back to per-scenario `meta.json`; no database or server is needed. `@sdods/core/analyze` exports `buildTraceabilityReport` and `renderTraceability`.
  
  The agent conventions (`@sdods/mcp` `CONVENTIONS`) list `@req:<id>` among the optional value tags.

### Patch Changes

- 8611552: GitHub evidence host: `evidence prune` can no longer erase a real branch. Uploads, prune and `sdods integrations test` refuse the repository's default branch; prune also refuses a branch SDODS did not create (its root README must be the `# SDODS evidence` one the orphan commit writes); and `integrations.github.evidence.branch` rejects `main`, `master`, `develop`, `development`, `trunk` and `gh-pages`. Before, `evidence.branch: main` committed evidence onto main and prune then force-updated main to an orphan commit.
- 8611552: `sdods load` refuses a `SDODS_API_BASE_URL` that differs from the environment's `api.baseUrl`, because the opt-in (`load.allowed`) belongs to that environment file and a stray override sent the load to another host. `--dry-run` reports it as a guard problem. An environment whose URL is meant to change per run sets `load.allowBaseUrlOverride: true`.
- 8611552: Role matrices: a custom `title` must use `<role>` and every row column. A title such as `'<surface> → <expect>'` gave two roles with the same outcome the same test title, and Playwright refuses to load duplicate titles. A title that still renders the same text twice (adjacent placeholders) is reported too.

## 0.7.3

## 0.7.2

## 0.7.1

### Patch Changes

- 805752a: Sponsorship is behind one switch, `SPONSOR_ENABLED` in `@sdods/contracts/sponsor`, and it is off. While off, `sdods --help`, the web UI sidebar, the desktop menu and the installers no longer link to the sponsor page, and sdods.com serves its sponsor pages as not found.

## 0.7.0

## 0.6.0

## 0.5.2

### Patch Changes

- 45a38a8: Stop publishing Playwright traces, and redact the ones a run keeps (#101).
  
  A `trace.zip` records every request's `Cookie`/`Authorization` headers, `Set-Cookie` responses, the context's `storageState` (cookies, localStorage, IndexedDB — where Firebase keeps its refresh token) and typed values, so for projects with pool accounts it carries live sessions.
  
  - **Integrations never upload, attach or link a trace.** GitHub issues no longer link `trace.zip` through `SDODS_PUBLIC_URL` or the CI artifacts page, and `uploadToRelease` no longer uploads it; Jira no longer attaches it. Both name the trace's local path under a warning that it contains credentials, with the `npx playwright show-trace` command. The video is still linked or uploaded (it shows the screen, not headers or storage).
  - **`sdods run` redacts every trace after the run**, before ingest and integrations: `runner-output/**/trace.zip`, the HTML report's copies under `html-report/data/`, zips nested in blob shard reports, and the BASE64 trace bodies embedded in `messages.ndjson` (which ingest turns back into `trace.zip`). Credential headers (`Cookie`, `Set-Cookie`, `Authorization`, `Proxy-Authorization`, `X-Api-Key` and similar), cookie values, localStorage/sessionStorage/IndexedDB values, `httpCredentials` passwords, password inputs in DOM snapshots and values typed into password/secret/token fields become `[redacted]`. Other entries are copied through unchanged and the trace viewer opens the result. Request/response bodies and page text are not redacted.
  - New `evidence.redactTraces` (default `true`; env files may override it). `evidence.trace` and `sdods run --trace <mode>` already control whether traces are recorded at all.
  - Docs warn that traces are credential-bearing (GitHub and Jira guide, `sdods trace`, `project.yaml` reference).

## 0.5.1

### Patch Changes

- bd833e1: Make every credential an API call carries explicit, and wire two config fields that did nothing.
  
  - `I use an isolated API client` (or `apiContext.isolated = true`) sends the rest of the scenario's calls through a separate request context with an empty cookie jar, created on first use and disposed at teardown. On `@ui`/`@hybrid` the shared `request` context starts from the `@user:<role>` storageState, so "an invalid API key is refused" passed on the session cookie. The raw (`without following redirects`) and event-stream steps honour it. The step library reference documents which layers carry which jar.
  - String bodies are sent as bytes. Playwright JSON-encodes a string that does not parse when the content-type is exactly `application/json`, so `{ this is not json` arrived as `"{ this is not json"`. New step `I send a {method} request to {string} with the raw body:` sends its doc string untouched (not parsed, not template-rendered).
  - `I use a leased user with role {string} for API calls` no longer attaches the user's token behind the scenario's back for `custom` auth strategies, whose `token()` may mint a different credential class than the session. New project setting `auth.apiToken: implicit | explicit` (default: explicit for `custom`, implicit for every other strategy, unchanged) and new step `I authenticate the API with the leased user's token`. Which credential was attached, and from where, is logged at `info`. **Behaviour change** for `custom` strategies that relied on the implicit bearer: add the step, or set `auth.apiToken: implicit`.
  - Recorded API evidence carries `request.auth` (`none`, `bearer`, `basic`, `header:<name>`, never the value) and `request.isolated`.
  - `env.api.auth: { type: oauth-client-credentials }` is implemented: a `client_credentials` grant to `tokenUrl` (with `scope`/`audience` when set), sent as a bearer and cached per worker until 30 s before `expires_in`. A refused grant fails the call as `AUTH_FAILED` instead of sending it anonymous, and an auth type the client does not implement throws `NOT_SUPPORTED`. The `oauth-client-credentials` auth strategy's `token()` shares the implementation. Raw requests now resolve auth exactly like the client, which also makes `I use no authentication` apply to them (`null ?? env` used to fall back to the environment credential).
  - `retries.byTag` reaches the runner. Each entry becomes a sibling runner project with the same name that greps the tag and carries its retries; the base project excludes those tags, and a scenario with several such tags runs once with the highest count. `--retries` still overrides it, and a scenario's own `@retries:N` tag overrides both.

## 0.5.0

### Minor Changes

- f179b8e: Trace, video, parallelism and a setup tier are now configurable instead of hard-coded in the runner config.
  
  - `evidence: { trace, video, screenshot }` in `sdods.project.yaml`, overridable per key in `envs/<env>.yaml`, with `sdods run --trace <mode>` / `--video <mode>` and `SDODS_TRACE` / `SDODS_VIDEO` on top. Values are Playwright's modes and are validated. Defaults are unchanged (`on-first-retry`, `retain-on-failure`, `off`); with `retries.local: 0` the old default meant no trace locally, so `--trace on` is now the way to get one without forcing a retry.
  - `fullyParallel` (default `true`) per project and per process. `false` keeps the scenarios of a feature file in order.
  - `setup: { tags: '@setup' }` per project, or per process (`setup: false` to turn it off): each run target gets a `<target>--setup` companion that runs the matching scenarios first, in the same browser, and the target depends on it, so the rest of the run does not start when a probe or login fails. Setup scenarios ignore `--tags` and run once.
  - `parseRunnerProjectName` reads the new `<project>--<layer>[--<browser>]--setup` names as their real layer and browser with `phase: 'setup'`.
  - A config value that is invalid only after `${VAR}`, `SDODS_*` or CLI overrides now fails with a configuration error naming the path instead of a raw validation error.

## 0.4.0

## 0.3.2

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

## 0.3.0
