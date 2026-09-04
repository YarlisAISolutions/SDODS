<p align="center">
  <img src="docs/assets/sdods-logo.svg" alt="SDODS" width="520">
</p>

<p align="center">
  <strong>Automation and orchestration for reliable business workflows</strong><br>
  BDD for UI, API and hybrid flows · multi-project, multi-environment · data-driven · self-healing · before/after screenshot narratives · SQLite ⇄ Postgres · MCP server · AI agents · GitHub &amp; Jira · cron schedules · web UI.
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue.svg"></a>
  <img alt="Node 22+" src="https://img.shields.io/badge/node-%E2%89%A522-339933?logo=node.js&logoColor=white">
  <img alt="Bun" src="https://img.shields.io/badge/bun-1.4-000000?logo=bun&logoColor=white">
</p>

---

SDODS is an automation and orchestration platform. You describe behaviour in Gherkin, keep one YAML file per project and one per environment, and drive everything from a single command line. It is open source (Apache-2.0) and free to use, including its API tokens.

Created by **Sireesh Yarlagadda** · [LinkedIn](https://www.linkedin.com/in/yarlagadda/)

## Table of contents

1. [Why SDODS](#why-sdods)
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

## Why SDODS

Software ships when someone is confident enough to say yes. That confidence is usually scattered: a green pipeline here, a manual check there, a screenshot pasted into a ticket, and one person who remembers why a flow is fragile. SDODS turns it into evidence anyone can point at. Every scenario belongs to a business capability, every run is reproducible from one command, and every regression carries the screenshots, requests and history that explain it.

So the questions that actually decide a release have an answer:

| Question before a release | How SDODS answers it |
|---|---|
| Does the whole journey still work, not just the page? | Gherkin features with **one merged fixture set**, so a scenario can seed through the API and assert in the browser |
| Is this the same suite that passed in staging? | `projects/<slug>/sdods.project.yaml` + `envs/<env>.yaml`; strict, explainable config precedence; secrets only through `${VAR}` |
| Can we prove it with real data, for every role? | CSV / JSON / YAML / DB tables / faker factories per environment, plus **user pools** leased per worker with login state reuse |
| Will it work for customers on any browser? | chromium, firefox, webkit, mobile emulation, `--project-matrix`, `@skip:<browser>` tags validated by lint |
| What exactly did the user see when it broke? | before/after screenshots per step (policy by suite tag), API request/response snapshots, a run viewer with slider/overlay/diff |
| Will a UI tweak send the team on a false hunt? | scored self-healing locators with persisted heal history and proposals to fix page objects |
| Which flows are getting less reliable over time? | cucumber NDJSON ingested into SQLite or Postgres: flakiness, locator fragility, env stability, suite health |
| Can we keep coverage up without more headcount? | MCP server (project analysis, run, results, proposals), provider-agnostic agents (plan, generate, heal, upgrade, review) that only write reviewable proposals |
| Who ran what, when, and who signed off? | roles, free scoped API tokens, audit log, GitHub check runs and issues, Jira issues and links, cron schedules |

## Install in one line

```bash
# macOS / Linux
curl -fsSL https://sdods.com/install.sh | sh

# Windows (PowerShell)
irm https://sdods.com/install.ps1 | iex
```

Node 22+ is the only prerequisite. The installer checks it, installs Bun if you lack it, fetches
SDODS into `~/.sdods`, installs Chromium, writes an `sdods` command and runs `sdods doctor`.
Options (`--workspace`, `--browsers all`, `--mcp claude`, `--version`, `--uninstall`, …) are on the
[install page](https://sdods.com/install/) and in the
[installer reference](https://docs.sdods.com/docs/reference/installer/).

```bash
cd ~/.sdods/app
sdods run -p demo-shop -e staging -l api                        # API layer, no browser
sdods run -p demo-shop -e staging -l ui -b chromium -t @smoke   # UI smoke
sdods report --last --open                                      # HTML report + dashboard
```

## Five-minute quickstart (from a clone)

Prerequisites: Node 22+, and either Bun 1.4+ (fastest) or pnpm 9+.

```bash
# 1. Get the code
git clone https://github.com/siri1410/SDODS.git && cd SDODS
bun install                      # or: pnpm install
sdods browsers install --with-deps

# 2. Look around
bun run sdods project list
bun run sdods config show -p demo-shop -e staging --explain
bun run sdods doctor

# 3. Run the demo project
bun run sdods run -p demo-shop -e staging -l api                    # API layer, no browser
bun run sdods run -p demo-shop -e staging -l ui -b chromium -t @smoke
bun run sdods run -p demo-shop --project-matrix -t @smoke           # every browser in the project yaml

# 4. Look at results
bun run sdods report --last --open                                   # HTML report + SDODS dashboard
bun run sdods serve                                                  # web UI at http://127.0.0.1:4444
```

Start your own project from an existing application:

```bash
bun run sdods analyze ../my-app --apply       # detects framework, routes, OpenAPI, test-id attribute, auth
bun run sdods run -p my-app -e local -t @smoke
```

Or from scratch:

```bash
bun run sdods project create my-app --ui-url http://localhost:3000 --api-url http://localhost:3000/api --env local
```

## How it works

```mermaid
flowchart LR
  subgraph you["You"]
    CLI["sdods CLI"]
    UI["Web UI"]
    MCPc["MCP clients<br/>(Claude Code, Cursor, VS Code)"]
  end
  subgraph runtime["Runtime (Node 22)"]
    CFG["Config precedence<br/>defaults → project → env → .env → process → CLI"]
    REG["ProjectRegistry"]
    PW["sdods.runner.config.ts<br/>project × layer × browser"]
    BDD["generate specs → run suite"]
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

Everything is **CLI-first**. The web UI, the MCP server and the scheduler spawn the same `sdods` commands and stream their output. That keeps CI simple and means nothing needs a database until you want history.

## Architecture

```mermaid
flowchart TB
  contracts["@sdods/contracts<br/>schemas · ids · names · scopes · DTOs"]
  core["@sdods/core<br/>config · fixtures · steps · data · shots · heal<br/>recorder · har · lint · analyze · reporters"]
  db["@sdods/db<br/>Kysely · migrations · ingest · insights"]
  mcp["@sdods/mcp<br/>ToolRegistry · stdio · HTTP"]
  integrations["@sdods/integrations<br/>GitHub · Jira"]
  agents["@sdods/agents<br/>LlmAdapter · roles · proposals"]
  server["@sdods/server<br/>Fastify · SSE · auth · scheduler"]
  web["@sdods/web<br/>React · run viewer · editor"]
  cli["@sdods/cli<br/>sdods"]
  contracts --> core --> db --> mcp --> integrations --> agents --> server --> web
  cli -.-> core & db & mcp & agents & integrations & server
```

The dependency graph is acyclic and enforced by TypeScript project references. Details, decisions and trade-offs live in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

**Runtime split.** The test workers, vitest and the native database drivers run on **Node 22**. **Bun** is used as the package manager, script runner and bundler because it is measurably faster there; nothing executes tests under Bun. pnpm works too.

## Projects, environments and configuration

A project is a directory:

```
projects/demo-shop/
  sdods.project.yaml     # layers, browsers, tags, routes, data sources, auth, screenshots, heal, integrations, schedules
  envs/staging.yaml        # base URLs, API auth (${VAR}), pool size, locale/timezone, per-env overrides
  envs/local.yaml
  .env.staging             # secrets (gitignored); .env.example documents them
  features/                # Gherkin (ui/, api/, hybrid/)
  steps/fixtures.ts        # extends the SDODS test with your auth strategy and page objects
  steps/*.steps.ts         # project-specific steps (generic ones come from @sdods/core/steps)
  pages/*.ts               # page objects with step decorators and heal-aware locators
  data/common/  data/staging/  data/factories.ts
  recorded/  har/  .auth/
```

Configuration precedence (later wins), each layer validated with Zod and visible in `sdods config show --explain`:

```
framework defaults → sdods.project.yaml → envs/<env>.yaml → .env + .env.<env> → process.env (SDODS_*) → CLI flags
```

Rules that keep it honest:

- Any key that looks like a secret must be `${VAR}` (optionally `${VAR:-default}`); a literal fails validation.
- `.env` files are parsed, never injected into `process.env`, so the process layer always outranks them.
- `SDODS_UI_BASE_URL`, `SDODS_API_BASE_URL`, `SDODS_ENV`, `SDODS_HEADED`, `SDODS_WORKERS`, `SDODS_SHARD`, `SDODS_RETRIES`, `SDODS_SHOT_POLICY`, `SDODS_HAR_MODE`, `SDODS_OFFLINE` map onto config paths.

## Writing tests

Features are plain Gherkin. Tags pick the layer and suite; steps come from the shared library or from your project.

```gherkin
@hybrid @regression
Feature: Seed a post and see it in the UI
  Scenario: API seeds, UI verifies
    Given I use a leased user with role "standard"
    When I seed via POST "/posts" with body:
      """json
      { "title": "SDODS {{username}}", "userId": 1 }
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

The shared step library covers HTTP verbs with doc-string bodies, headers, query params, JSON-path and schema assertions (JSON Schema, Zod, OpenAPI), response variable capture and polling, navigation by route name, role/label/test-id interactions, data-table forms, visual baselines, network mocks, dataset loading and user leasing. Run `sdods steps list -p <slug>` to see everything available to a project.

## Test data and user pools

Declare sources once per project; SDODS resolves them per environment (`data/<env>/users.csv` → `fallback` → `data/common/users.csv`):

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

`sdods lint` runs before every `sdods run` and enforces the taxonomy:

| Tag | Meaning |
|---|---|
| `@ui` `@api` `@hybrid` | exactly one per scenario; selects the layer project |
| `@smoke` `@regression` `@sanity` (configurable) | exactly one; selects the screenshot policy and CI gate |
| `@visual` `@a11y` `@perf` `@mock` `@data-driven` `@pool` | optional features |
| `@user:<role>` `@data:<dataset>` `@har:<name>` `@env:<name>` | values validated against the project yaml |
| `@jira:PROJ-123` `@github:123` | issue links shown in the run viewer |
| `@skip:webkit` | per-browser exclusion, never a silent branch in code |
| `@retries:2` `@timeout:60000` `@slow` `@mode:serial` `@skip` `@fixme` | runner control tags, passed through |

Filter with Cucumber expressions: `sdods run -t "@smoke and not @mock"`.

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
sdods record -p demo-shop -e staging --name checkout --user standard   # records a session, logged in as a pool user
sdods run -p demo-shop -l recorded                                     # recorded specs run as a normal layer
sdods record convert projects/demo-shop/recorded/checkout.spec.ts      # agent proposal: feature + steps + page object
sdods har record -p demo-shop -t @har:products                          # capture network into projects/demo-shop/har/<env>/
sdods har replay -p demo-shop --strict                                  # offline run; CI uses this
```

## Database: SQLite or Postgres

```bash
DB_DRIVER=sqlite  sdods db migrate                     # zero-setup default (.sdods/sdods.db)
docker compose up -d postgres
sdods db switch postgres --target-url postgres://sdods:sdods@localhost:5432/sdods
sdods db switch sqlite                                 # and back; data is copied and verified both ways
```

One Kysely schema serves both drivers. Runs ingest automatically when a database is configured (`sdods report ingest` for CI artifacts).

## Web UI

`sdods serve` starts the Fastify server and the React app: dashboard trends, projects and environments as forms, dataset upload with preview, run list and live logs, the step timeline with before/after comparison and API panels, a Gherkin editor with step completion and lint diagnostics, recorder, agent proposals with diff review, integrations, schedules, users, roles and API tokens. Roles: admin, editor, viewer.

## MCP server

SDODS is itself an MCP server:

```bash
claude mcp add sdods -- npx sdods mcp --project demo-shop --env staging     # stdio
sdods mcp install claude|codex|cursor|vscode|windsurf                         # registers the server with the client
sdods mcp --http --port 4001                                                  # streamable HTTP with scoped tokens
```

Tool families: `project_*`, `analyze_*` (framework, routes, OpenAPI, locators audit, coverage, best practices, change impact, failure analysis), `feature_*`/`step_*`, `run_*`, `data_*`, `heal_*`/`insights_*`, `record_*`, `agent_*`/`proposal_*`, `issue_*`, `schedule_*`. Browser driving stays with the bundled `npx playwright mcp`, configured alongside.

## AI agents

```bash
sdods agent plan     -p demo-shop --goal "checkout with a discount code"
sdods agent generate -p demo-shop --plan docs/test-plans/checkout.md
sdods agent heal     -p demo-shop --scenario <fingerprint>
sdods agent upgrade  -p demo-shop --diff main..feature/x
sdods proposals list && sdods proposals accept <id> --branch sdods/<id>
```

Agents run on a provider-agnostic adapter: `claude` (Anthropic API key), `claude-code` (your logged-in Claude Code CLI, no key), `codex` (your logged-in Codex CLI, no key), `openai-compatible` (any chat-completions endpoint) or `fake` (CI and `--dry-run`). When nothing is configured the adapter is auto-detected in that order. Agents can read the project, run scenarios and drive a browser through MCP, but they can only **write proposals** that you review in the UI or the CLI. Budgets per role are configured in the project yaml.

## Use with Claude Code and Codex CLI

Both CLIs work in two directions: they can drive SDODS through its MCP server, and SDODS agents can run on their logins instead of an API key.

```bash
# Claude Code
sdods agent install --for claude -p demo-shop       # .claude/agents/sdods-*.md, CLAUDE.md, MCP registration
sdods agent review -p demo-shop --adapter claude-code
claude                                                # then: "use sdods to run the demo-shop smoke suite"

# Codex CLI
sdods agent install --for codex -p demo-shop        # AGENTS.md + [mcp_servers.sdods] in ~/.codex/config.toml
sdods agent heal -p demo-shop --scenario <fingerprint> --adapter codex
codex                                                 # then: "use the sdods tools to list projects"
```

`sdods agent install --for all` sets up both. `sdods doctor` shows whether each CLI is installed and logged in.

## Tokens and keys

Nothing is mandatory for the platform itself; SDODS API tokens are self-issued and free. `sdods doctor` prints this matrix with live status.

| Key | Needed for | Requirement |
|---|---|---|
| `ANTHROPIC_API_KEY` | agents via the Claude Agent SDK / Messages API | one of the four agent options |
| Claude Code login (`claude login`) | agents via `--adapter claude-code` | one of the four agent options |
| Codex login (`codex login`) | agents via `--adapter codex` | one of the four agent options |
| `OPENAI_API_KEY` (+ `OPENAI_BASE_URL`) | agents via any OpenAI-compatible endpoint | one of the four agent options |
| `SESSION_SECRET` | `sdods serve` session signing | mandatory for the web server only |
| `DATABASE_URL` | Postgres | mandatory only when `DB_DRIVER=postgres` |
| `GITHUB_TOKEN` | check runs, PR comments, issues | optional |
| `JIRA_EMAIL` + `JIRA_API_TOKEN` | Jira issues, links, transitions | optional |
| `SDODS_TOKEN` (+ `SDODS_SERVER_URL`) | MCP over HTTP, CI ingest; created with `sdods tokens create` | optional, free |
| `FIREBASE_SERVICE_ACCOUNT_AUTOMAX_DOCS`, `NPM_TOKEN` | docs deploy and npm publish | CI-only GitHub secrets |

Everything runs offline without any of them: HAR replay for the demo, SQLite for the database, `--dry-run` for agents.

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
sdods schedule add -p demo-shop --name nightly --cron "0 2 * * *" --tz America/New_York -t @regression -b chromium -b firefox --notify github
sdods schedule next --count 5
sdods schedule install --target github     # or crontab | launchd | systemd
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

Full reference with examples: the documentation site (`apps/docs`, published on Firebase Hosting at https://docs.sdods.com).

## Development process

```bash
bun install && sdods browsers install --with-deps
bun run typecheck        # tsc -b across packages
bun run lint             # eslint + prettier
bun run test             # vitest unit tests
bun run sdods lint -p demo-shop
bun run sdods run -p demo-shop -e staging -l api
bun run release:check    # demo suite on every browser, offline via HAR
```

- Branch from `main`, keep commits focused, and add or update tests with every change.
- CI runs lint, typecheck, unit tests, the demo suite on chromium (PRs) and the full browser matrix nightly.
- Versioning uses changesets; releases publish `@sdods/*` to npm and a server image to GHCR.
- Security issues: see [SECURITY.md](SECURITY.md).

## Roadmap and status

Implementation follows the phased plan in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Each phase ends runnable:

| Phase | Scope | Status |
|---|---|---|
| 0 | Monorepo, config precedence, registry, CLI skeleton | done |
| 1 | API layer end to end (no browser) | done |
| 2 | UI layer, page objects, self-healing, dashboard | done |
| 3 | Data providers, user pool, auth capture, hybrid | done |
| 4 | Screenshot narratives, NDJSON | done |
| 5 | Database, ingest, switch | done |
| 6 | Recorder and HAR | done |
| 7 | MCP server | done |
| 8 | Agents and insights | done |
| 9 | Server | done |
| 10 | Web UI | done |
| 11 | GitHub, Jira, CI workflows | done |
| 12 | Onboarding analysis, cross-browser matrix | done |
| 13 | Docs site, packaging | done |

## License

Apache-2.0. Copyright © 2026 Sireesh Yarlagadda and SDODS contributors.
