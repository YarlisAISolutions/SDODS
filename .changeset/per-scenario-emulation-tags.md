---
'@sdods/core': minor
'@sdods/cli': patch
'@sdods/mcp': patch
---

Per-scenario browser emulation: `@locale:<bcp47>`, `@timezone:<IANA>`, `@theme:<light|dark|no-preference>`, `@viewport:<W>x<H>` and `@device:<name>` set the browser context before it opens, over the environment's `use:` block, on a Scenario, a Feature, a Rule or one `Examples:` block. `sdods lint` validates the values. New steps: `I use the locale {string}`, `I use the timezone {string}`, `I use the {string} color scheme`, `I use the viewport {int} by {int}`, `I use the device {string}`, `the page should reflow without horizontal scrolling`, `the page should have no untranslated keys` and `the page should have no untranslated keys matching {string}`.

Fix: `mobile-chrome` and `mobile-safari` run targets ran in a 1280x720 window instead of the device's viewport, because the generated project set `viewport: undefined`, which Playwright reads as "use the default".

The agent rule lines (`CONVENTIONS` in `@sdods/mcp`, the `sdods` skill in `@sdods/cli`) list the new tags.
