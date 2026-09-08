---
'@sdods/core': minor
'@sdods/cli': minor
---

Four tags the runner validated and then ignored now actually do something.

`@env:`, `@skip:<browser>` and `@flag:` were checked at lint time and had no
runtime path at all — the linter confirmed the tag was spelled correctly and the
runner ignored it, so a project could carry hundreds of `@env:` tags and still
point every one of them at production. `@quarantine` was not a tag this
framework knew about, so every recipe excluded it by hand in a tag expression
that drifts and that nobody can audit centrally.

`scenarioSkipReason()` is a pure function in `config/tags.ts`, applied by a new
automatic fixture declared first in test scope — so a scenario is excluded
before an account is leased, a browser context is built, or a session is minted.
The reason is recorded as an annotation as well as a skip, because a report that
says "skipped" without saying why is how parked scenarios go unnoticed.

`@flag:` gates only when the environment declares a flag list. An absent list
means "not known", and a gate that fails closed on missing metadata would
silently skip an entire suite.

`sdods run --since <range>` selects only the features a git range could have
broken, using the `analyzeChangeImpact` mapping that already existed and was
reachable only through MCP. When nothing is impacted it says so and runs
nothing, rather than running everything or exiting green on an empty run.
