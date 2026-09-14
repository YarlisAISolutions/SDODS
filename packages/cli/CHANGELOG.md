# @sdods/cli

## 0.7.1

### Patch Changes

- 805752a: Sponsorship is behind one switch, `SPONSOR_ENABLED` in `@sdods/contracts/sponsor`, and it is off. While off, `sdods --help`, the web UI sidebar, the desktop menu and the installers no longer link to the sponsor page, and sdods.com serves its sponsor pages as not found.
- Updated dependencies [805752a]
  - @sdods/contracts@0.7.1
  - @sdods/agents@0.7.1
  - @sdods/core@0.7.1
  - @sdods/db@0.7.1
  - @sdods/integrations@0.7.1
  - @sdods/mcp@0.7.1
  - @sdods/server@0.7.1

## 0.7.0

### Minor Changes

- 5b69426: SDODS for AI coding tools.
  
  - `sdods skills list` and `sdods skills install [--agent claude,agents,cursor,copilot,gemini] [--global]` copy the bundled Agent Skills (`sdods`, `sdods-run`, `sdods-record`, `sdods-start-ui`) to where Claude Code, Codex, Cursor, Copilot and Gemini CLI read them; `npx -y @sdods/cli skills install` needs no global install. `sdods init` installs the same set into `.claude/skills` and `.agents/skills`, and no longer copies SDODS's own release skills.
  - `sdods mcp install gemini` writes `.gemini/settings.json`.
  - Every stdio snippet now launches `npx -y @sdods/cli mcp`. `npx sdods mcp` pointed at a package that does not exist, so clients configured from `mcp install --file`, `agent install`, the web UI or `/api/mcp/info` failed with CONNECTION_CLOSED outside a checkout.
  - `sdods mcp install claude|codex --http-url` passes the bearer token (`${SDODS_TOKEN}` / `--bearer-token-env-var SDODS_TOKEN`); before, both registered a server that answered 401.
  - `sdods mcp install windsurf` writes Windsurf's real config, `~/.codeium/windsurf/mcp_config.json`, with `serverUrl` for remote servers.

### Patch Changes

- a4e660d: SDODS can now be sponsored. sdods.com/sponsor takes one-time or monthly sponsorships through Stripe, in any amount, and companies can ask for an invoice or a bank transfer. `sdods --help`, the installer's closing notes, the web UI sidebar and the desktop app's SDODS menu each link to that page.
- Updated dependencies [5b69426]
  - @sdods/mcp@0.7.0
  - @sdods/agents@0.7.0
  - @sdods/server@0.7.0
  - @sdods/contracts@0.7.0
  - @sdods/core@0.7.0
  - @sdods/db@0.7.0
  - @sdods/integrations@0.7.0

## 0.6.0

### Minor Changes

- 097aead: `sdods users reset --yes` removes every user with their sessions, API tokens and memberships, so the next `sdods serve` offers the one-time `/setup` link again; projects, runs and schedules are kept. `sdods users set-password <username> --password <pw> [--activate]` sets a password from the terminal, signs the user out everywhere and can re-enable a deactivated account, so a locked-out sole admin no longer has to wipe the database. Both are audited. The docs gain a "Reinstall or reset" section for installed, clone, Docker and desktop setups.

### Patch Changes

- Updated dependencies [097aead]
  - @sdods/db@0.6.0
  - @sdods/core@0.6.0
  - @sdods/server@0.6.0
  - @sdods/agents@0.6.0
  - @sdods/contracts@0.6.0
  - @sdods/integrations@0.6.0
  - @sdods/mcp@0.6.0

## 0.5.2

### Patch Changes

- 45a38a8: Stop publishing Playwright traces, and redact the ones a run keeps (#101).
  
  A `trace.zip` records every request's `Cookie`/`Authorization` headers, `Set-Cookie` responses, the context's `storageState` (cookies, localStorage, IndexedDB — where Firebase keeps its refresh token) and typed values, so for projects with pool accounts it carries live sessions.
  
  - **Integrations never upload, attach or link a trace.** GitHub issues no longer link `trace.zip` through `SDODS_PUBLIC_URL` or the CI artifacts page, and `uploadToRelease` no longer uploads it; Jira no longer attaches it. Both name the trace's local path under a warning that it contains credentials, with the `npx playwright show-trace` command. The video is still linked or uploaded (it shows the screen, not headers or storage).
  - **`sdods run` redacts every trace after the run**, before ingest and integrations: `runner-output/**/trace.zip`, the HTML report's copies under `html-report/data/`, zips nested in blob shard reports, and the BASE64 trace bodies embedded in `messages.ndjson` (which ingest turns back into `trace.zip`). Credential headers (`Cookie`, `Set-Cookie`, `Authorization`, `Proxy-Authorization`, `X-Api-Key` and similar), cookie values, localStorage/sessionStorage/IndexedDB values, `httpCredentials` passwords, password inputs in DOM snapshots and values typed into password/secret/token fields become `[redacted]`. Other entries are copied through unchanged and the trace viewer opens the result. Request/response bodies and page text are not redacted.
  - New `evidence.redactTraces` (default `true`; env files may override it). `evidence.trace` and `sdods run --trace <mode>` already control whether traces are recorded at all.
  - Docs warn that traces are credential-bearing (GitHub and Jira guide, `sdods trace`, `project.yaml` reference).
- Updated dependencies [45a38a8]
  - @sdods/core@0.5.2
  - @sdods/contracts@0.5.2
  - @sdods/integrations@0.5.2
  - @sdods/server@0.5.2
  - @sdods/agents@0.5.2
  - @sdods/db@0.5.2
  - @sdods/mcp@0.5.2

## 0.5.1

### Patch Changes

- Updated dependencies [bd833e1]
- Updated dependencies [0dcaef8]
- Updated dependencies [0940ec6]
  - @sdods/core@0.5.1
  - @sdods/contracts@0.5.1
  - @sdods/server@0.5.1
  - @sdods/agents@0.5.1
  - @sdods/db@0.5.1
  - @sdods/integrations@0.5.1
  - @sdods/mcp@0.5.1

## 0.5.0

### Minor Changes

- 912569e: Enabled integrations now act on `sdods run`, and GitHub issues from failures carry video and trace, survive a fresh CI runner and have their labels checked.
  
  - `sdods run` publishes the finished run to every enabled integration (check runs, PR comment, issues per `createIssueOnFailure`) through the same code path as `sdods integrations notify`. `integrations.github.createIssueOnFailure` used to do nothing unless a separate notify step existed. `--no-notify` opts out; cancelled runs, runs with no scenario results and sharded runs do not notify. A notify failure is printed as a warning and never changes the exit code, and `--json` output reports the outcome under `notify`.
  - GitHub issue bodies link the failing attempt's `video.webm` and `trace.zip` from `runner-output/`, read from `runner-results.json`, with the `npx playwright show-trace` command. `uploadToRelease` uploads them with their real content type instead of `image/png`.
  - Before creating an issue, the GitHub provider searches the repository for an open issue carrying `sdods-fingerprint:<fingerprint>` and comments on it, so a runner without `.sdods/issue-links.json` no longer opens a duplicate. Notifying the same run twice no longer comments twice.
  - `sdods integrations test` fails when a configured GitHub label does not exist in the repository and names the missing labels; `--create-labels` creates them.
- f179b8e: Trace, video, parallelism and a setup tier are now configurable instead of hard-coded in the runner config.
  
  - `evidence: { trace, video, screenshot }` in `sdods.project.yaml`, overridable per key in `envs/<env>.yaml`, with `sdods run --trace <mode>` / `--video <mode>` and `SDODS_TRACE` / `SDODS_VIDEO` on top. Values are Playwright's modes and are validated. Defaults are unchanged (`on-first-retry`, `retain-on-failure`, `off`); with `retries.local: 0` the old default meant no trace locally, so `--trace on` is now the way to get one without forcing a retry.
  - `fullyParallel` (default `true`) per project and per process. `false` keeps the scenarios of a feature file in order.
  - `setup: { tags: '@setup' }` per project, or per process (`setup: false` to turn it off): each run target gets a `<target>--setup` companion that runs the matching scenarios first, in the same browser, and the target depends on it, so the rest of the run does not start when a probe or login fails. Setup scenarios ignore `--tags` and run once.
  - `parseRunnerProjectName` reads the new `<project>--<layer>[--<browser>]--setup` names as their real layer and browser with `phase: 'setup'`.
  - A config value that is invalid only after `${VAR}`, `SDODS_*` or CLI overrides now fails with a configuration error naming the path instead of a raw validation error.

### Patch Changes

- 33416fd: Cucumber messages record which step passed or failed again.
  
  On Playwright below 1.63, a workspace that installs SDODS from npm recorded every Gherkin step `SKIPPED` in `messages.ndjson` (and the cucumber HTML report), with failures attached to a hook. playwright-bdd matches a step's result by its line in the generated spec, and those Playwright versions report the line in their transformed copy instead. Measured on 1.60.0, 1.61.1, 1.62.0 and 1.62.1 against 1.63.0.
  
  - `@playwright/test` 1.63.0 is now the floor: `sdods init` scaffolds `^1.63.0`, `@sdods/core` declares `>=1.63` as its peer range, and the server image uses `mcr.microsoft.com/playwright:v1.63.0-noble`.
  - `sdods run` warns and `sdods doctor` fails a "step results" check when the workspace resolves an older `@playwright/test`, and both name the upgrade command.
- Updated dependencies [a6d6c99]
- Updated dependencies [a6d6c99]
- Updated dependencies [33416fd]
- Updated dependencies [912569e]
- Updated dependencies [f179b8e]
- Updated dependencies [3f2b734]
  - @sdods/core@0.5.0
  - @sdods/integrations@0.5.0
  - @sdods/contracts@0.5.0
  - @sdods/server@0.5.0
  - @sdods/agents@0.5.0
  - @sdods/db@0.5.0
  - @sdods/mcp@0.5.0

## 0.4.0

### Minor Changes

- 4abc389: A run that executes no scenarios now fails instead of passing.
  
  - `sdods run` exits `2` when the selection matches nothing, and says so. Zero scenarios with exit `0` looked exactly like a green run, so a mistyped `--tags` or `--feature` kept CI passing while testing nothing. One shard of several may still come back empty, and `--allow-empty` restores the old behaviour for a run that is expected to select nothing.
  - A malformed tag expression (`--tags "@smoke and ("`) is a configuration error (exit `2`) naming the expression, raised before specs are generated; it used to crash bddgen with a stack trace and a hint about undefined steps.
  - `--feature` must name a feature file in the project. It accepts a path relative to `features/`, to the project, to the repository, or an absolute one; a path that does not exist is refused instead of selecting nothing.
  - `sdods features list --tags` evaluates full tag expressions, the same way `sdods run` does. It compared the whole expression to each tag, so `@ui and @smoke` listed nothing.
- 4abc389: Projects can now be created, imported and deleted from the dashboard.
  
  - `sdods project delete <slug> --yes` moves a project to `.sdods/trash/<slug>-<timestamp>` so it can be restored by hand (`--purge` removes it outright). `DELETE /api/projects/:slug?confirm=<slug>` does the same from the web UI, after taking the project's schedules down — the scheduler arms every row it finds without checking that the project still exists, so schedules left behind would keep firing runs against a directory that is gone. The DB row is kept and flagged `archived`, because runs, results and insights all reference it.
  - `sdods project import <source>` registers an existing project from a directory, a `.zip` or a git URL, re-homing its `slug`/`organization`/`workspace` and leaving `.auth/` and `.env*` behind. `--dry-run` reports what it found without writing. `POST /api/projects/import` exposes it, with path and git sources limited to admins since they are read with the server's own credentials.
  - `sdods project create` takes `--description`, and `POST /api/projects` accepts it. That body is now strict: it silently dropped every field it did not name, so a project created from the web form lost its description, tags, routes, modules, processes and environments.
  - Creating a project now validates the target workspace against `sdods.workspace.yaml` as well as the database. A workspace that exists only in the database made `ProjectRegistry.discover` throw for *every* project on the next reload.
  - `VERSION` is read from the package manifest instead of a hand-maintained constant. It had drifted to 0.2.2 while the packages were at 0.3.2, and `sdods init` writes `^${VERSION}` into every scaffolded workspace — where a caret does not cross a 0.x minor, pinning those workspaces to a CLI far behind the server talking to it.
  - `GET /api/health` reports the capabilities of the CLI the server spawns, so the dashboard can explain that an action needs `sdods upgrade --apply` instead of surfacing `unknown command`.

### Patch Changes

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
- Updated dependencies [4abc389]
- Updated dependencies [4abc389]
  - @sdods/core@0.4.0
  - @sdods/db@0.4.0
  - @sdods/server@0.4.0
  - @sdods/agents@0.4.0
  - @sdods/contracts@0.4.0
  - @sdods/integrations@0.4.0
  - @sdods/mcp@0.4.0

## 0.3.2

### Patch Changes

- Updated dependencies [8370778]
  - @sdods/core@0.3.2
  - @sdods/server@0.3.2
  - @sdods/agents@0.3.2
  - @sdods/contracts@0.3.2
  - @sdods/db@0.3.2
  - @sdods/integrations@0.3.2
  - @sdods/mcp@0.3.2

## 0.3.1

### Patch Changes

- Updated dependencies [77c4a03]
  - @sdods/core@0.3.1
  - @sdods/contracts@0.3.1
  - @sdods/server@0.3.1
  - @sdods/agents@0.3.1
  - @sdods/db@0.3.1
  - @sdods/integrations@0.3.1
  - @sdods/mcp@0.3.1

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
- Updated dependencies [949b455]
- Updated dependencies [564cd0e]
- Updated dependencies [560e20d]
- Updated dependencies [01b5c6e]
- Updated dependencies [36cc9d2]
  - @sdods/core@0.3.0
  - @sdods/server@0.3.0
  - @sdods/agents@0.3.0
  - @sdods/contracts@0.3.0
  - @sdods/db@0.3.0
  - @sdods/integrations@0.3.0
  - @sdods/mcp@0.3.0
