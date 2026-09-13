# @sdods/core

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
