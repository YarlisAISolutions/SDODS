# AGENT.md — SDODS for coding agents

SDODS is an automation and orchestration platform with a reusable architecture: BDD for UI, API and hybrid flows. This file orients an AI coding assistant working in this repository.

## Mental model

- **Hierarchy**: organization → workspace(s) → project (`projects/<slug>`) → module (`features/<module>/`). `sdods.workspace.yaml` at the root names the org and workspaces; each project has `sdods.project.yaml` and `envs/<env>.yaml`.
- **Layers**: `@ui`, `@api`, `@hybrid` scenarios share ONE merged BDD fixture set (`@sdods/core/fixtures`). A scenario can seed through the API and assert in the browser.
- **Processes**: named run recipes (pr-check, nightly-regression, release-gate). `sdods run --process <name>`.
- **Everything is CLI-first**: `sdods run`, `lint`, `steps list`, `features list`, `report`, `heal report`, `record`, `har`, `db`, `mcp`, `agent`, `proposals`, `serve`.
- **Agents never edit the working tree**; they write proposals under `proposals/<id>/` that a person accepts with `sdods proposals accept <id>`.

## Conventions


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

## Where things live

| Path | Purpose |
|---|---|
| `packages/contracts` | schemas, ids, attachment names, scopes (leaf package) |
| `packages/core` | config precedence, registry, fixtures, step library, data, screenshots, heal, recorder, lint, analyze |
| `packages/cli` | the `sdods` command |
| `packages/db` | Kysely, SQLite ⇄ Postgres, ingest, insights |
| `packages/mcp` | tool registry, MCP server (stdio + HTTP), proposals, prompts |
| `packages/agents` | LLM adapters, roles, jobs |
| `packages/integrations` | GitHub, Jira |
| `packages/server`, `packages/web` | Fastify API and React UI |
| `projects/demo-shop` | reference project and release acceptance suite |

## Verify before you claim done

```bash
bun run typecheck && bun run lint && bun run test
bun run sdods lint -p <slug>
bun run sdods run -p <slug> -e <env> -l api
bun run sdods run -p <slug> -e <env> -l ui -b chromium -t @smoke
```
