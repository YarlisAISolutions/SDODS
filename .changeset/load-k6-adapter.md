---
'@sdods/cli': minor
'@sdods/core': minor
'@sdods/contracts': minor
---

`sdods load -p <project> -e <env> <profile>` runs API load tests through k6. A profile in `projects/<slug>/load/<profile>.yaml` lists requests (method, path relative to `api.baseUrl`, headers, body, expected status and body checks) with k6 `stages` or `vus`/`duration` and `thresholds`. SDODS generates a k6 script whose credentials come from the environment's `api.auth` as `__ENV` lookups, never inlined, prints the target URL and peak virtual users, runs `k6 run --summary-export` (or the `grafana/k6` image with `--runner docker`) and exits `1` when thresholds fail. Load is opt-in: an environment must set `load.allowed: true`, `load.maxVus` caps the peak, and write methods need `load.allowWrites: true`. `--dry-run` writes the script without k6. Results land in `.sdods/runs/<id>/load/<profile>/`.
