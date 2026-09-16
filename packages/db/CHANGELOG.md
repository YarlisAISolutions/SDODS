# @sdods/db

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

## 0.9.0

### Patch Changes

- Updated dependencies [47ac9e2]
- Updated dependencies [dd24cdb]
- Updated dependencies [3fb1773]
  - @sdods/contracts@0.9.0

## 0.8.0

### Patch Changes

- 8611552: Run ingest no longer stores a skipped scenario as passed. A passing before or after hook counted as a pass, so a scenario whose Gherkin steps were all skipped (`@skip:<browser>`) was recorded as passed in the results database. Hooks now only fail a scenario; passed and skipped come from its Gherkin steps, as in the traceability reader.
- 8611552: A scenario that called `test.skip()` part-way is recorded as skipped, not passed, by run ingest and by `sdods report traceability`. playwright-bdd reports the steps before the skip as PASSED and the rest as SKIPPED, and both readers counted any passed step as a pass; the worst step result now wins, as in Cucumber.
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

- @sdods/contracts@0.7.2

## 0.7.1

### Patch Changes

- Updated dependencies [805752a]
  - @sdods/contracts@0.7.1

## 0.7.0

### Patch Changes

- @sdods/contracts@0.7.0

## 0.6.0

### Minor Changes

- 097aead: `sdods users reset --yes` removes every user with their sessions, API tokens and memberships, so the next `sdods serve` offers the one-time `/setup` link again; projects, runs and schedules are kept. `sdods users set-password <username> --password <pw> [--activate]` sets a password from the terminal, signs the user out everywhere and can re-enable a deactivated account, so a locked-out sole admin no longer has to wipe the database. Both are audited. The docs gain a "Reinstall or reset" section for installed, clone, Docker and desktop setups.

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

### Minor Changes

- 4abc389: Projects can now be created, imported and deleted from the dashboard.
  
  - `sdods project delete <slug> --yes` moves a project to `.sdods/trash/<slug>-<timestamp>` so it can be restored by hand (`--purge` removes it outright). `DELETE /api/projects/:slug?confirm=<slug>` does the same from the web UI, after taking the project's schedules down — the scheduler arms every row it finds without checking that the project still exists, so schedules left behind would keep firing runs against a directory that is gone. The DB row is kept and flagged `archived`, because runs, results and insights all reference it.
  - `sdods project import <source>` registers an existing project from a directory, a `.zip` or a git URL, re-homing its `slug`/`organization`/`workspace` and leaving `.auth/` and `.env*` behind. `--dry-run` reports what it found without writing. `POST /api/projects/import` exposes it, with path and git sources limited to admins since they are read with the server's own credentials.
  - `sdods project create` takes `--description`, and `POST /api/projects` accepts it. That body is now strict: it silently dropped every field it did not name, so a project created from the web form lost its description, tags, routes, modules, processes and environments.
  - Creating a project now validates the target workspace against `sdods.workspace.yaml` as well as the database. A workspace that exists only in the database made `ProjectRegistry.discover` throw for *every* project on the next reload.
  - `VERSION` is read from the package manifest instead of a hand-maintained constant. It had drifted to 0.2.2 while the packages were at 0.3.2, and `sdods init` writes `^${VERSION}` into every scaffolded workspace — where a caret does not cross a 0.x minor, pinning those workspaces to a CLI far behind the server talking to it.
  - `GET /api/health` reports the capabilities of the CLI the server spawns, so the dashboard can explain that an action needs `sdods upgrade --apply` instead of surfacing `unknown command`.

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
