---
'@sdods/core': patch
---

The tag gate now really does decide before a pool account is leased.

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
