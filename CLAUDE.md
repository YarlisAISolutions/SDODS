# CLAUDE.md — SDODS

SDODS is an automation and orchestration platform with a reusable architecture: BDD for UI, API and hybrid flows. Read `AGENT.md` for the mental model and `SKILL.md` for the command reference.

## Working in this repo

- Use the SDODS MCP server (`sdods mcp`) for anything about projects, features, steps, runs and results — it is registered in `.mcp.json` (`sdods mcp install claude` re-registers it).
- Subagents live in `.claude/agents/sdods-*.md`: planner, generator, healer, upgrader, reviewer. Delegate matching requests to them.
- Never edit features/steps/pages directly when acting as an SDODS agent: write a proposal (`write_proposal` / `feature_write`) and let a person accept it with `sdods proposals accept <id>`.
- Verify with `sdods lint -p demo-shop` and `sdods run -p demo-shop -e staging -l api` / `-l ui -b chromium -t @smoke` before claiming done.

## Rules


- One project = `projects/<slug>/sdods.project.yaml` + `envs/<env>.yaml`; features live in `features/<module>/`.
- Every scenario carries exactly one layer tag (@ui, @api, @hybrid) and exactly one suite tag (@smoke, @regression, @sanity).
  Optional tags: @visual @a11y @perf @mock @data-driven @pool, value tags @user:<role> @data:<dataset> @har:<name> @jira:KEY @skip:<browser> @matrix:<name> @req:<id> @locale:<bcp47> @theme:<light|dark|no-preference> @timezone:<IANA> @viewport:<W>x<H> @device:<name>.
- Reuse existing steps first (call step_list / step_find). Add a new step only when no existing phrasing fits; name it in the same style.
- Locator priority: role+name > label > test id (project testIdAttribute) > placeholder > text > CSS. Never XPath.
- Page objects use step decorators (@Fixture, @Given/@When/@Then) and heal-aware locators (`this.heal.locator(primary, { role, name, testId, description })`).
- Never write to the working tree: propose files with feature_write / proposal tools; a person reviews and accepts.
- Keep scenarios independent, deterministic, and free of sleeps; prefer API seeding over UI setup; clean up created data.
- Secrets are never literals; reference ${VAR}.
- Stop when you run out of budget or turns and summarise what remains.
