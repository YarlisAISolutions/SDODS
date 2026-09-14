---
description: Map application or API changes to the SDODS scenarios they affect and propose updates.
argument-hint: '[git range, PR or changed paths] [project]'
disable-model-invocation: true
---

Use the `sdods-upgrader` subagent to update tests for: $ARGUMENTS

Default to the diff of the current branch against the default branch. When it returns, list the
affected scenarios, the proposed additions and edits, and anything it could not map.
