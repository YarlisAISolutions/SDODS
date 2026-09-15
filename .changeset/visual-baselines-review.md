---
'@sdods/contracts': minor
'@sdods/core': minor
'@sdods/cli': minor
'@sdods/server': minor
---

Visual baselines you review before they change, per-baseline masks, and Linux baselines from CI.

- `screenshots.maxDiffPixelRatio` (default `0.01`, previously hard-coded) and `screenshots.baselines.<name>` with its own `mask` (added to `screenshots.mask`) and `maxDiffPixelRatio`, in the project or an environment.
- New step `the page should match the visual baseline {string} masking {string}` with comma-separated selectors.
- A failed visual check keeps its expected, actual and diff images and a `<name>.failure.json` record under the scenario's `visual/<run target>/` directory, so they survive the CI artifact upload.
- `sdods baselines diff [--run <id>]` lists failed visual checks; `sdods baselines accept <name…> --run <id>` (or `--all`) copies the actual screenshot to `features/__screenshots__/<run target>/<platform>/` for the platform the run happened on. `sdods run --update-snapshots` still works and now warns that it overwrites without review.
- Server: `GET /api/runs/:id/baselines` and `POST /api/runs/:id/baselines/accept` (`features:write`, editor role); the web UI shows **Accept as baseline** with the diff on a failed visual step.
