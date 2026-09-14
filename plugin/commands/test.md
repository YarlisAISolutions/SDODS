---
description: Run an SDODS test slice (project, environment, layer, browser, tags) and summarise what passed, failed and was healed.
argument-hint: '<project> [env] [tags e.g. @smoke] [layer ui|api|hybrid]'
disable-model-invocation: true
---

Run SDODS tests for: $ARGUMENTS

Follow the `run` skill from this plugin.

1. Resolve the project and environment. If either is missing, list them (`project_list`,
   `project_list_envs`) and pick the only one or ask.
2. Validate first: `feature_lint` (or `sdods lint -p <project>`). Stop and report lint errors.
3. Start the run with `run_tests` (or `sdods run -p <project> -e <env> …`) using the requested
   layer, browser and tags. Default to `-l api` then `-l ui -b chromium -t @smoke` when the user
   gave no slice.
4. Read the result with `run_get`: totals, failed scenarios with their first error, flaky retries,
   healed locators, and the report path.
5. For each failure, say whether it looks like the product, the test or the environment. Offer
   `/sdods:heal` for test-side failures.
