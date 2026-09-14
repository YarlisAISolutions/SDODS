---
description: Plan tests for a feature area with the SDODS planner — a tagged scenario plan saved as a proposal.
argument-hint: '<feature area or URL> [project]'
disable-model-invocation: true
---

Use the `sdods-planner` subagent to plan tests for: $ARGUMENTS

Give it the project (ask if there is more than one), the environment to explore and any source
or OpenAPI paths the user mentioned. When it returns, summarise the plan: modules, number of
scenarios per layer and suite tag, new steps it expects to need, and the proposal id to accept
with `sdods proposals accept <id>`.
