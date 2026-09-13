# @sdods/contracts

## 0.5.0

### Minor Changes

- f179b8e: Trace, video, parallelism and a setup tier are now configurable instead of hard-coded in the runner config.
  
  - `evidence: { trace, video, screenshot }` in `sdods.project.yaml`, overridable per key in `envs/<env>.yaml`, with `sdods run --trace <mode>` / `--video <mode>` and `SDODS_TRACE` / `SDODS_VIDEO` on top. Values are Playwright's modes and are validated. Defaults are unchanged (`on-first-retry`, `retain-on-failure`, `off`); with `retries.local: 0` the old default meant no trace locally, so `--trace on` is now the way to get one without forcing a retry.
  - `fullyParallel` (default `true`) per project and per process. `false` keeps the scenarios of a feature file in order.
  - `setup: { tags: '@setup' }` per project, or per process (`setup: false` to turn it off): each run target gets a `<target>--setup` companion that runs the matching scenarios first, in the same browser, and the target depends on it, so the rest of the run does not start when a probe or login fails. Setup scenarios ignore `--tags` and run once.
  - `parseRunnerProjectName` reads the new `<project>--<layer>[--<browser>]--setup` names as their real layer and browser with `phase: 'setup'`.
  - A config value that is invalid only after `${VAR}`, `SDODS_*` or CLI overrides now fails with a configuration error naming the path instead of a raw validation error.

## 0.4.0

## 0.3.2

## 0.3.1

### Patch Changes

- 77c4a03: `steps.core.exclude` — the migration path 0.3.0 should have shipped with.
  
  0.3.0 added ten step libraries at once. They share ONE step namespace with a
  project's own steps, and playwright-bdd fails generation outright when two
  definitions match the same text, so the upgrade broke every consumer that had
  already written those phrasings — before a single scenario ran, with
  `Multiple definitions matched scenario step`. The first repo to upgrade hit 67
  collisions, which is not a coincidence: the core libraries were modelled on the
  gaps that project documented.
  
  The only remedy was to rewrite all 67 in one commit, unverified, because the
  suite could not run until every one was gone.
  
      steps:
        core:
          exclude: [a11y, browser, dom, net, perf]
  
  excludes by file basename. With nothing excluded the pattern is byte-identical
  to what shipped before, so projects that never set it are unaffected. An unknown
  name throws `CONFIG_INVALID` listing what is available — a typo that silently
  excluded nothing would leave the author believing the collision was handled
  while generation still failed, pointing at the step rather than at the typo.

## 0.3.0
