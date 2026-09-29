---
'@sdods/cli': patch
---

Fix `sdods` failing to start on Windows with `ERR_UNSUPPORTED_ESM_URL_SCHEME`: the bin shim now imports its entry point as a `file://` URL. This also unblocks the desktop app's first-run install on Windows.
