# @sdods/integrations

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
