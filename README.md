<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/sdods-logo-dark.svg">
    <img src="docs/assets/sdods-logo.svg" alt="SDODS" width="520">
  </picture>
</p>

<h3 align="center"><strong>Test automation you can defend.</strong></h3>

<p align="center">
  BDD for UI, API and hybrid flows · multi-project, multi-environment · data-driven · self-healing · before/after screenshot narratives · SQLite ⇄ Postgres · MCP server · AI agents · GitHub &amp; Jira · cron schedules · web UI.
</p>

<p align="center">
  <a href="https://sdods.com"><b>sdods.com</b></a>
  &nbsp;·&nbsp;
  <a href="https://docs.sdods.com"><b>docs.sdods.com</b></a>
  &nbsp;·&nbsp;
  <a href="#install-in-one-line"><b>Install</b></a>
  &nbsp;·&nbsp;
  <a href="#architecture-c4"><b>Architecture</b></a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@sdods/cli"><img alt="npm version of @sdods/cli" src="https://img.shields.io/npm/v/%40sdods%2Fcli?label=%40sdods%2Fcli&color=2F5BFF&labelColor=0B1020&logo=npm"></a>
  <img alt="BDD: UI, API and hybrid" src="https://img.shields.io/badge/BDD-UI%20%C2%B7%20API%20%C2%B7%20hybrid-2F5BFF?labelColor=0B1020">
  <img alt="MCP server" src="https://img.shields.io/badge/MCP-server-FFB020?labelColor=0B1020">
  <img alt="Agents propose, people accept" src="https://img.shields.io/badge/agents-propose%2C%20people%20accept-2F5BFF?labelColor=0B1020">
  <img alt="SQLite or Postgres" src="https://img.shields.io/badge/SQLite-%E2%87%84%20Postgres-FFB020?labelColor=0B1020">
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue.svg"></a>
  <img alt="Node 22+" src="https://img.shields.io/badge/node-%E2%89%A522-339933?logo=node.js&logoColor=white">
  <img alt="Bun" src="https://img.shields.io/badge/bun-1.4-000000?logo=bun&logoColor=white">
  <!-- sponsor: shown once SPONSOR_ENABLED is on (packages/contracts/src/sponsor.ts)
  <a href="https://sdods.com/sponsor/"><img alt="Sponsor SDODS" src="https://img.shields.io/badge/sponsor-%E2%99%A5-ea4aaa?logo=githubsponsors&logoColor=white"></a>
  -->
</p>

---

SDODS is an automation and orchestration platform. You describe behaviour in Gherkin, keep one YAML file per project and one per environment, and drive everything from a single command line. It is open source (Apache-2.0) and free to use, including its API tokens.

## Table of contents

1. [Why SDODS](#why-sdods)
2. [Install in one line](#install-in-one-line)
3. [Five-minute quickstart (from a clone)](#five-minute-quickstart-from-a-clone)
4. [How it works](#how-it-works)
5. [The loop, in six panels](#the-loop-in-six-panels)
6. [Architecture (C4)](#architecture-c4)
7. [Projects, environments and configuration](#projects-environments-and-configuration)
8. [Writing tests](#writing-tests)
9. [Test data and user pools](#test-data-and-user-pools)
10. [Tags and suites](#tags-and-suites)
11. [Screenshot narratives](#screenshot-narratives)
12. [Record, playback and HAR](#record-playback-and-har)
13. [Database: SQLite or Postgres](#database-sqlite-or-postgres)
14. [Web UI](#web-ui)
15. [MCP server](#mcp-server)
16. [AI agents](#ai-agents)
17. [Use with Claude Code and Codex CLI](#use-with-claude-code-and-codex-cli)
18. [Tokens and keys](#tokens-and-keys)
19. [GitHub and Jira](#github-and-jira)
20. [Scheduling](#scheduling)
21. [CLI reference](#cli-reference)
22. [Development process](#development-process)
23. [Roadmap and status](#roadmap-and-status)
<!-- sponsor: shown once SPONSOR_ENABLED is on
20. [Support SDODS](#support-sdods)
-->

## Why SDODS

Software ships when someone is confident enough to say yes. That confidence is usually scattered: a green pipeline here, a manual check there, a screenshot pasted into a ticket, and one person who remembers why a flow is fragile. SDODS turns it into evidence anyone can point at. Every scenario belongs to a business capability, every run is reproducible from one command, and every regression carries the screenshots, requests and history that explain it.

So the questions that actually decide a release have an answer:

| Question before a release | How SDODS answers it |
|---|---|
| Does the whole journey still work, not just the page? | Gherkin features with **one merged fixture set**, so a scenario can seed through the API and assert in the browser |
| Is this the same suite that passed in staging? | `projects/<slug>/sdods.project.yaml` + `envs/<env>.yaml`; strict, explainable config precedence; secrets only through `${VAR}` |
| Can we prove it with real data, for every role? | CSV / JSON / YAML / DB tables / faker factories per environment, plus **user pools** leased per worker with login state reuse |
| Will it work for customers on any browser? | chromium, edge (real Microsoft Edge via the `msedge` channel), firefox, webkit, mobile emulation, `--project-matrix`, `@skip:<browser>` tags validated by lint |
| What exactly did the user see when it broke? | before/after screenshots per step (policy by suite tag), API request/response snapshots, a run viewer with slider/overlay/diff |
| Will a UI tweak send the team on a false hunt? | scored self-healing locators with persisted heal history and proposals to fix page objects |
| Which flows are getting less reliable over time? | cucumber NDJSON ingested into SQLite or Postgres: flakiness, locator fragility, env stability, suite health |
| Can we keep coverage up without more headcount? | MCP server (project analysis, run, results, proposals), provider-agnostic agents (plan, generate, heal, upgrade, review) that only write reviewable proposals |
| Who ran what, when, and who signed off? | roles, free scoped API tokens, audit log, GitHub check runs and issues, Jira issues and links, cron schedules |

## Install in one line

macOS and Linux:

```bash
curl -fsSL https://sdods.com/install.sh | sh
```

Windows (PowerShell):

```powershell
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
git clone https://github.com/YarlisAISolutions/SDODS.git && cd SDODS
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

## The loop, in six panels

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/sdods-sdlc-comic-dark.svg">
    <img src="docs/assets/sdods-sdlc-comic.svg" alt="Six-panel comic. Maxi, the SDODS assistant, and a developer go from Plan to Code, Test, Heal, Release and Operate, and what Operate learns feeds the next Plan." width="1200">
  </picture>
</p>

<details>
<summary>Text version of the six panels</summary>

1. **Plan.** The planner reads the app and its OpenAPI spec. Maxi: "I read your routes and the OpenAPI spec. Here is a plan, tagged and ready to write." The plan carries `@ui`, `@api` and `@smoke`. Developer: "Tagged before I even asked. Nice."
2. **Code.** A feature is written in Gherkin. Maxi: "The generator proposes two steps and a page object. Your working tree stays untouched." Developer, pressing Accept: "Read the diff. Accepted."
3. **Test.** `sdods run -t @smoke` passes on the ui, api and hybrid layers, with before and after screenshots. Maxi: "ui, api and hybrid: all green. A screenshot before and after every step, too." Developer: "So when it breaks, I see why."
4. **Heal.** The `#buy-btn` locator drifts and is found again by role and name. Maxi: "#buy-btn is gone. I found it by role and name, and wrote the smallest fix as a proposal." Developer: "Accept it on a branch. I will open the PR."
5. **Release.** The release gate passes. Maxi: "release-gate passed. The check run has the summary, and every step has its screenshots." Developer, thumbs up: "Ship it. This one I can defend."
6. **Operate.** A nightly schedule (`0 2 * * *`) runs and insights count flaky scenarios and fragile locators. Maxi: "Nightly ran at 02:00. Two flaky scenarios, one fragile locator. Numbers, not opinions." Developer: "Good. Put them in the next plan." An arrow runs from Operate back to Plan.

</details>

Agents only ever write proposals; a person accepts them (`sdods proposals accept <id> --branch sdods/<id>`) and opens the pull request.

## Architecture (C4)

Three zoom levels in [C4](https://c4model.com) notation. Amber boxes are people, the deep-blue box is SDODS as a whole, blue boxes are containers (things that run or store data), pale-blue boxes are components inside a container, grey boxes are external systems, and dashed outlines are boundaries.

### Level 1: System context

Who uses SDODS, and what it talks to.

```mermaid
flowchart LR
  qa["<b>QA engineer</b><br/>[Person]<br/>writes features, reads the evidence"]:::person
  dev["<b>Developer</b><br/>[Person]<br/>runs suites in CI, accepts proposals"]:::person
  ai["<b>AI coding assistant</b><br/>[Software system: MCP client]<br/>Claude Code · Cursor · VS Code · Codex"]:::external

  sdods["<b>SDODS</b><br/>[Software system]<br/>Gherkin suites for UI, API and hybrid flows,<br/>run history, self-healing, agents that propose"]:::system

  aut["<b>Application under test</b><br/>[External system]<br/>web UI and HTTP API, per environment"]:::external
  browsers["<b>Playwright browsers</b><br/>[External]<br/>chromium · firefox · webkit · Edge"]:::external
  gh["<b>GitHub</b><br/>[External]<br/>check runs · PR comments · issues"]:::external
  jira["<b>Jira</b><br/>[External]<br/>issues · links · transitions"]:::external
  llm["<b>LLM providers</b><br/>[External]<br/>Anthropic · OpenAI-compatible · Ollama<br/>Claude Code and Codex logins"]:::external
  mailpit["<b>Mailpit</b><br/>[External]<br/>catches sign-up and reset email"]:::external
  k6["<b>k6</b><br/>[External]<br/>load profiles"]:::external
  dist["<b>npm · GHCR</b><br/>[External]<br/>@sdods/* packages · server image"]:::external

  qa -->|"writes Gherkin, reviews runs"| sdods
  dev -->|"sdods run, proposals accept"| sdods
  ai -->|"MCP tools over stdio or HTTP"| sdods
  sdods -->|"drives the UI, calls the API"| aut
  sdods -->|"launches"| browsers
  sdods -->|"reads mail"| mailpit
  sdods -->|"runs generated scripts"| k6
  sdods -->|"reports, opens issues"| gh
  sdods -->|"opens and links issues"| jira
  sdods -->|"plan · generate · heal · upgrade · review"| llm
  dist -.->|"installs"| sdods

  classDef person fill:#FFB020,stroke:#B87800,color:#0B1020
  classDef system fill:#1E3FB8,stroke:#FFB020,stroke-width:3px,color:#FFFFFF
  classDef container fill:#2F5BFF,stroke:#1E3FB8,color:#FFFFFF
  classDef component fill:#DCE4FF,stroke:#2F5BFF,color:#0B1020
  classDef external fill:#64748B,stroke:#475569,color:#FFFFFF
```

### Level 2: Containers

What SDODS is made of, and which process calls which. The server and the MCP server do not reimplement anything: they spawn the same `sdods` commands you run yourself.

```mermaid
flowchart TB
  people["<b>QA engineer · Developer</b><br/>[Person]"]:::person
  ai["<b>AI coding assistant</b><br/>[External: MCP client]"]:::external

  subgraph sdods["SDODS [Software system]"]
    direction TB
    desktop["<b>Desktop app</b><br/>[Container: Electron]<br/>installs, launches and upgrades"]:::container
    web["<b>Web UI</b><br/>[Container: React SPA]<br/>run viewer, editor, proposals, schedules"]:::container
    cli["<b>CLI</b><br/>[Container: Node 22, commander]<br/>sdods run · lint · record · analyze · agent · serve"]:::container
    server["<b>Server</b><br/>[Container: Node 22, Fastify 5]<br/>REST · SSE · /mcp · sessions and tokens · cron"]:::container
    mcp["<b>MCP server</b><br/>[Container: stdio and streamable HTTP]<br/>one ToolRegistry, proposals"]:::container
    agents["<b>Agents</b><br/>[Container: Node library]<br/>planner · generator · healer · upgrader · reviewer"]:::container
    core["<b>Runtime</b><br/>[Container: @sdods/core, Playwright + playwright-bdd]<br/>config, fixtures, steps, heal, screenshots"]:::container
    integ["<b>Integrations</b><br/>[Container: Node library]<br/>GitHub and Jira providers, dedupe"]:::container
    db[("<b>Platform database</b><br/>[Container: SQLite ⇄ Postgres, Kysely]<br/>runs, heal events, insights")]:::container
    runs[("<b>Run directory</b><br/>[Container: files, .sdods/runs]<br/>NDJSON, screenshots, traces")]:::container
  end

  subgraph hosted["sdods.com [Hosted]"]
    direction TB
    www["<b>www and docs</b><br/>[Container: Next.js static export, Firebase Hosting]"]:::container
    maxi["<b>Maxi</b><br/>[Container: Node 22, Fastify on Cloud Run]<br/>docs assistant grounded in the docs"]:::container
  end

  tollgate["<b>Tollgate</b><br/>[External: Yarlis deploy control plane]<br/>YarlisAISolutions/sdods-deploy, private"]:::external
  aut["<b>Application under test</b><br/>[External] in Playwright browsers"]:::external
  gh["<b>GitHub · Jira</b><br/>[External]"]:::external
  llm["<b>LLM providers</b><br/>[External]"]:::external

  people -->|"commands"| cli
  people -->|"HTTPS"| web
  people -.->|"one click"| desktop
  ai -->|"MCP"| mcp
  desktop -->|"starts"| server
  web -->|"REST + SSE"| server
  server -->|"spawns runs and agent jobs"| cli
  server -->|"hosts /mcp"| mcp
  server --> db
  cli -->|"bddgen, playwright test"| core
  cli -->|"ingests the run"| db
  cli -->|"notify"| integ
  mcp -->|"runs sdods commands"| cli
  mcp -->|"reads results"| runs
  cli -->|"sdods agent"| agents
  agents -->|"tools"| mcp
  agents -->|"prompts"| llm
  core -->|"browser and HTTP"| aut
  core -->|"writes"| runs
  integ -->|"check runs, issues"| gh
  www -->|"chat widget"| maxi
  maxi -->|"prompts"| llm
  tollgate -.->|"deploys"| www
  tollgate -.->|"deploys"| maxi

  classDef person fill:#FFB020,stroke:#B87800,color:#0B1020
  classDef system fill:#1E3FB8,stroke:#FFB020,stroke-width:3px,color:#FFFFFF
  classDef container fill:#2F5BFF,stroke:#1E3FB8,color:#FFFFFF
  classDef component fill:#DCE4FF,stroke:#2F5BFF,color:#0B1020
  classDef external fill:#64748B,stroke:#475569,color:#FFFFFF
  style sdods fill:none,stroke:#FFB020,stroke-width:2px,stroke-dasharray:6 4
  style hosted fill:none,stroke:#94A3B8,stroke-width:2px,stroke-dasharray:6 4
```

### Level 3: Components of the runtime

Inside `@sdods/core`, which a `sdods run` executes on Playwright workers.

```mermaid
flowchart LR
  cli["<b>CLI</b><br/>[Container: Node 22, commander]"]:::container

  subgraph core["@sdods/core [Container: runtime on Playwright + playwright-bdd]"]
    direction LR
    config["<b>Config</b><br/>[Component: Zod]<br/>six-layer precedence, ProjectRegistry,<br/>runner config per project × layer × browser"]:::component
    lint["<b>Lint · Analyze</b><br/>[Component]<br/>tag taxonomy, Gherkin,<br/>framework, routes, OpenAPI"]:::component
    matrix["<b>Matrix</b><br/>[Component]<br/>--project-matrix expansion"]:::component
    fixtures["<b>Fixtures</b><br/>[Component]<br/>one merged test: api · pages · data<br/>user · shots · heal"]:::component
    steps["<b>Step library</b><br/>[Component]<br/>HTTP, UI, data, email, a11y, perf, mocks"]:::component
    pages["<b>Pages + Healer</b><br/>[Component]<br/>page objects, scored locators, heal history"]:::component
    api["<b>ApiClient · Auth</b><br/>[Component]<br/>requests, schema checks, login state"]:::component
    data["<b>DataProvider · UserPool</b><br/>[Component]<br/>CSV, JSON, YAML, DB, faker, leases"]:::component
    shots["<b>ScreenshotNarrator</b><br/>[Component]<br/>before/after policy, visual baselines"]:::component
    rec["<b>Recorder · HAR</b><br/>[Component]<br/>codegen, record and replay"]:::component
    mail["<b>Mail</b><br/>[Component]<br/>Mailpit inbox"]:::component
    load["<b>Load</b><br/>[Component]<br/>generated k6 scripts"]:::component
    reporters["<b>Reporters · Evidence</b><br/>[Component]<br/>dashboard, zips, trace redaction"]:::component
  end

  ext["<b>Mailpit · k6</b><br/>[External]"]:::external
  pw["<b>Browsers · app under test</b><br/>[External]"]:::external
  db[("<b>@sdods/db</b><br/>[Container: SQLite ⇄ Postgres]<br/>ingest · insights · migrations")]:::container

  cli --> config & lint & matrix & rec & load
  cli -->|"ingests the run"| db
  config --> fixtures
  fixtures --> steps & pages & api & data & shots
  steps --> mail
  pages & api -->|"drive"| pw
  mail & load --> ext
  data -.->|"DB datasets, leases"| db
  shots --> reporters
  rec --> pw

  classDef person fill:#FFB020,stroke:#B87800,color:#0B1020
  classDef system fill:#1E3FB8,stroke:#FFB020,stroke-width:3px,color:#FFFFFF
  classDef container fill:#2F5BFF,stroke:#1E3FB8,color:#FFFFFF
  classDef component fill:#DCE4FF,stroke:#2F5BFF,color:#0B1020
  classDef external fill:#64748B,stroke:#475569,color:#FFFFFF
  style core fill:none,stroke:#FFB020,stroke-width:2px,stroke-dasharray:6 4
```

### Level 3: Components of the server

Inside `@sdods/server`, which turns HTTP requests and cron schedules into CLI runs.

```mermaid
flowchart TB
  web["<b>Web UI</b><br/>[Container: React SPA]"]:::container
  mcpc["<b>MCP clients</b><br/>[External]"]:::external

  subgraph server["@sdods/server [Container: Fastify 5]"]
    direction LR
    plugins["<b>Plugins</b><br/>[Component]<br/>auth: sessions, CSRF, scoped tokens<br/>db · mcp · sse · static reports"]:::component
    routes["<b>Routes</b><br/>[Component]<br/>auth · hierarchy · projects<br/>runs · schedules · agents"]:::component
    runmgr["<b>RunManager</b><br/>[Component]<br/>spawns sdods run, buffers logs"]:::component
    sched["<b>Scheduler</b><br/>[Component: croner]<br/>cron schedules to runs"]:::component
    agentmgr["<b>AgentManager</b><br/>[Component]<br/>spawns sdods agent jobs"]:::component
    diff["<b>Image diff</b><br/>[Component: pixelmatch]<br/>before/after pixel diff"]:::component
  end

  cli["<b>CLI</b><br/>[Container: Node 22, commander]"]:::container
  db[("<b>@sdods/db</b><br/>[Container: SQLite ⇄ Postgres]<br/>ingest · insights · migrations")]:::container

  web -->|"REST + SSE"| routes
  mcpc -->|"/mcp"| plugins
  routes --> runmgr & agentmgr & diff
  sched -->|"due schedules"| runmgr
  runmgr & agentmgr -->|"spawn"| cli
  plugins -->|"sessions, tokens, history"| db

  classDef person fill:#FFB020,stroke:#B87800,color:#0B1020
  classDef system fill:#1E3FB8,stroke:#FFB020,stroke-width:3px,color:#FFFFFF
  classDef container fill:#2F5BFF,stroke:#1E3FB8,color:#FFFFFF
  classDef component fill:#DCE4FF,stroke:#2F5BFF,color:#0B1020
  classDef external fill:#64748B,stroke:#475569,color:#FFFFFF
  style server fill:none,stroke:#FFB020,stroke-width:2px,stroke-dasharray:6 4
```

The package graph (`contracts → core → db → mcp → integrations → agents → server → web`, with the CLI importing each lazily) is acyclic and enforced by TypeScript project references. Details, decisions and trade-offs live in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), and the same diagrams are on the [architecture page](https://docs.sdods.com/docs/architecture/) of the docs.

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
| `@locale:fr-FR` `@timezone:Asia/Tokyo` `@theme:dark` `@viewport:320x640` `@device:iPhone-15` | per-scenario browser emulation, over the env's `use:` block |
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
claude mcp add sdods -- npx -y @sdods/cli mcp --project demo-shop --env staging   # stdio
sdods mcp install claude|codex|cursor|vscode|windsurf                         # registers the server with the client
sdods mcp --http --port 4001                                                  # streamable HTTP with scoped tokens
```

Tool families: `project_*`, `analyze_*` (framework, routes, OpenAPI, locators audit, coverage, best practices, change impact, failure analysis), `feature_*`/`step_*`, `run_*`, `data_*`, `heal_*`/`insights_*`, `record_*`, `agent_*`/`proposal_*`, `issue_*`, `schedule_*`. `browser_*` wraps every tool of the bundled Playwright MCP server, bound to a project and environment: the session carries the project's test-id attribute and login state, artifacts land in the run directory, credential headers are redacted, and the two code-execution tools need an explicit opt-in.

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

Every command supports `--json`, `--quiet`, `--verbose`, `--cwd`, `--no-color`. Exit codes: `0` ok, `1` test failures, `2` config or usage error, `3` lint errors, `130` cancelled. `sdods <command> --help` prints the full option list for any of them.

### 1. Start a new project

In order. Each step assumes the one above it.

```bash
sdods init ~/my-tests                 # workspace yaml, runner config, demo project, skills
cd ~/my-tests
sdods doctor                          # Node, bun, browsers, projects, env vars, database
sdods browsers install -b chromium    # engines are a separate download; every layer, API included, launches one
sdods project create checkout         # a project is one app under test
sdods env add staging -p checkout --ui-url https://staging.example.com --api-url https://api.staging.example.com
sdods config show -p checkout -e staging --explain    # what resolved, and which file won
```

### 2. Onboard an application you already have

`analyze` reads a repository and proposes a project from what it finds — routes, API endpoints, test-id attributes. It is read-only until you pass `--apply`.

```bash
sdods analyze /path/to/your-app                # propose, change nothing
sdods analyze /path/to/your-app --apply        # write the project
sdods steps list -p <slug>                     # the vocabulary you can write with
sdods coverage -p <slug>                       # routes, endpoints and roles with no scenarios yet
```

### 3. Write, check, run

The inner loop. `lint` before `run` — it is far cheaper and catches tag and step mistakes.

```bash
sdods lint -p <slug>                                        # Gherkin, tag taxonomy, undefined steps
sdods run -p <slug> -e staging --list                       # what would run, without running it
sdods run -p <slug> -e staging -l api                       # API layer, no browser
sdods run -p <slug> -e staging -l ui -b chromium -t @smoke  # UI smoke
sdods run -p <slug> -e staging -t @regression --project-matrix   # every browser in the yaml
sdods watch -p <slug> -e staging                            # regenerate and re-run on change
```

### 4. Read the results

```bash
sdods report --last                    # totals, failures, flaky, artifact paths
sdods report --last --open             # HTML report and dashboard
sdods trace --last                     # Playwright trace viewer
sdods show-report --last               # just the HTML report
```

### 5. Heal, and learn from history

`heal` reports locators that drifted and were recovered at runtime; `insights` aggregates across runs so you fix causes rather than symptoms.

```bash
sdods heal report --last                       # locators healed in the last run
sdods heal report --all                        # aggregate every run: what keeps drifting
sdods heal report --last --write-history       # bias future heals toward what worked
sdods insights compute -p <slug>               # crunch the run history
sdods insights show -p <slug>                  # flakiness, locator fragility, suite health
sdods agent heal -p <slug> --scenario <fingerprint> --dry-run   # propose the smallest fix
```

### 6. Record and replay

```bash
sdods record -p <slug> -e staging --user admin --name checkout-flow   # capture a session
sdods har record -p <slug> -e staging                                 # capture network
sdods har replay --strict                                             # run offline against the capture
sdods auth capture -p <slug> -e staging --user admin                  # store login state for a pool user
```

### 7. Data and database

```bash
sdods data import users users.csv -p <slug>    # <dataset> <file>: CSV, JSON or YAML
sdods data preview users.csv                   # first rows, as the runner will see them
sdods data list -p <slug>
sdods data seed -p <slug> -e staging
sdods db migrate                               # platform database
sdods db status
sdods db sync                                  # upsert orgs, workspaces, projects from the yaml
sdods db switch postgres                       # SQLite <-> Postgres (target is positional)
```

### 8. The web UI and the platform

```bash
sdods users create --admin --username admin --password '<8+ chars>'
sdods serve --open                             # http://127.0.0.1:4444
sdods tokens create --scopes run:read,run:write   # free, scoped, revocable
sdods schedule add -p <slug> --name nightly --cron '0 3 * * *' -t @regression
sdods integrations test github
```

First run with no users prints a one-time `/setup?token=…` URL; open it to create the admin in the browser instead. Full detail, including every OS: the `sdods-start-ui` skill.

### 9. Agents and MCP

Agents never edit your working tree — they write proposals a person accepts.

```bash
sdods agent plan|generate|heal|upgrade|review -p <slug> --dry-run
sdods proposals list
sdods proposals show <id>
sdods proposals accept <id>                    # or reject
sdods mcp install claude|codex|cursor|vscode|windsurf
sdods mcp --http --port 4001                   # streamable HTTP with scoped tokens
```

### 10. Keep it current

`upgrade` checks the npm registry for newer `@sdods/*` packages and, with `--apply`, installs them with whichever package manager your lockfile implies.

```bash
sdods upgrade                          # report what is behind
sdods upgrade --apply                  # install the latest @sdods/* packages
sdods browsers install --with-deps     # refresh engines after an upgrade (Linux needs root)
sdods doctor                           # confirm the result
```

Full reference with examples: <https://docs.sdods.com>.

## Development process

```bash
bun install && sdods browsers install --with-deps
bun run typecheck        # tsc -b across packages
bun run lint             # eslint + prettier
bun run test             # vitest unit tests
bun run sdods lint -p demo-shop
bun run sdods run -p demo-shop -e staging -l api
bun run release:check    # demo suite on every browser, offline via HAR
bun run roadmap:sync     # rewrite the roadmap block in this README from packages/roadmap
```

- Branch from `main`, keep commits focused, and add or update tests with every change.
- CI runs lint, typecheck, unit tests, the demo suite on chromium (PRs) and the full browser matrix nightly.
- Versioning uses changesets. `@sdods/cli` 0.8.0 and the other `@sdods/*` packages are on npm, releases are tagged on GitHub, and the server image is on GHCR.
- Security issues: see [SECURITY.md](SECURITY.md).
- Contributing: see [CONTRIBUTING.md](CONTRIBUTING.md); issues and discussions live at [YarlisAISolutions/SDODS](https://github.com/YarlisAISolutions/SDODS).
- Deployment: sdods.com, docs.sdods.com and api.sdods.com are deployed by Tollgate, the Yarlis deploy control plane, from a private companion repository (YarlisAISolutions/sdods-deploy). This public repository builds, tests and publishes packages; it holds no production credentials.

## Roadmap and status

Implementation follows the phased plan in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Each phase ends runnable.

<!-- roadmap:start — generated by scripts/sync-roadmap.ts. Do not edit. -->

Delivered, as five chapters. Every phase inside them ends runnable.

| Chapter | Phases | What it delivered |
|---|---|---|
| Foundations | 0, 1 | One command runs a scenario |
| The browser | 2, 3, 4 | A UI failure explains itself |
| Memory | 5, 6 | Runs stop depending on one laptop |
| Agents | 7, 8 | The suite becomes something an agent can read |
| A platform | 9, 10, 11, 12, 13 | A team, not a script |

The twelve months, in the order they land. A delivered month lists what actually shipped.

| When | Checkpoint | Status |
|---|---|---|
| Oct 2026 | Every claim on this site is true | Delivered |
| Nov 2026 | A first real release | Delivered |
| Dec 2026 | CI and your laptop agree about a screenshot | Delivered |
| Jan 2027 | A suite that runs with the network unplugged | In progress |
| Feb 2027 | Flake becomes a number, not an argument | Planned |
| Mar 2027 | One sign-in for the whole team | Planned |
| Apr 2027 | History leaves the laptop | Planned |
| May 2027 | Runs that know what changed | Planned |
| Jun 2027 | Agents open pull requests | Planned |
| Jul 2027 | One incident is one item | Planned |
| Aug 2027 | Coverage measured against reality | Planned |
| Sep 2027 | 1.0, with a promise attached | Planned |

Verified on 2026-09-15: unit and cli end-to-end tests 1391 passed, 1 skipped; web ui component tests 15 passed; demo api layer, no browser 10 passed, 0 failed; types, lint and formatting clean; linux visual, accessibility and performance suites @regression green on chromium, firefox and webkit; documentation build 4434 internal links across 100 pages, 0 broken.

The full road — the chapters, the twelve months and the horizon to 2030 — is at
<https://docs.sdods.com/docs/roadmap/>.

<!-- roadmap:end -->

<!-- sponsor: shown once SPONSOR_ENABLED is on (packages/contracts/src/sponsor.ts)
## Support SDODS

SDODS is free and stays free. If it saves you time, [buy the maintainers a coffee or sponsor the project](https://sdods.com/sponsor/): one-time or monthly, any amount. Companies that want an invoice, a bank transfer or their logo here can email admin@sdods.com.
-->

## License

Apache-2.0. Copyright © 2026 Yarlis AI Solutions and SDODS contributors.
