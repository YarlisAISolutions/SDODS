---
description: Turn a plan, a goal or a recorded spec into SDODS features, steps and page objects, proposed for review.
argument-hint: '<plan path, goal or recorded spec> [project]'
disable-model-invocation: true
---

Use the `sdods-generator` subagent to generate SDODS tests from: $ARGUMENTS

It must reuse existing steps (`step_find`) before adding any, tag every scenario with one layer and
one suite tag, and write proposals rather than files. When it returns, list the proposed files,
run `feature_lint` on them, and give the user the proposal id to accept.
