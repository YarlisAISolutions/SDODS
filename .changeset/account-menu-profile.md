---
'@sdods/db': minor
'@sdods/server': minor
'@sdods/cli': patch
---

Account menu, profile and sessions in the web UI.

- The sidebar footer is now an account menu: profile, password and sessions, preferences, API tokens, MCP clients, admin pages, theme (system, light, dark), feedback and sign out.
- Settings gains Profile (display name, email, role, memberships), Password & sessions (change password with the current one, list and sign out other sessions) and Preferences (theme, default organization, workspace and project).
- `@sdods/db`: migration `0009_user_profile` adds `users.display_name`; `listSessionsForUser`, `deleteSessionById`, and `deleteSessionsForUser(userId, { exceptToken })`.
- `@sdods/server`: `PATCH /api/me`, `POST /api/me/password`, `GET /api/me/sessions`, `DELETE /api/me/sessions/:id`, `POST /api/me/sessions/revoke-others` (browser sessions only, never API tokens). `/api/auth/me` returns email, display name, last login, creation date and the current session id. `PATCH /api/users/:id` accepts `displayName`.
- Web pages that called routes the server does not have now use the real ones: Recorder (job events, recorded spec via `GET /api/projects/:slug/recorded/:file`, convert with `kind: convert`), Environments (create and edit through `PUT .../envs/:name`, which now edits the file in place instead of rewriting it), Schedules (save, pause/resume, history), Integrations (`PUT .../integrations` validates before writing and merges MCP servers by name) and the Agents live log.
- `sdods users set-role` rejects an unknown role instead of reporting success without changing anything.
