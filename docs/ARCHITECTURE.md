# SDODS architecture

This document explains how SDODS is put together, why, and what each package owns. It is the reference for contributors; the user-facing guides live on the documentation site.

## 1. Principles

1. **CLI-first.** Every capability is a `sdods` command that works with no server and no database. The web UI, the MCP server and the scheduler spawn those commands and stream their output. CI therefore needs nothing but Node and the repo.
2. **One merged test object.** UI, API, data, user, screenshot and heal fixtures are all on the same playwright-bdd `test`, so a scenario can mix layers (seed via API, assert in the browser). The reference framework this replaces had two `test` objects and could not.
3. **Projects are directories.** `projects/<slug>/sdods.project.yaml` plus `envs/<env>.yaml` describe everything; the root `playwright.config.ts` is generated from a registry, per project × layer × browser.
4. **Explainable configuration.** Six layers with fixed precedence, Zod-validated, provenance recorded per key, secrets only through `${VAR}`.
5. **Runner never needs the platform.** The database is used only when a scenario asks for DB data or leases, or when ingest is enabled.
6. **Agents propose, humans apply.** AI roles can read, run and drive a browser, but their only write path is a proposal directory reviewed in the UI or the CLI.
7. **Node executes, Bun accelerates.** Playwright workers, vitest and native drivers run on Node 22. Bun is the package manager, script runner and bundler. pnpm remains compatible.

## 2. Package graph

```
contracts → core → db → mcp → integrations → agents → server → web
                         cli ─┘ (depends on all, imports lazily)
```

| Package | Owns | Never imports |
|---|---|---|
| `@sdods/contracts` | Zod schemas for project/env yaml, ids (fingerprint, uuid v7, Playwright project naming), attachment naming, scopes/roles, DTO types | anything else in the repo |
| `@sdods/core` | config precedence, `ProjectRegistry`, `buildRunnerConfig`, merged fixtures, step libraries, `DataProvider` + `UserPool`, `ScreenshotNarrator`, `Healer`, recorder/HAR/auth capture, lint, analyze, reporters, insights math | `db` statically (lazy `import('@sdods/db')` in the db fixture and loader) |
| `@sdods/db` | Kysely `Database` interface, driver factory (`DB_DRIVER`), `col()` dialect helper, migrations, repos, NDJSON and PW-json ingest, `db switch` | server, web |
| `@sdods/mcp` | `ToolRegistry` (one definition → MCP server, Agent SDK tools, OpenAI functions), tools, resources, prompts, stdio and HTTP transports | agents |
| `@sdods/integrations` | `IntegrationProvider`, GitHub and Jira providers, issue dedupe | server |
| `@sdods/agents` | `LlmAdapter`, Claude/OpenAI-compatible/Fake adapters, roles, proposals, jobs | server |
| `@sdods/server` | Fastify app: REST, SSE, `/mcp`, sessions, roles, API tokens, run manager, scheduler, static reports and trace viewer | web (serves its build output only) |
| `@sdods/web` | React app | node-only packages (type-only imports of server schemas) |
| `@sdods/cli` | commander program; each command imports its implementation lazily | — |

TypeScript project references enforce the graph; a cycle fails `tsc -b`.

## 3. Runtime flow of `sdods run`

1. Parse flags into `CliOverrides`; mint `runId` (UUID v7) unless `--run-id`; create `.sdods/runs/<runId>/` and write `run.json`.
2. Lint the project's features (tag taxonomy, Gherkin syntax) unless `--no-lint`.
3. Export `SDODS_PROJECT`, `SDODS_ENV`, `SDODS_TAGS`, `SDODS_LAYERS`, `SDODS_BROWSERS`, `SDODS_RUN_ID`, `SDODS_CLI_OVERRIDES` and spawn `bddgen` against the root `playwright.config.ts`.
4. Compute the Playwright project names in-process with the same builder and spawn `playwright test --project <name>…` with the remaining flags.
5. On exit: ingest NDJSON and artifacts if a database is configured, run integration notifications, print the summary, exit with Playwright's code.

`sdods.runner.config.ts` calls `buildRunnerConfig(ProjectRegistry.discover(root), selection)`. For each project and layer it calls `defineBddConfig` once (`features`, `steps` = core glob + project glob, `outputDir: .sdods/generated/<slug>/<layer>`, `importTestFrom: projects/<slug>/steps/fixtures.ts`, `tags: (@<layer>) and (<expr>)`); browsers reuse the returned `testDir`. Project names are `<slug>--<layer>--<browser>`; the `sdods` option on `use` tells workers their identity.

## 4. Fixtures

Worker scope: `sdods` (identity), `registry`, `config`, `env`, `runDir`, `auth` (strategy, project-overridable), `userPool`, `authCache`, `db` (lazy), `healHistory`, `harMode`.

Test scope: `scenario` (meta + directory), `apiContext` (last response, vars, headers, history), `api` (`ApiClient`), `data` (`DataProvider` with cleanup registry), `user` (leased when `@user:<role>` is present), `storageState` override (cached login for the leased user), `pages` (page-object registry), `shots` (narrator), `heal` (healer).

Screenshot hooks are registered with `tags: '@ui or @hybrid'` so API scenarios never instantiate a page.

## 5. Identifiers and files

- **Fingerprint**: `sha256(project, featureUri, scenarioName, exampleIndex, layer)[0:16]`. Browser excluded so one issue covers all browsers; flaky stats add the Playwright project name.
- **Run directory**: `.sdods/runs/<runId>/{run.json, messages.ndjson, pw-results.json, playwright-report/, dashboard/, <slug>/<fingerprint>/r<retry>/…}`.
- **Attachments**: `sdods/shot/step/<NN>/before|after`, `sdods/shot/scenario/start|end|failure`, `sdods/visual/<NN>/<name>`, `sdods/api/<NN>/<n>/request|response`, `sdods/heal/<NN>/<n>`, `sdods/perf/<NN>`, `sdods/meta`. The DB ingest parses exactly these names.

## 6. Data and users

`DataProvider` resolves a dataset per environment: `{env}` substitution → `data/<env>/<file>` → `fallback` → `data/common/<file>`. Loaders: CSV (`csv-parse`), JSON, YAML, DB table (Kysely), faker factories (seeded by fingerprint), OpenAPI examples.

`UserPool` partitions the pool dataset by role and caps it with `users.poolSize` from the env. Leases are keyed by `runId:shardOffset+parallelIndex`; the file store uses `O_EXCL` lock files with TTL, the DB store a single conditional insert. `AuthStateCache` stores `storageState` per user under `projects/<slug>/.auth/<env>/`.

## 7. Self-healing

`Healer.resolve(primary, context, action)` waits for the primary locator briefly, then probes all candidates built from the context (role+name, test id, label, placeholder, exact text, partial text, CSS fallbacks) in parallel under one deadline, scores by base weight × uniqueness × visibility × enabled state plus a history bonus, and picks the best above `minScore`. Negative assertions are never healed. Events are attached, appended to `heal.jsonl`, and ingested into `heal_events`/`locator_stats`; repeated identical heals produce page-object patch proposals.

## 8. Platform

- **Database**: Kysely with `PostgresDialect` or `SqliteDialect`. All primary keys are app-generated UUID v7 text, so `sdods db switch` is a verified row copy. Test-data tables use the `td_<slug>_<name>` prefix on both dialects.
- **Ingest**: cucumber `message` NDJSON (canonical) and Playwright JSON (recorded layer). Scenarios are counted, not attempts; attempts are kept. Idempotent by natural keys; shards merge.
- **Server**: Fastify 5 with session cookies (argon2), CSRF for sessions, bearer API tokens (sha256, scoped, free), roles viewer/editor/admin, SSE for logs, `/mcp` streamable HTTP, static Playwright report and trace viewer, `RunManager` and `croner` scheduler.
- **MCP**: one `ToolRegistry`; tools grouped `project_`, `analyze_`, `feature_`/`step_`, `run_`, `data_`, `heal_`/`insights_`, `record_`, `agent_`/`proposal_`, `issue_`, `schedule_`; capability flags; annotations; structured results.
- **Agents**: `LlmAdapter` with Claude (Agent SDK + bundled Playwright MCP), OpenAI-compatible and Fake implementations; roles planner, generator, healer, upgrader, reviewer; proposals with manifest and verification.
- **Integrations**: `IntegrationProvider` with GitHub (check runs, PR comment, issues) and Jira (issues with attachments, links, transitions); dedupe by fingerprint.

## 9. Phases

| # | Phase | Ends with |
|---|---|---|
| 0 | Skeleton and config | `sdods project list`, `config show --explain`, unit tests |
| 1 | API layer | `sdods run -l api` with no browser |
| 2 | UI layer, POMs, heal, dashboard | `run -l ui -b chromium -t @smoke`, heal report |
| 3 | Data, pool, auth, hybrid | data-driven, pool and hybrid demos |
| 4 | Screenshot narrator, NDJSON | before/after files per step |
| 5 | Database, ingest, switch | sqlite ⇄ postgres round trip |
| 6 | Recorder, HAR | offline runs |
| 7 | MCP | inspector lists tools; Claude Code drives runs |
| 8 | Agents, insights | fake-adapter proposals; golden metrics |
| 9 | Server | REST + SSE + `/mcp` + scheduler |
| 10 | Web UI | run viewer with before/after, editor |
| 11 | GitHub, Jira, CI | check runs, issues, matrix workflow |
| 12 | Analyze, matrix | `sdods analyze --apply`, `--project-matrix` |
| 13 | Docs site, packaging | Firebase Hosting, `sdods init`, Docker |

## 10. Measured numbers (Phase 0, macOS, Apple Silicon)

| Operation | Bun 1.4 | Notes |
|---|---|---|
| `bun install` (cold cache, 244 packages) | 3.8 s | pnpm comparison recorded when the full dependency set lands |
| `tsc -b` (contracts, core, cli) | < 3 s | |
| vitest (config suite, 10 tests) | 0.4 s | |
