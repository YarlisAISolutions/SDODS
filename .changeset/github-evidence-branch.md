---
'@sdods/contracts': minor
'@sdods/integrations': minor
'@sdods/cli': minor
---

GitHub issues can embed evidence that renders inline in private repositories (#82). With `integrations.github.evidence.host: branch` (off by default), screenshots, `video.webm` and a GIF preview (when ffmpeg is on PATH) go to an orphan `sdods-evidence` branch through the git data API, in one fast-forward commit per run that is retried when another job moved the branch first, and are embedded as `blob/<branch>/<path>?raw=true`. The evidence can go to a separate repository with its own token (`evidence.repo`, `evidence.tokenEnv`). Per-file and per-run size caps apply (`maxFileBytes` 5 MB, `maxRunBytes` 25 MB), and files over them are listed in the issue. `sdods integrations test` checks that the token can push to the evidence repository, and `sdods integrations evidence prune [--older-than 14d]` rewrites the branch without old runs. Traces are never uploaded.
