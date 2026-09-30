---
'@sdods/cli': minor
'@sdods/server': minor
'@sdods/db': minor
---

Runs no longer fail with Playwright's "Executable doesn't exist … run npx playwright install" when a test browser is missing or half-downloaded. `sdods run` checks, before generating specs, that every browser its targets launch (chromium for `@api` targets too) finished downloading for the exact revision the workspace's Playwright uses. With `--install-browsers` or `SDODS_AUTO_INSTALL_BROWSERS=1` (set by the desktop app) it downloads what is missing into the cache the runner reads; otherwise it stops with the `sdods browsers install` command. `sdods browsers list` and `sdods doctor` use the same check.

Stopping a run from the UI or API now ends the whole process tree (the CLI, Playwright, its workers and browsers) on Windows, macOS and Linux, and requires the editor role, like starting one. New `POST /api/runs/:id/rerun` (`{ scope: 'all' | 'failed', scenarios? }`) replays a run's full selection, only its failed scenarios, or named ones; runs now store the selection they were started with (`runs.params_json`). New `GET`/`PUT /api/me/preferences/:key` store per-user UI preferences (`user_preferences` table), used to remember the last run selection per workspace and project.
