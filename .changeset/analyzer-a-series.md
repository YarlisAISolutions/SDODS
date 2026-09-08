---
'@sdods/core': patch
'@sdods/cli': patch
---

Seven analyzer and auth-strategy defects, each of which stated something false with confidence.

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
