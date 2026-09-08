---
'@sdods/core': minor
---

Five step libraries for the surfaces Gherkin could not reach.

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
