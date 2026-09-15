# @sdods/integrations

## 0.10.0

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

### Minor Changes

- f950986: GitHub issues can embed evidence that renders inline in private repositories (#82). With `integrations.github.evidence.host: branch` (off by default), screenshots, `video.webm` and a GIF preview (when ffmpeg is on PATH) go to an orphan `sdods-evidence` branch through the git data API, in one fast-forward commit per run that is retried when another job moved the branch first, and are embedded as `blob/<branch>/<path>?raw=true`. The evidence can go to a separate repository with its own token (`evidence.repo`, `evidence.tokenEnv`). Per-file and per-run size caps apply (`maxFileBytes` 5 MB, `maxRunBytes` 25 MB), and files over them are listed in the issue. `sdods integrations test` checks that the token can push to the evidence repository, and `sdods integrations evidence prune [--older-than 14d]` rewrites the branch without old runs. Traces are never uploaded.

### Patch Changes

- 8611552: GitHub evidence host: `evidence prune` can no longer erase a real branch. Uploads, prune and `sdods integrations test` refuse the repository's default branch; prune also refuses a branch SDODS did not create (its root README must be the `# SDODS evidence` one the orphan commit writes); and `integrations.github.evidence.branch` rejects `main`, `master`, `develop`, `development`, `trunk` and `gh-pages`. Before, `evidence.branch: main` committed evidence onto main and prune then force-updated main to an orphan commit.
- 8611552: GitHub evidence host: an empty evidence repository is reported as "is empty: create it with a README" by `sdods integrations test`, uploads and prune. GitHub answers 409, not 404, when reading a branch of a repository without a commit, and that raw 409 was surfaced instead.
- 8611552: `sdods integrations evidence prune --older-than` accepts `min`, `h`, `d` and `w` (a bare number is days) and refuses `m`, which read as minutes: `--older-than 3m` meant as three months pruned almost every run. The error suggests `min` or `d`.
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

### Patch Changes

- @sdods/contracts@0.6.0

## 0.5.2

### Patch Changes

- 45a38a8: Stop publishing Playwright traces, and redact the ones a run keeps (#101).
  
  A `trace.zip` records every request's `Cookie`/`Authorization` headers, `Set-Cookie` responses, the context's `storageState` (cookies, localStorage, IndexedDB — where Firebase keeps its refresh token) and typed values, so for projects with pool accounts it carries live sessions.
  
  - **Integrations never upload, attach or link a trace.** GitHub issues no longer link `trace.zip` through `SDODS_PUBLIC_URL` or the CI artifacts page, and `uploadToRelease` no longer uploads it; Jira no longer attaches it. Both name the trace's local path under a warning that it contains credentials, with the `npx playwright show-trace` command. The video is still linked or uploaded (it shows the screen, not headers or storage).
  - **`sdods run` redacts every trace after the run**, before ingest and integrations: `runner-output/**/trace.zip`, the HTML report's copies under `html-report/data/`, zips nested in blob shard reports, and the BASE64 trace bodies embedded in `messages.ndjson` (which ingest turns back into `trace.zip`). Credential headers (`Cookie`, `Set-Cookie`, `Authorization`, `Proxy-Authorization`, `X-Api-Key` and similar), cookie values, localStorage/sessionStorage/IndexedDB values, `httpCredentials` passwords, password inputs in DOM snapshots and values typed into password/secret/token fields become `[redacted]`. Other entries are copied through unchanged and the trace viewer opens the result. Request/response bodies and page text are not redacted.
  - New `evidence.redactTraces` (default `true`; env files may override it). `evidence.trace` and `sdods run --trace <mode>` already control whether traces are recorded at all.
  - Docs warn that traces are credential-bearing (GitHub and Jira guide, `sdods trace`, `project.yaml` reference).
- Updated dependencies [45a38a8]
  - @sdods/contracts@0.5.2

## 0.5.1

### Patch Changes

- Updated dependencies [bd833e1]
  - @sdods/contracts@0.5.1

## 0.5.0

### Minor Changes

- 912569e: Enabled integrations now act on `sdods run`, and GitHub issues from failures carry video and trace, survive a fresh CI runner and have their labels checked.
  
  - `sdods run` publishes the finished run to every enabled integration (check runs, PR comment, issues per `createIssueOnFailure`) through the same code path as `sdods integrations notify`. `integrations.github.createIssueOnFailure` used to do nothing unless a separate notify step existed. `--no-notify` opts out; cancelled runs, runs with no scenario results and sharded runs do not notify. A notify failure is printed as a warning and never changes the exit code, and `--json` output reports the outcome under `notify`.
  - GitHub issue bodies link the failing attempt's `video.webm` and `trace.zip` from `runner-output/`, read from `runner-results.json`, with the `npx playwright show-trace` command. `uploadToRelease` uploads them with their real content type instead of `image/png`.
  - Before creating an issue, the GitHub provider searches the repository for an open issue carrying `sdods-fingerprint:<fingerprint>` and comments on it, so a runner without `.sdods/issue-links.json` no longer opens a duplicate. Notifying the same run twice no longer comments twice.
  - `sdods integrations test` fails when a configured GitHub label does not exist in the repository and names the missing labels; `--create-labels` creates them.

### Patch Changes

- Updated dependencies [f179b8e]
  - @sdods/contracts@0.5.0

## 0.4.0

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
