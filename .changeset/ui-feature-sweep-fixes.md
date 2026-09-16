---
'@sdods/server': patch
---

Fixes found by using every web UI feature against a real server.

- Workspaces created in the web UI (or with `POST /api/workspaces`) are written to `sdods.workspace.yaml` before the database, so projects can be created in and imported into them. Creating a workspace that is already declared returns 409.
- Project Settings saves again: `PUT /api/projects/:slug` accepts `{ patch }`, the top-level keys that changed, applied to the yaml in place so comments and keys the form does not show are kept. The form now sends only what changed.
- Dataset upload: the preview uses `POST .../datasets` with `preview=1` (the page called a route that does not exist), and the name, environment and storage fields are sent before the file so the server reads them. A file dataset is registered under `data.sources`, so it is listed and usable as `@data:<name>`.
- Creating a user with the email field left empty no longer fails with "Invalid email address".
- The web app's mock dev server (`bun run web:dev`) starts again: browser code imports `@sdods/contracts/schemas` instead of the root export, which pulled in `node:crypto`.
- Docs: account menu, Settings → Profile and Password & sessions, the account REST routes, and refreshed web UI screenshots.
