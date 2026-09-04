# Coordination requests from the analysis phase (Phase 12)

For the core-runtime owner of `packages/core/src/{fixtures,steps,lint,config/playwright.ts}` and `packages/cli/src/commands/run.ts`:

1. **`@skip:<browser>` tag**
   - `automax lint`: validate the value against `chromium|firefox|webkit|mobile-chrome|mobile-safari` (error on unknown).
   - Runtime: a `BeforeScenario` hook (all layers) that reads `$tags`, and when any `@skip:<browser>` equals the worker's `automax.browser`, calls `$test.skip(true, 'skipped on <browser> by tag')`. Never branch inside steps.
2. **`automax run --project-matrix`**: run every browser listed in the project yaml (`browsers:`) for the selected layers, i.e. select all generated `<slug>--<layer>--<browser>` projects; combine with `-t` and `-l`. `automax run --browser` must reject names not in the yaml with a hint.
3. **`automax browsers`** lives in `packages/cli/src/commands/browsers.ts` (this phase); `doctor --fix` can call `installBrowsers()` exported from it.
4. Coverage (`automax coverage`) recognises route references from the shared UI step `I navigate to the {string} page`, page-object decorators whose body calls `goto('<route>')`, and plain phrasing `I am on the <route> page` / `I should be on the <route> page`; keep those phrasings when adding steps.
