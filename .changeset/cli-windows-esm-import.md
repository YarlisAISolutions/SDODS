---
'@sdods/cli': patch
---

Fix `sdods` failing to start on Windows with `ERR_UNSUPPORTED_ESM_URL_SCHEME`: the bin shim now imports its entry point as a `file://` URL. This also unblocks the desktop app's first-run install on Windows.

`sdods init` now adds `@axe-core/playwright` to the workspace, so the demo project's `@a11y` scenario passes on a fresh install instead of failing with "Accessibility audits need @axe-core/playwright".
