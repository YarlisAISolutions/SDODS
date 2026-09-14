# @sdods/db

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
