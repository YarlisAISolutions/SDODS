# @sdods/server

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
