---
'@sdods/core': minor
'@sdods/cli': minor
---

Five new step libraries, and a publish path that cannot ship a stale build.

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
