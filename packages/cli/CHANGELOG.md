# @sdods/cli

## 0.3.1

### Patch Changes

- Updated dependencies [77c4a03]
  - @sdods/core@0.3.1
  - @sdods/contracts@0.3.1
  - @sdods/server@0.3.1
  - @sdods/agents@0.3.1
  - @sdods/db@0.3.1
  - @sdods/integrations@0.3.1
  - @sdods/mcp@0.3.1

## 0.3.0

### Minor Changes

- 560e20d: Four tags the runner validated and then ignored now actually do something.
  
  `@env:`, `@skip:<browser>` and `@flag:` were checked at lint time and had no
  runtime path at all — the linter confirmed the tag was spelled correctly and the
  runner ignored it, so a project could carry hundreds of `@env:` tags and still
  point every one of them at production. `@quarantine` was not a tag this
  framework knew about, so every recipe excluded it by hand in a tag expression
  that drifts and that nobody can audit centrally.
  
  `scenarioSkipReason()` is a pure function in `config/tags.ts`, applied by a new
  automatic fixture declared first in test scope — so a scenario is excluded
  before an account is leased, a browser context is built, or a session is minted.
  The reason is recorded as an annotation as well as a skip, because a report that
  says "skipped" without saying why is how parked scenarios go unnoticed.
  
  `@flag:` gates only when the environment declares a flag list. An absent list
  means "not known", and a gate that fails closed on missing metadata would
  silently skip an entire suite.
  
  `sdods run --since <range>` selects only the features a git range could have
  broken, using the `analyzeChangeImpact` mapping that already existed and was
  reachable only through MCP. When nothing is impacted it says so and runs
  nothing, rather than running everything or exiting green on an empty run.
- 01b5c6e: Five new step libraries, and a publish path that cannot ship a stale build.
  
  `a11y.steps.ts` runs a real axe-core audit through `@axe-core/playwright` and adds
  the structural checks a rule engine cannot make — heading outline, alt text,
  per-rule isolation. `gates.a11y` and the `@a11y` tag stop being schema-only.
  
  `perf.steps.ts` wires the previously inert `PerfBudgetsSchema`: `pageLoadMs`,
  `lcpMs`, `fcpMs`, `ttfbMs` from real web-vitals, and `apiP95Ms` from sampled
  request latency.
  
  `net.steps.ts` adds download capture (filename, content type, CSV rows, JSON path)
  and SSE/streaming assertions. `dom.steps.ts` adds focus trapping, dialog and
  popover state, and keyboard navigation. `browser.steps.ts` adds cookies, storage,
  viewport and colour-scheme control, and console-error capture.
  
  Every step that quantifies over a set fails when the set is empty. "Every image
  has an alt" over a page with no images is silence, not a pass, and silence is what
  makes an accessibility suite worthless.
  
  `scripts/publish-npm.sh` now builds clean instead of relying on incremental
  `tsc -b`, and refuses to publish a package whose staged `dist/` is older than its
  `src/`. `@sdods/core@0.2.2` shipped `apiContext.auth = undefined` while its source
  said `auth = null`; because the publish loop skips versions already on the
  registry, that tarball can never be corrected at that version.

### Patch Changes

- 949b455: Seven analyzer and auth-strategy defects, each of which stated something false with confidence.
  
  `detectPackageManager` now walks up to the workspace root, so scanning a member
  directory of a monorepo no longer reports `unknown` / `monorepo: false`.
  
  Base URLs are ranked by how specifically the variable NAME claims to be the base
  URL, instead of first-wins by file order — `SIM_AGENT_API_URL` no longer beats
  `NEXT_PUBLIC_API_URL` from 39 lines above it.
  
  An express dependency no longer forces `api = ui`: the `.listen()` port is only
  trusted when it names a different origin, so a full-stack app falls through to
  `ui + '/api'` as intended.
  
  Gitignored `.env*` files are skipped rather than read and republished into the
  report. `.env.example` no longer outranks a real environment for base URLs.
  
  `detectAuth` breaks ties by an explicit precedence and reports the ambiguity —
  with an epsilon, because these scores are sums of decimal weights and an exact
  `===` would call a 2e-16 difference a clear winner.
  
  `sdods analyze` gains `--max-files` / `--max-depth`, and the default file budget
  rises from 8,000 to 25,000: a single real app was 6,400 files, so the walk
  truncated before reaching `.github/` and then reported "no CI" as a fact.
  
  The `sso` and `token` auth strategies throw with a hint instead of silently
  returning no browser session.
- Updated dependencies [949b455]
- Updated dependencies [564cd0e]
- Updated dependencies [560e20d]
- Updated dependencies [01b5c6e]
- Updated dependencies [36cc9d2]
  - @sdods/core@0.3.0
  - @sdods/server@0.3.0
  - @sdods/agents@0.3.0
  - @sdods/contracts@0.3.0
  - @sdods/db@0.3.0
  - @sdods/integrations@0.3.0
  - @sdods/mcp@0.3.0
