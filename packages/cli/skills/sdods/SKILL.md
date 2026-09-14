---
name: sdods
description: Work in an SDODS test-automation workspace — BDD features for UI, API and hybrid flows. Use when writing, fixing or reviewing Gherkin features, steps, page objects or project/env YAML, running suites, reading results, or using the sdods CLI or its MCP tools.
---

# SDODS

SDODS runs BDD scenarios for UI, API and hybrid flows from one workspace. A workspace has
`sdods.workspace.yaml` at its root; each project is `projects/<slug>/sdods.project.yaml` plus
`envs/<env>.yaml`, and features live in `projects/<slug>/features/<module>/`.

Commands below use `sdods`. Without a global install use `npx -y @sdods/cli` in its place; inside
an SDODS source checkout use `bun run sdods`. When the `sdods` MCP server is connected, prefer its
tools (`project_list`, `feature_list`, `step_find`, `run_tests`, `run_get`, `analyze_failure`, …)
over shelling out.

## Rules

- Every scenario carries exactly one layer tag (`@ui`, `@api`, `@hybrid`) and exactly one suite tag
  (`@smoke`, `@regression`, `@sanity`). Optional: `@visual @a11y @perf @mock @data-driven @pool`,
  and value tags `@user:<role> @data:<dataset> @har:<name> @jira:KEY @skip:<browser>`.
- Reuse existing steps first (`sdods steps list -p <slug>`, or `step_find`). Add a step only when no
  phrasing fits, and name it in the same style.
- Locator priority: role + name > label > test id > placeholder > text > CSS. Never XPath.
- Page objects use step decorators (`@Fixture`, `@Given/@When/@Then`) and heal-aware locators:
  `this.heal.locator(primary, { role, name, testId, description })`.
- Keep scenarios independent and deterministic, with no sleeps. Seed through the API rather than the
  UI, and clean up what you create.
- Secrets are never literals; reference `${VAR}`.
- When acting through SDODS agents or MCP write tools, changes are proposals (`feature_write`,
  `proposals`) that a person accepts with `sdods proposals accept <id>`.

## Quick reference

| Task | Command |
| --- | --- |
| Projects and hierarchy | `sdods project list`, `sdods workspace tree` |
| Resolved config, with where each value came from | `sdods config show -p <slug> -e <env> --explain` |
| Validate features | `sdods lint -p <slug>` |
| Run a slice | `sdods run -p <slug> -e <env> -l api` · `-l ui -b chromium -t @smoke` · `--process pr-check` |
| Results | `sdods report --last`, `sdods heal report --last`, `sdods trace --last` |
| Available steps | `sdods steps list -p <slug>` |
| Record and replay | `sdods record -p <slug> -e <env> --user <role> --name <name>` |
| Agents | `sdods agent plan\|generate\|heal\|upgrade\|review -p <slug> --dry-run`, `sdods proposals list` |
| Health check | `sdods doctor` |

## Writing a scenario

1. Pick the module directory under `features/` and tag the Feature with one layer and one suite tag.
2. Reuse steps from `sdods steps list`; add project steps in `steps/<module>.steps.ts` only if needed.
3. Get data from datasets (`Given I load dataset "users" row 1`) or `@user:<role>`, never literals.
4. `sdods lint -p <slug>`, then run just that scenario and check the before/after screenshots in
   `.sdods/runs/<runId>/`.

## Verify before claiming done

```bash
sdods lint -p <slug>
```

```bash
sdods run -p <slug> -e <env> -l api
```

```bash
sdods run -p <slug> -e <env> -l ui -b chromium -t @smoke
```

Exit codes: `0` passed · `1` test failures · `2` configuration or usage error · `3` lint errors.
