---
description: Review SDODS feature files for tagging, step reuse, data-driven refactors and best practices.
argument-hint: '[feature path, module or project]'
disable-model-invocation: true
---

Use the `sdods-reviewer` subagent to review: $ARGUMENTS

Default to the features changed on the current branch (`git diff --name-only` against the default
branch, filtered to `*.feature`) when nothing was named. Present findings grouped by severity, each
with the file, the rule it breaks and the suggested change.
