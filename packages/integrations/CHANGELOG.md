# @sdods/integrations

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
