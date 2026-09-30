# @sdods/server

## 0.12.0

### Minor Changes

- 47075bc: Runs no longer fail with Playwright's "Executable doesn't exist … run npx playwright install" when a test browser is missing or half-downloaded. `sdods run` checks, before generating specs, that every browser its targets launch (chromium for `@api` targets too) finished downloading for the exact revision the workspace's Playwright uses. With `--install-browsers` or `SDODS_AUTO_INSTALL_BROWSERS=1` (set by the desktop app) it downloads what is missing into the cache the runner reads; otherwise it stops with the `sdods browsers install` command. `sdods browsers list` and `sdods doctor` use the same check.
  
  Stopping a run from the UI or API now ends the whole process tree (the CLI, Playwright, its workers and browsers) on Windows, macOS and Linux, and requires the editor role, like starting one. New `POST /api/runs/:id/rerun` (`{ scope: 'all' | 'failed', scenarios? }`) replays a run's full selection, only its failed scenarios, or named ones; runs now store the selection they were started with (`runs.params_json`). New `GET`/`PUT /api/me/preferences/:key` store per-user UI preferences (`user_preferences` table), used to remember the last run selection per workspace and project.

### Patch Changes

- Updated dependencies [47075bc]
  - @sdods/db@0.12.0
  - @sdods/core@0.12.0
  - @sdods/contracts@0.12.0
  - @sdods/mcp@0.12.0

## 0.11.3

### Patch Changes

- @sdods/contracts@0.11.3
  - @sdods/core@0.11.3
  - @sdods/db@0.11.3
  - @sdods/mcp@0.11.3

## 0.11.2

### Patch Changes

- cc2c6ad: Fixes found by using every web UI feature against a real server.
  
  - Workspaces created in the web UI (or with `POST /api/workspaces`) are written to `sdods.workspace.yaml` before the database, so projects can be created in and imported into them. Creating a workspace that is already declared returns 409.
  - Project Settings saves again: `PUT /api/projects/:slug` accepts `{ patch }`, the top-level keys that changed, applied to the yaml in place so comments and keys the form does not show are kept. The form now sends only what changed.
  - Dataset upload: the preview uses `POST .../datasets` with `preview=1` (the page called a route that does not exist), and the name, environment and storage fields are sent before the file so the server reads them. A file dataset is registered under `data.sources`, so it is listed and usable as `@data:<name>`.
  - Creating a user with the email field left empty no longer fails with "Invalid email address".
  - The web app's mock dev server (`bun run web:dev`) starts again: browser code imports `@sdods/contracts/schemas` instead of the root export, which pulled in `node:crypto`.
  - Docs: account menu, Settings → Profile and Password & sessions, the account REST routes, and refreshed web UI screenshots.
- @sdods/contracts@0.11.2
  - @sdods/core@0.11.2
  - @sdods/db@0.11.2
  - @sdods/mcp@0.11.2

## 0.11.1

### Patch Changes

- 835d64c: Repository metadata moved to the YarlisAISolutions organisation: `repository.url` and `bugs.url` now point at https://github.com/YarlisAISolutions/SDODS, `sdods feedback` opens issues there, and the documented server image is `ghcr.io/yarlisaisolutions/sdods-server`.
- b9c1037: Fixes found by using every web UI feature against a real server.
  
  - Workspaces created in the web UI (or with `POST /api/workspaces`) are written to `sdods.workspace.yaml` before the database, so projects can be created in and imported into them. Creating a workspace that is already declared returns 409.
  - Project Settings saves again: `PUT /api/projects/:slug` accepts `{ patch }`, the top-level keys that changed, applied to the yaml in place so comments and keys the form does not show are kept. The form now sends only what changed.
  - Dataset upload: the preview uses `POST .../datasets` with `preview=1` (the page called a route that does not exist), and the name, environment and storage fields are sent before the file so the server reads them. A file dataset is registered under `data.sources`, so it is listed and usable as `@data:<name>`.
  - Creating a user with the email field left empty no longer fails with "Invalid email address".
  - The web app's mock dev server (`bun run web:dev`) starts again: browser code imports `@sdods/contracts/schemas` instead of the root export, which pulled in `node:crypto`.
  - Docs: account menu, Settings → Profile and Password & sessions, the account REST routes, and refreshed web UI screenshots.
- Updated dependencies [835d64c]
  - @sdods/core@0.11.1
  - @sdods/contracts@0.11.1
  - @sdods/db@0.11.1
  - @sdods/mcp@0.11.1

## 0.11.0

### Minor Changes

- 00f2d34: Account menu, profile and sessions in the web UI.
  
  - The sidebar footer is now an account menu: profile, password and sessions, preferences, API tokens, MCP clients, admin pages, theme (system, light, dark), feedback and sign out.
  - Settings gains Profile (display name, email, role, memberships), Password & sessions (change password with the current one, list and sign out other sessions) and Preferences (theme, default organization, workspace and project).
  - `@sdods/db`: migration `0009_user_profile` adds `users.display_name`; `listSessionsForUser`, `deleteSessionById`, and `deleteSessionsForUser(userId, { exceptToken })`.
  - `@sdods/server`: `PATCH /api/me`, `POST /api/me/password`, `GET /api/me/sessions`, `DELETE /api/me/sessions/:id`, `POST /api/me/sessions/revoke-others` (browser sessions only, never API tokens). `/api/auth/me` returns email, display name, last login, creation date and the current session id. `PATCH /api/users/:id` accepts `displayName`.
  - Web pages that called routes the server does not have now use the real ones: Recorder (job events, recorded spec via `GET /api/projects/:slug/recorded/:file`, convert with `kind: convert`), Environments (create and edit through `PUT .../envs/:name`, which now edits the file in place instead of rewriting it), Schedules (save, pause/resume, history), Integrations (`PUT .../integrations` validates before writing and merges MCP servers by name) and the Agents live log.
  - `sdods users set-role` rejects an unknown role instead of reporting success without changing anything.

### Patch Changes

- Updated dependencies [00f2d34]
  - @sdods/db@0.11.0
  - @sdods/core@0.11.0
  - @sdods/contracts@0.11.0
  - @sdods/mcp@0.11.0

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
  - @sdods/core@0.10.0
  - @sdods/db@0.10.0
  - @sdods/mcp@0.10.0

## 0.9.0

### Minor Changes

- 3fb1773: Visual baselines you review before they change, per-baseline masks, and Linux baselines from CI.
  
  - `screenshots.maxDiffPixelRatio` (default `0.01`, previously hard-coded) and `screenshots.baselines.<name>` with its own `mask` (added to `screenshots.mask`) and `maxDiffPixelRatio`, in the project or an environment.
  - New step `the page should match the visual baseline {string} masking {string}` with comma-separated selectors.
  - A failed visual check keeps its expected, actual and diff images and a `<name>.failure.json` record under the scenario's `visual/<run target>/` directory, so they survive the CI artifact upload.
  - `sdods baselines diff [--run <id>]` lists failed visual checks; `sdods baselines accept <name…> --run <id>` (or `--all`) copies the actual screenshot to `features/__screenshots__/<run target>/<platform>/` for the platform the run happened on. `sdods run --update-snapshots` still works and now warns that it overwrites without review.
  - Server: `GET /api/runs/:id/baselines` and `POST /api/runs/:id/baselines/accept` (`features:write`, editor role); the web UI shows **Accept as baseline** with the diff on a failed visual step.

### Patch Changes

- 47ac9e2: `@a11y` and `@perf` now run, and process gates are evaluated.
  
  - `@a11y`: at the end of a UI or hybrid scenario, the page it ended on is audited with axe-core (WCAG 2.x A and AA). The scenario fails on any violation at or above the new `a11y.failOn` setting (`serious` by default). `a11y.include` and `a11y.exclude` scope the audit, and an environment can override each key. The result is attached as `sdods/a11y-scenario`. A URL that an explicit whole-page audit step already checked is not audited again.
  - `@perf`: every document the scenario loads records its vitals once it has loaded and painted. At the end of the scenario, each recording is compared with the page budgets in `perf.budgets`, and the p95 of the scenario's live API calls (plus any latency samples) is compared with `apiP95Ms`. The scenario fails in four cases: a budget is breached, a budgeted vital is unmeasured, no budgets are configured (`CONFIG_INVALID`), or no budget applies to anything the scenario measured. The result is attached as `sdods/perf-scenario`.
  - `sdods run --process <name>` evaluates `gates.minPassRate`, `gates.maxFlaky`, `gates.a11y` and `gates.perfBudgets` after the run and prints a gate table. When a gate fails, it exits 1 with the new error code `GATE_FAILED`. The a11y and perf gates also fail when nothing was audited or judged. The verdict is written to `gates.json`, `summary.json` and the `--json` output. The server's run manager records it on the run under `totals_json.gates` and marks a gated-out run failed. Gates are not evaluated on a single shard.
  - The axe audit and the vitals and budget helpers moved out of the step files into `a11y/audit.ts` and `perf/vitals.ts`, so the hooks can use them without registering the steps a second time. The step files still re-export them.
- Updated dependencies [47ac9e2]
- Updated dependencies [dd24cdb]
- Updated dependencies [3fb1773]
  - @sdods/core@0.9.0
  - @sdods/contracts@0.9.0
  - @sdods/db@0.9.0
  - @sdods/mcp@0.9.0

## 0.8.0

### Patch Changes

- Updated dependencies [8611552]
- Updated dependencies [8611552]
- Updated dependencies [4c00473]
- Updated dependencies [8611552]
- Updated dependencies [842a700]
- Updated dependencies [8611552]
- Updated dependencies [f950986]
- Updated dependencies [8611552]
- Updated dependencies [00930d0]
- Updated dependencies [8611552]
- Updated dependencies [8611552]
- Updated dependencies [8611552]
- Updated dependencies [8611552]
- Updated dependencies [b0ae3b9]
- Updated dependencies [0cc05cb]
- Updated dependencies [509b2c8]
- Updated dependencies [8611552]
- Updated dependencies [85ac708]
  - @sdods/core@0.8.0
  - @sdods/contracts@0.8.0
  - @sdods/db@0.8.0
  - @sdods/mcp@0.8.0

## 0.7.3

### Patch Changes

- Updated dependencies [ffbf50f]
- Updated dependencies [732d1e2]
  - @sdods/core@0.7.3
  - @sdods/contracts@0.7.3
  - @sdods/db@0.7.3
  - @sdods/mcp@0.7.3

## 0.7.2

### Patch Changes

- Updated dependencies [0865fee]
  - @sdods/mcp@0.7.2
  - @sdods/contracts@0.7.2
  - @sdods/core@0.7.2
  - @sdods/db@0.7.2

## 0.7.1

### Patch Changes

- Updated dependencies [805752a]
  - @sdods/contracts@0.7.1
  - @sdods/core@0.7.1
  - @sdods/db@0.7.1
  - @sdods/mcp@0.7.1

## 0.7.0

### Patch Changes

- 5b69426: SDODS for AI coding tools.
  
  - `sdods skills list` and `sdods skills install [--agent claude,agents,cursor,copilot,gemini] [--global]` copy the bundled Agent Skills (`sdods`, `sdods-run`, `sdods-record`, `sdods-start-ui`) to where Claude Code, Codex, Cursor, Copilot and Gemini CLI read them; `npx -y @sdods/cli skills install` needs no global install. `sdods init` installs the same set into `.claude/skills` and `.agents/skills`, and no longer copies SDODS's own release skills.
  - `sdods mcp install gemini` writes `.gemini/settings.json`.
  - Every stdio snippet now launches `npx -y @sdods/cli mcp`. `npx sdods mcp` pointed at a package that does not exist, so clients configured from `mcp install --file`, `agent install`, the web UI or `/api/mcp/info` failed with CONNECTION_CLOSED outside a checkout.
  - `sdods mcp install claude|codex --http-url` passes the bearer token (`${SDODS_TOKEN}` / `--bearer-token-env-var SDODS_TOKEN`); before, both registered a server that answered 401.
  - `sdods mcp install windsurf` writes Windsurf's real config, `~/.codeium/windsurf/mcp_config.json`, with `serverUrl` for remote servers.
- Updated dependencies [5b69426]
  - @sdods/mcp@0.7.0
  - @sdods/contracts@0.7.0
  - @sdods/core@0.7.0
  - @sdods/db@0.7.0

## 0.6.0

### Patch Changes

- Updated dependencies [097aead]
  - @sdods/db@0.6.0
  - @sdods/core@0.6.0
  - @sdods/contracts@0.6.0
  - @sdods/mcp@0.6.0

## 0.5.2

### Patch Changes

- Updated dependencies [45a38a8]
  - @sdods/core@0.5.2
  - @sdods/contracts@0.5.2
  - @sdods/db@0.5.2
  - @sdods/mcp@0.5.2

## 0.5.1

### Patch Changes

- Updated dependencies [bd833e1]
- Updated dependencies [0dcaef8]
- Updated dependencies [0940ec6]
  - @sdods/core@0.5.1
  - @sdods/contracts@0.5.1
  - @sdods/db@0.5.1
  - @sdods/mcp@0.5.1

## 0.5.0

### Patch Changes

- Updated dependencies [a6d6c99]
- Updated dependencies [a6d6c99]
- Updated dependencies [33416fd]
- Updated dependencies [f179b8e]
- Updated dependencies [3f2b734]
  - @sdods/core@0.5.0
  - @sdods/contracts@0.5.0
  - @sdods/db@0.5.0
  - @sdods/mcp@0.5.0

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
  - @sdods/contracts@0.4.0
  - @sdods/mcp@0.4.0

## 0.3.2

### Patch Changes

- Updated dependencies [8370778]
  - @sdods/core@0.3.2
  - @sdods/contracts@0.3.2
  - @sdods/db@0.3.2
  - @sdods/mcp@0.3.2

## 0.3.1

### Patch Changes

- Updated dependencies [77c4a03]
  - @sdods/core@0.3.1
  - @sdods/contracts@0.3.1
  - @sdods/db@0.3.1
  - @sdods/mcp@0.3.1

## 0.3.0

### Patch Changes

- Updated dependencies [949b455]
- Updated dependencies [564cd0e]
- Updated dependencies [560e20d]
- Updated dependencies [01b5c6e]
- Updated dependencies [36cc9d2]
  - @sdods/core@0.3.0
  - @sdods/contracts@0.3.0
  - @sdods/db@0.3.0
  - @sdods/mcp@0.3.0
