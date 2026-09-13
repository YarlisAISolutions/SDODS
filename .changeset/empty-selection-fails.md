---
'@sdods/cli': minor
'@sdods/core': patch
---

A run that executes no scenarios now fails instead of passing.

- `sdods run` exits `2` when the selection matches nothing, and says so. Zero scenarios with exit `0` looked exactly like a green run, so a mistyped `--tags` or `--feature` kept CI passing while testing nothing. One shard of several may still come back empty, and `--allow-empty` restores the old behaviour for a run that is expected to select nothing.
- A malformed tag expression (`--tags "@smoke and ("`) is a configuration error (exit `2`) naming the expression, raised before specs are generated; it used to crash bddgen with a stack trace and a hint about undefined steps.
- `--feature` must name a feature file in the project. It accepts a path relative to `features/`, to the project, to the repository, or an absolute one; a path that does not exist is refused instead of selecting nothing.
- `sdods features list --tags` evaluates full tag expressions, the same way `sdods run` does. It compared the whole expression to each tag, so `@ui and @smoke` listed nothing.
