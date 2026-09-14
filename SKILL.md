---
name: sdods
description: Work inside an SDODS repository — an automation and orchestration platform with a reusable architecture. Use for writing or fixing Gherkin features, page objects, step definitions, project/env yaml, running suites, reading results, and driving the sdods CLI or MCP tools.
---

# SDODS skill

## Quick reference

| Task | Command |
|---|---|
| See projects / hierarchy | `sdods project list`, `sdods workspace tree` |
| Add / remove a project | `sdods project create <slug>`, `sdods project import <dir\|zip\|git-url>`, `sdods project delete <slug> --yes` |
| Resolve config with provenance | `sdods config show -p <slug> -e <env> --explain` |
| Validate features | `sdods lint -p <slug>` |
| Role × surface matrix (`roles.matrix.yaml`) | `sdods matrix expand -p <slug>` · `--check` in CI |
| Run a slice | `sdods run -p <slug> -e <env> -l api` · `-l ui -b chromium -t @smoke` · `--process pr-check` |
| Results | `sdods report --last`, `sdods heal report --last` |
| Steps available | `sdods steps list -p <slug>` |
| Record / replay | `sdods record -p <slug> -e <env> --user <role> --name <name>`, `sdods har replay --strict` |
| Agents | `sdods agent plan|generate|heal|upgrade|review -p <slug> [--dry-run]`, `sdods proposals list|show|accept|reject` |
| MCP | `sdods mcp --project <slug>`, `sdods mcp install claude` |

## Rules


- One project = `projects/<slug>/sdods.project.yaml` + `envs/<env>.yaml`; features live in `features/<module>/`.
- Every scenario carries exactly one layer tag (@ui, @api, @hybrid) and exactly one suite tag (@smoke, @regression, @sanity).
  Optional tags: @visual @a11y @perf @mock @data-driven @pool, value tags @user:<role> @data:<dataset> @har:<name> @jira:KEY @skip:<browser> @matrix:<name>.
- Reuse existing steps first (call step_list / step_find). Add a new step only when no existing phrasing fits; name it in the same style.
- Locator priority: role+name > label > test id (project testIdAttribute) > placeholder > text > CSS. Never XPath.
- Page objects use step decorators (@Fixture, @Given/@When/@Then) and heal-aware locators (`this.heal.locator(primary, { role, name, testId, description })`).
- Never write to the working tree: propose files with feature_write / proposal tools; a person reviews and accepts.
- Keep scenarios independent, deterministic, and free of sleeps; prefer API seeding over UI setup; clean up created data.
- Secrets are never literals; reference ${VAR}.
- Stop when you run out of budget or turns and summarise what remains.

## Writing a scenario (checklist)

1. Pick the module directory under `features/` and the module tag.
2. Tag the Feature: one layer (`@ui|@api|@hybrid`) + one suite (`@smoke|@regression|@sanity`).
3. Reuse steps from `sdods steps list`; add project steps in `steps/<module>.steps.ts` only when needed.
4. Data through datasets (`Given I load dataset "users" row 1`) or `@user:<role>`; never literal secrets.
5. `sdods lint -p <slug>` then run the scenario; check before/after screenshots in `.sdods/runs/<runId>/`.
