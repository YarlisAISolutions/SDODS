# @sdods/core

## 0.3.2

### Patch Changes

- 8370778: The tag gate now really does decide before a pool account is leased.
  
  0.3.0 claimed it did, on the strength of `$sdodsTagGate` being declared first in
  test scope. Declaration order is not an ordering guarantee: Playwright
  instantiates fixtures in DEPENDENCY order, and `user` is pulled in by
  `storageState`, which the browser context needs. So the lease ran first.
  
  An `@env:local @user:noconsent` scenario run against staging therefore failed
  with `No users with role "noconsent" in dataset "users"` instead of skipping.
  Sixteen of seventy-two `@env:local` scenarios failed that way in one run,
  including two whose whole purpose is to fire a deliberate burst at a rate
  limiter — exactly the scenarios the tag exists to keep off a shared environment.
  
  `user` now depends on `$sdodsTagGate`, which is the only ordering guarantee
  Playwright offers. Same run afterwards: 72 skipped, 0 failed.
- @sdods/contracts@0.3.2
  - @sdods/db@0.3.2

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
- Updated dependencies [77c4a03]
  - @sdods/contracts@0.3.1
  - @sdods/db@0.3.1

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
- 36cc9d2: Five step libraries for the surfaces Gherkin could not reach.
  
  `iframe.steps.ts` — a frame is entered, acted in, and left. Threading an
  optional frame through every UI step would touch every signature for a surface
  most scenarios never see, so the scope is per-page state instead. Unblocks
  hosted checkout, which is the commonest untestable surface there is.
  
  `tabs.steps.ts` — the action that opens a tab and the wait for it are ONE step.
  `waitForEvent('page')` after the click is a race that loses a fast popup.
  Switching is explicit, because a library that silently re-points `page` makes
  every later assertion ambiguous about which document it read.
  
  `db.steps.ts` — read-only assertions over the existing Kysely fixture, which
  had no step reading it. There is deliberately no INSERT: seeding through the
  database is how a suite comes to assert against states the product cannot
  produce. Table and column names are validated against a strict identifier
  pattern, because an identifier is interpolated rather than parameterised.
  
  `clock.steps.ts` — installing the clock is separate from moving it, and must
  come first. A 55-minute session TTL is not a thing a suite can wait through, so
  without this those scenarios are not slow, they are unwritable.
  
  `webhook.steps.ts` — an ephemeral loopback receiver whose URL is published as
  `{{callback.url}}`, torn down after every scenario including a failing one.
  Deliveries are asserted by polling, never by sleeping.

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
- 564cd0e: `sdods auth capture` no longer skips the token when the login state is fresh.
  
  The login state and the API token are two artefacts with two lifetimes, and the
  freshness check covered only the first — but it `continue`d past the whole user,
  so a role could hold a fresh browser session and no token file at all. The API
  layer reads that file (`steps/data.steps.ts`), so every `@user:<role>` scenario
  fell through to a live `token()` mint: one identity-provider sign-in per
  scenario. In mybotbox-qa#57 that produced 1,010 `QUOTA_EXCEEDED` records in a
  single run, which is 67% of that suite's API-layer failures.
  
  The freshness check now gates the login only. The token is minted when there is
  no token file yet, or when `--force` asks for a fresh one — so repeated captures
  no longer leak a new API key into the application under test on every call, which
  the previous unconditional mint did.
- @sdods/contracts@0.3.0
  - @sdods/db@0.3.0
