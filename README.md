<p align="center">
  <img src="docs/assets/automax-logo.svg" alt="AutoMax" width="520">
</p>

<p align="center">
  <strong>An entire wrapper around Playwright.</strong><br>
  BDD for UI, API and hybrid flows · multi-project, multi-environment · data-driven · self-healing · before/after screenshot narratives · SQLite ⇄ Postgres · MCP server · AI agents · GitHub &amp; Jira · cron schedules · web UI.
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue.svg"></a>
  <img alt="Node 22+" src="https://img.shields.io/badge/node-%E2%89%A522-339933?logo=node.js&logoColor=white">
  <img alt="Playwright 1.62" src="https://img.shields.io/badge/playwright-1.62-2EAD33?logo=playwright&logoColor=white">
  <img alt="playwright-bdd 9" src="https://img.shields.io/badge/playwright--bdd-9.x-6366F1">
  <img alt="Bun" src="https://img.shields.io/badge/bun-1.4-000000?logo=bun&logoColor=white">
</p>

---

AutoMax turns Playwright into a complete test platform you can drive from one CLI, one YAML file per project, and one web UI. It is open source (Apache-2.0) and free to use, including its API keys.

Created by **Sireesh Yarlagadda** · [LinkedIn](https://www.linkedin.com/in/yarlagadda/)

## Table of contents

1. [Why AutoMax](#why-automax)
2. [Five-minute quickstart](#five-minute-quickstart)
3. [How it works](#how-it-works)
4. [Architecture](#architecture)
5. [Projects, environments and configuration](#projects-environments-and-configuration)
6. [Writing tests](#writing-tests)
7. [Test data and user pools](#test-data-and-user-pools)
8. [Tags and suites](#tags-and-suites)
9. [Screenshot narratives](#screenshot-narratives)
10. [Record, playback and HAR](#record-playback-and-har)
11. [Database: SQLite or Postgres](#database-sqlite-or-postgres)
12. [Web UI](#web-ui)
13. [MCP server](#mcp-server)
14. [AI agents](#ai-agents)
15. [GitHub and Jira](#github-and-jira)
16. [Scheduling](#scheduling)
17. [CLI reference](#cli-reference)
18. [Development process](#development-process)
19. [Roadmap and status](#roadmap-and-status)

## Why AutoMax

Playwright is an excellent engine. Teams still rebuild the same things around it: environment switching, tagging policy, test data, login reuse, reporting, flaky triage, CI wiring, and now AI helpers. AutoMax ships those once, with opinions:

| Need | What AutoMax gives you |
|---|---|
| UI, API and mixed scenarios in one language | Gherkin features on top of playwright-bdd with **one merged fixture set**, so a scenario can seed through the API and assert in the browser |
| Many apps, many environments | `projects/<slug>/automax.project.yaml` + `envs/<env>.yaml`; strict, explainable config precedence; secrets only through `${VAR}` |
| Reusable data | CSV / JSON / YAML / DB tables / faker factories per environment, plus **user pools** leased per worker with login state reuse |
| Confidence across browsers | chromium, firefox, webkit, mobile emulation, `--project-matrix`, `@skip:<browser>` tags validated by lint |
| Readable results | before/after screenshots per step (policy by suite tag), API request/response snapshots, a run viewer with slider/overlay/diff |
| Resilience | scored self-healing locators with persisted heal history and proposals to fix page objects |
| Institutional memory | cucumber NDJSON ingested into SQLite or Postgres: flakiness, locator fragility, env stability, suite health |
| Automation for the automation | MCP server (project analysis, run, results, proposals), provider-agnostic agents (plan, generate, heal, upgrade, review) that only write reviewable proposals |
| Enterprise plumbing | roles, free scoped API tokens, audit log, GitHub check runs and issues, Jira issues and links, cron schedules |

## Five-minute quickstart

Prerequisites: Node 22+, and either Bun 1.4+ (fastest) or pnpm 9+.

```bash
# 1. Get the code
git clone https://github.com/yarlagadda/AutoMax.git && cd AutoMax
bun install                      # or: pnpm install
npx playwright install --with-deps

# 2. Look around
bun run automax project list
bun run automax config show -p demo-shop -e staging --explain
bun run automax doctor

# 3. Run the demo project
bun run automax run -p demo-shop -e staging -l api                    # API layer, no browser
bun run automax run -p demo-shop -e staging -l ui -b chromium -t @smoke
bun run automax run -p demo-shop --project-matrix -t @smoke           # every browser in the project yaml

# 4. Look at results
bun run automax report --last --open                                   # Playwright HTML report + AutoMax dashboard
bun run automax serve                                                  # web UI at http://127.0.0.1:4444
```

Start your own project from an existing application:

```bash
bun run automax analyze ../my-app --apply       # detects framework, routes, OpenAPI, test-id attribute, auth
bun run automax run -p my-app -e local -t @smoke
```

Or from scratch:

```bash
bun run automax project create my-app --ui-url http://localhost:3000 --api-url http://localhost:3000/api --env local
```

## How it works

```mermaid
flowchart LR
  subgraph you["You"]
    CLI["automax CLI"]
    UI["Web UI"]
    MCPc["MCP clients<br/>(Claude Code, Cursor, VS Code)"]
  end
  subgraph runtime["Runtime (Node 22)"]
    CFG["Config precedence<br/>defaults → project → env → .env → process → CLI"]
    REG["ProjectRegistry"]
    PW["playwright.config.ts<br/>project × layer × browser"]
    BDD["bddgen → Playwright test"]
    FIX["Merged fixtures<br/>api · pages · data · user · shots · heal"]
  end
  subgraph out["Outputs"]
    NDJ["cucumber messages<br/>NDJSON"]
    ART["screenshots · API snapshots<br/>heal events · traces"]
    HTML["HTML report · dashboard"]
  end
  subgraph platform["Platform"]
    DB[("SQLite ⇄ Postgres<br/>Kysely")]
    SRV["Fastify server<br/>REST · SSE · /mcp · auth"]
    INS["Insights<br/>flaky · fragility · health"]
    AG["Agents<br/>plan · generate · heal · upgrade"]
    INT["GitHub · Jira"]
    SCH["Scheduler (cron)"]
  end
  CLI --> CFG --> REG --> PW --> BDD --> FIX
  UI --> SRV --> CLI
  MCPc --> SRV
  MCPc --> CLI
  FIX --> NDJ & ART & HTML
  NDJ --> DB --> INS --> AG
  ART --> DB
  DB --> SRV
  SRV --> SCH --> CLI
  DB --> INT
```

Everything is **CLI-first**. The web UI, the MCP server and the scheduler spawn the same `automax` commands and stream their output. That keeps CI simple and means nothing needs a database until you want history.

## Architecture

```mermaid
flowchart TB
  contracts["@automax/contracts<br/>schemas · ids · names · scopes · DTOs"]
  core["@automax/core<br/>config · fixtures · steps · data · shots · heal<br/>recorder · har · lint · analyze · reporters"]
  db["@automax/db<br/>Kysely · migrations · ingest · insights"]
  mcp["@automax/mcp<br/>ToolRegistry · stdio · HTTP"]
  integrations["@automax/integrations<br/>GitHub · Jira"]
  agents["@automax/agents<br/>LlmAdapter · roles · proposals"]
  server["@automax/server<br/>Fastify · SSE · auth · scheduler"]
  web["@automax/web<br/>React · run viewer · editor"]
  cli["@automax/cli<br/>automax"]
  contracts --> core --> db --> mcp --> integrations --> agents --> server --> web
  cli -.-> core & db & mcp & agents & integrations & server
```

The dependency graph is acyclic and enforced by TypeScript project references. Details, decisions and trade-offs live in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

**Runtime split.** Playwright's test workers, vitest and the native database drivers run on **Node 22**. **Bun** is used as the package manager, script runner and bundler because it is measurably faster there; nothing executes tests under Bun. pnpm works too.

## Projects, environments and configuration

A project is a directory:

```
projects/demo-shop/
  automax.project.yaml     # layers, browsers, tags, routes, data sources, auth, screenshots, heal, integrations, schedules
  envs/staging.yaml        # base URLs, API auth (${VAR}), pool size, locale/timezone, per-env overrides
  envs/local.yaml
  .env.staging             # secrets (gitignored); .env.example documents them
  features/                # Gherkin (ui/, api/, hybrid/)
  steps/fixtures.ts        # extends the AutoMax test with your auth strategy and page objects
  steps/*.steps.ts         # project-specific steps (generic ones come from @automax/core/steps)
  pages/*.ts               # page objects with playwright-bdd decorators and heal-aware locators
  data/common/  data/staging/  data/factories.ts
  recorded/  har/  .auth/
```

Configuration precedence (later wins), each layer validated with Zod and visible in `automax config show --explain`:

```
framework defaults → automax.project.yaml → envs/<env>.yaml → .env + .env.<env> → process.env (AUTOMAX_*) → CLI flags
```

Rules that keep it honest:

- Any key that looks like a secret must be `${VAR}` (optionally `${VAR:-default}`); a literal fails validation.
- `.env` files are parsed, never injected into `process.env`, so the process layer always outranks them.
- `AUTOMAX_UI_BASE_URL`, `AUTOMAX_API_BASE_URL`, `AUTOMAX_ENV`, `AUTOMAX_HEADED`, `AUTOMAX_WORKERS`, `AUTOMAX_SHARD`, `AUTOMAX_RETRIES`, `AUTOMAX_SHOT_POLICY`, `AUTOMAX_HAR_MODE`, `AUTOMAX_OFFLINE` map onto config paths.

## Writing tests

Features are plain Gherkin. Tags pick the layer and suite; steps come from the shared library or from your project.

```gherkin
@hybrid @regression
Feature: Seed a post and see it in the UI
  Scenario: API seeds, UI verifies
    Given I use a leased user with role "standard"
    When I seed via POST "/posts" with body:
      """json
      { "title": "AutoMax {{username}}", "userId": 1 }
      """
    And I save the response JSON path "title" as "title"
    And I mock "**/inventory.html" with JSON:
      """json
      { "banner": "{{title}}" }
      """
    And I navigate to the "inventory" page
    Then the UI should show the text from JSON path "title"
```

Page objects use decorators and heal-aware locators:

```ts
@Fixture<typeof test>('loginPage')
export class LoginPage extends BasePage {
  readonly submit = this.heal.locator(this.page.locator('#login-button'), {
    role: 'button', name: 'Login', testId: 'login-button', description: 'login button',
  });

  @Given('I am on the login page') async open() { await this.goto('login'); }
  @When('I login with {string} and {string}') async login(u: string, p: string) { /* ... */ }
}
```

The shared step library covers HTTP verbs with doc-string bodies, headers, query params, JSON-path and schema assertions (JSON Schema, Zod, OpenAPI), response variable capture and polling, navigation by route name, role/label/test-id interactions, data-table forms, visual baselines, network mocks, dataset loading and user leasing. Run `automax steps list -p <slug>` to see everything available to a project.

## Test data and user pools

Declare sources once per project; AutoMax resolves them per environment (`data/<env>/users.csv` → `fallback` → `data/common/users.csv`):

```yaml
data:
  sources:
    users:    { type: csv,  path: 'data/{env}/users.csv', fallback: data/common/users.csv }
    products: { type: json, path: data/common/products.json }
    orders:   { type: db,   table: td_demo_shop_orders, envColumn: env }
  factories: ./data/factories.ts
  userPool: { dataset: users, roleColumn: role, leaseStore: file }
```

- `Given I load dataset "users" row 1` exposes columns as `{{username}}`, `{{password}}`, … to every step.
- `@user:standard` on a scenario leases a user of that role for the worker before the browser context starts, so the scenario begins logged in through cached storage state.
- `users.poolSize` per environment caps how many accounts a run may use; leases are per worker (and shard) with TTL recovery, file-based locally or table-based across machines.
- Faker factories are seeded from the scenario fingerprint so retries regenerate identical data.

## Tags and suites

`automax lint` runs before every `automax run` and enforces the taxonomy:

| Tag | Meaning |
|---|---|
| `@ui` `@api` `@hybrid` | exactly one per scenario; selects the layer project |
| `@smoke` `@regression` `@sanity` (configurable) | exactly one; selects the screenshot policy and CI gate |
| `@visual` `@a11y` `@perf` `@mock` `@data-driven` `@pool` | optional features |
| `@user:<role>` `@data:<dataset>` `@har:<name>` `@env:<name>` | values validated against the project yaml |
| `@jira:PROJ-123` `@github:123` | issue links shown in the run viewer |
| `@skip:webkit` | per-browser exclusion, never a silent branch in code |
| `@retries:2` `@timeout:60000` `@slow` `@mode:serial` `@skip` `@fixme` | playwright-bdd special tags, passed through |

Filter with Cucumber expressions: `automax run -t "@smoke and not @mock"`.

## Screenshot narratives

Every UI scenario tells its story in pictures, and the amount is decided by the suite tag:

| Policy | When | What is captured |
|---|---|---|
| `on-failure` | default | one screenshot on failure |
| `scenario` | `@smoke`, `@sanity` | scenario start and end |
| `step` | `@regression` | **before and after every UI step** |
| `visual` | `@visual` | step captures plus `toHaveScreenshot` against a per-browser baseline |

API steps attach request and response JSON instead. The web run viewer pairs before/after images with a slider, an overlay, side-by-side panes, or a server-side pixel diff.

## Record, playback and HAR

```bash
automax record -p demo-shop -e staging --name checkout --user standard   # Playwright codegen, logged in as a pool user
automax run -p demo-shop -l recorded                                     # recorded specs run as a normal layer
automax record convert projects/demo-shop/recorded/checkout.spec.ts      # agent proposal: feature + steps + page object
automax har record -p demo-shop -t @har:products                          # capture network into projects/demo-shop/har/<env>/
automax har replay -p demo-shop --strict                                  # offline run; CI uses this
```

## Database: SQLite or Postgres

```bash
DB_DRIVER=sqlite  automax db migrate                     # zero-setup default (.automax/automax.db)
docker compose up -d postgres
automax db switch postgres --target-url postgres://automax:automax@localhost:5432/automax
automax db switch sqlite                                 # and back; data is copied and verified both ways
```

One Kysely schema serves both drivers. Runs ingest automatically when a database is configured (`automax report ingest` for CI artifacts).

## Web UI

`automax serve` starts the Fastify server and the React app: dashboard trends, projects and environments as forms, dataset upload with preview, run list and live logs, the step timeline with before/after comparison and API panels, a Gherkin editor with step completion and lint diagnostics, recorder, agent proposals with diff review, integrations, schedules, users, roles and API tokens. Roles: admin, editor, viewer.

## MCP server

AutoMax is itself an MCP server, modeled on Playwright MCP:

```bash
claude mcp add automax -- npx automax mcp --project demo-shop --env staging     # stdio
automax mcp install cursor|vscode|claude                                        # writes client config
automax mcp --http --port 4001                                                  # streamable HTTP with scoped tokens
```

Tool families: `project_*`, `analyze_*` (framework, routes, OpenAPI, locators audit, coverage, best practices, change impact, failure analysis), `feature_*`/`step_*`, `run_*`, `data_*`, `heal_*`/`insights_*`, `record_*`, `agent_*`/`proposal_*`, `issue_*`, `schedule_*`. Browser driving stays with the bundled `npx playwright mcp`, configured alongside.

## AI agents

```bash
automax agent plan     -p demo-shop --goal "checkout with a discount code"
automax agent generate -p demo-shop --plan docs/test-plans/checkout.md
automax agent heal     -p demo-shop --scenario <fingerprint>
automax agent upgrade  -p demo-shop --diff main..feature/x
automax proposals list && automax proposals accept <id> --branch automax/<id>
```

Agents run on a provider-agnostic adapter (Claude Agent SDK first; OpenAI-compatible; a fake adapter for CI and `--dry-run`). They can read the project, run scenarios and drive a browser through MCP, but they can only **write proposals** that you review in the UI or the CLI. Budgets per role are configured in the project yaml. LLM keys are yours and billed by the provider; AutoMax API tokens are free.

## GitHub and Jira

Configure per project (secrets by env var **name** only):

```yaml
integrations:
  github: { enabled: true, owner: acme, repo: shop, checkRun: true, prComment: true, createIssueOnFailure: smoke, tokenEnv: GITHUB_TOKEN }
  jira:   { enabled: true, baseUrl: https://acme.atlassian.net, projectKey: SHOP, createIssueOnFailure: always, transitionOnPass: Done }
```

CI gets check runs with failure annotations and one PR comment per run. Failures open deduplicated issues with steps, error, screenshots and the run link. `@jira:KEY` tags link scenarios to issues and show their status in the viewer.

## Scheduling

```bash
automax schedule add -p demo-shop --name nightly --cron "0 2 * * *" --tz America/New_York -t @regression -b chromium -b firefox --notify github
automax schedule next --count 5
automax schedule install --target github     # or crontab | launchd | systemd
```

Schedules live in the project yaml (version-controlled) or the database; the server runs them, or the generated workflow does when you have no server.

## CLI reference

Every command supports `--json`, `--quiet`, `--verbose`, `--cwd`, `--no-color`. Exit codes: `0` ok, `1` test failures, `2` config or usage error, `3` lint errors, `130` cancelled.

| Command | Purpose |
|---|---|
| `init`, `analyze`, `project create\|list`, `env add\|list`, `config show\|validate`, `doctor` | onboarding and configuration |
| `run` (`test`), `watch`, `lint`, `steps list`, `features list`, `coverage`, `browsers install` | authoring and execution |
| `record` (`codegen`), `har record\|replay`, `auth capture\|list` | record and playback |
| `data import\|preview\|seed`, `db migrate\|status\|switch\|export\|import\|prune` | data and database |
| `report`, `report ingest`, `show-report`, `trace`, `heal report`, `insights compute\|show` | results and learning |
| `agent plan\|generate\|heal\|upgrade\|review`, `proposals list\|show\|accept\|reject` | agents |
| `mcp`, `mcp install`, `serve`, `users`, `tokens`, `schedule`, `integrations sync\|notify\|test` | platform |

Full reference with examples: the documentation site (`apps/docs`, published on GitHub Pages).

## Development process

```bash
bun install && npx playwright install --with-deps
bun run typecheck        # tsc -b across packages
bun run lint             # eslint + prettier
bun run test             # vitest unit tests
bun run automax lint -p demo-shop
bun run automax run -p demo-shop -e staging -l api
bun run release:check    # demo suite on every browser, offline via HAR
```

- Branch from `main`, keep commits focused, and add or update tests with every change.
- CI runs lint, typecheck, unit tests, the demo suite on chromium (PRs) and the full browser matrix nightly.
- Versioning uses changesets; releases publish `@automax/*` to npm and a server image to GHCR.
- Security issues: see [SECURITY.md](SECURITY.md).

## Roadmap and status

Implementation follows the phased plan in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Each phase ends runnable:

| Phase | Scope | Status |
|---|---|---|
| 0 | Monorepo, config precedence, registry, CLI skeleton | done |
| 1 | API layer end to end (no browser) | in progress |
| 2 | UI layer, page objects, self-healing, dashboard | planned |
| 3 | Data providers, user pool, auth capture, hybrid | planned |
| 4 | Screenshot narratives, NDJSON | planned |
| 5 | Database, ingest, switch | planned |
| 6 | Recorder and HAR | planned |
| 7 | MCP server | planned |
| 8 | Agents and insights | planned |
| 9 | Server | planned |
| 10 | Web UI | planned |
| 11 | GitHub, Jira, CI workflows | planned |
| 12 | Onboarding analysis, cross-browser matrix | planned |
| 13 | Docs site, packaging | planned |

## License

Apache-2.0. Copyright © 2026 Sireesh Yarlagadda and AutoMax contributors.
