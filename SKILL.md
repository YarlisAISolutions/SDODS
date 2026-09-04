---
name: automax
description: Work inside an AutoMax repository — an automation platform with a reusable architecture built on Playwright. Use for writing or fixing Gherkin features, page objects, step definitions, project/env yaml, running suites, reading results, and driving the automax CLI or MCP tools.
---

# AutoMax skill

## Quick reference

| Task | Command |
|---|---|
| See projects / hierarchy | `automax project list`, `automax workspace tree` |
| Resolve config with provenance | `automax config show -p <slug> -e <env> --explain` |
| Validate features | `automax lint -p <slug>` |
| Run a slice | `automax run -p <slug> -e <env> -l api` · `-l ui -b chromium -t @smoke` · `--process pr-check` |
| Results | `automax report --last`, `automax heal report --last` |
| Steps available | `automax steps list -p <slug>` |
| Record / replay | `automax record -p <slug> -e <env> --user <role> --name <name>`, `automax har replay --strict` |
| Agents | `automax agent plan|generate|heal|upgrade|review -p <slug> [--dry-run]`, `automax proposals list|show|accept|reject` |
| MCP | `automax mcp --project <slug>`, `automax mcp install claude` |

## Rules


- One project = `projects/<slug>/automax.project.yaml` + `envs/<env>.yaml`; features live in `features/<module>/`.
- Every scenario carries exactly one layer tag (@ui, @api, @hybrid) and exactly one suite tag (@smoke, @regression, @sanity).
  Optional tags: @visual @a11y @perf @mock @data-driven @pool, value tags @user:<role> @data:<dataset> @har:<name> @jira:KEY @skip:<browser>.
- Reuse existing steps first (call step_list / step_find). Add a new step only when no existing phrasing fits; name it in the same style.
- Locator priority: role+name > label > test id (project testIdAttribute) > placeholder > text > CSS. Never XPath.
- Page objects use playwright-bdd decorators (@Fixture, @Given/@When/@Then) and heal-aware locators (`this.heal.locator(primary, { role, name, testId, description })`).
- Never write to the working tree: propose files with feature_write / proposal tools; a person reviews and accepts.
- Keep scenarios independent, deterministic, and free of sleeps; prefer API seeding over UI setup; clean up created data.
- Secrets are never literals; reference ${VAR}.
- Stop when you run out of budget or turns and summarise what remains.

## Writing a scenario (checklist)

1. Pick the module directory under `features/` and the module tag.
2. Tag the Feature: one layer (`@ui|@api|@hybrid`) + one suite (`@smoke|@regression|@sanity`).
3. Reuse steps from `automax steps list`; add project steps in `steps/<module>.steps.ts` only when needed.
4. Data through datasets (`Given I load dataset "users" row 1`) or `@user:<role>`; never literal secrets.
5. `automax lint -p <slug>` then run the scenario; check before/after screenshots in `.automax/runs/<runId>/`.
