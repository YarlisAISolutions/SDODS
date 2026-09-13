---
'@sdods/core': patch
---

Applying a cached session no longer navigates the page (#99).

- `I use a leased user with role "…"` restored localStorage by `page.goto(origin)`. An app that sends a signed-in visitor away from `/` on the client then had a redirect chain still running when the step returned, and the scenario's first `page.goto` failed with `net::ERR_ABORTED` / "interrupted by another navigation". Cookies are still added to the context; localStorage is now planted by a context init script that runs before the app's own scripts, only on the matching origin (or written straight into the page when it is already on that origin). The page is left where it was.
- The localStorage is planted once per context: the init script is removed after the first document of that origin loads, so an app that signs out mid-scenario is not silently signed back in on the next navigation.
