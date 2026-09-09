---
'@sdods/core': patch
---

`sdods auth capture` no longer skips the token when the login state is fresh.

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
