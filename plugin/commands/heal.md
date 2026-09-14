---
description: Diagnose a failing SDODS scenario and propose the smallest locator or step fix. Defaults to the last failed run.
argument-hint: '[scenario name or fingerprint] [project]'
disable-model-invocation: true
---

Use the `sdods-healer` subagent to fix: $ARGUMENTS

If no scenario was named, find the most recent failure with `run_last_failed` and pass that
scenario, its error, screenshot and trace paths to the healer. When it returns, explain the root
cause in one or two sentences, show the proposed change, and say how to verify it (the exact
`sdods run` command for just that scenario).
