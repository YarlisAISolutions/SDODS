# @sdods/agents

## 0.12.1

### Patch Changes

- @sdods/contracts@0.12.1
  - @sdods/mcp@0.12.1

## 0.12.0

### Patch Changes

- @sdods/contracts@0.12.0
  - @sdods/mcp@0.12.0

## 0.11.3

### Patch Changes

- @sdods/contracts@0.11.3
  - @sdods/mcp@0.11.3

## 0.11.2

### Patch Changes

- @sdods/contracts@0.11.2
  - @sdods/mcp@0.11.2

## 0.11.1

### Patch Changes

- 835d64c: Repository metadata moved to the YarlisAISolutions organisation: `repository.url` and `bugs.url` now point at https://github.com/YarlisAISolutions/SDODS, `sdods feedback` opens issues there, and the documented server image is `ghcr.io/yarlisaisolutions/sdods-server`.
- Updated dependencies [835d64c]
  - @sdods/contracts@0.11.1
  - @sdods/mcp@0.11.1

## 0.11.0

### Patch Changes

- @sdods/contracts@0.11.0
  - @sdods/mcp@0.11.0

## 0.10.0

### Patch Changes

- 497222e: Dependencies moved to their latest compatible releases: zod 4.6, yaml 2.9.1, fastify 5.12.4, `@axe-core/playwright` 4.13 (axe-core 4.13 rules), `@anthropic-ai/sdk` 0.125, `@anthropic-ai/claude-agent-sdk` 0.3.272, playwright-bdd 9.2.1 and tar 7.5.22. The installer now pins Bun 1.4.2.
  
  Tooling moves to TypeScript 6.0 and ESLint 10, and `fastify-plugin` to 6. Errors re-thrown from a caught failure (JSON bodies that do not parse after templating, GitHub evidence updates, an OpenAI-compatible server that does not answer) now carry the original error as `cause`.
  
  `sdods init` scaffolds projects on TypeScript 6.0, playwright-bdd 9.2.1 and tsx 4.23.13, and the workflow `sdods schedule` generates uses `actions/checkout@v7`, `actions/setup-node@v7` and `actions/upload-artifact@v7`.
- Updated dependencies [497222e]
- Updated dependencies [4975711]
  - @sdods/contracts@0.10.0
  - @sdods/mcp@0.10.0

## 0.9.0

### Patch Changes

- Updated dependencies [47ac9e2]
- Updated dependencies [dd24cdb]
- Updated dependencies [3fb1773]
  - @sdods/contracts@0.9.0
  - @sdods/mcp@0.9.0

## 0.8.0

### Patch Changes

- Updated dependencies [4c00473]
- Updated dependencies [842a700]
- Updated dependencies [8611552]
- Updated dependencies [f950986]
- Updated dependencies [8611552]
- Updated dependencies [00930d0]
- Updated dependencies [8611552]
- Updated dependencies [b0ae3b9]
- Updated dependencies [0cc05cb]
- Updated dependencies [509b2c8]
- Updated dependencies [85ac708]
  - @sdods/contracts@0.8.0
  - @sdods/mcp@0.8.0

## 0.7.3

### Patch Changes

- @sdods/contracts@0.7.3
  - @sdods/mcp@0.7.3

## 0.7.2

### Patch Changes

- Updated dependencies [0865fee]
  - @sdods/mcp@0.7.2
  - @sdods/contracts@0.7.2

## 0.7.1

### Patch Changes

- Updated dependencies [805752a]
  - @sdods/contracts@0.7.1
  - @sdods/mcp@0.7.1

## 0.7.0

### Patch Changes

- 5b69426: SDODS for AI coding tools.
  
  - `sdods skills list` and `sdods skills install [--agent claude,agents,cursor,copilot,gemini] [--global]` copy the bundled Agent Skills (`sdods`, `sdods-run`, `sdods-record`, `sdods-start-ui`) to where Claude Code, Codex, Cursor, Copilot and Gemini CLI read them; `npx -y @sdods/cli skills install` needs no global install. `sdods init` installs the same set into `.claude/skills` and `.agents/skills`, and no longer copies SDODS's own release skills.
  - `sdods mcp install gemini` writes `.gemini/settings.json`.
  - Every stdio snippet now launches `npx -y @sdods/cli mcp`. `npx sdods mcp` pointed at a package that does not exist, so clients configured from `mcp install --file`, `agent install`, the web UI or `/api/mcp/info` failed with CONNECTION_CLOSED outside a checkout.
  - `sdods mcp install claude|codex --http-url` passes the bearer token (`${SDODS_TOKEN}` / `--bearer-token-env-var SDODS_TOKEN`); before, both registered a server that answered 401.
  - `sdods mcp install windsurf` writes Windsurf's real config, `~/.codeium/windsurf/mcp_config.json`, with `serverUrl` for remote servers.
- Updated dependencies [5b69426]
  - @sdods/mcp@0.7.0
  - @sdods/contracts@0.7.0

## 0.6.0

### Patch Changes

- @sdods/contracts@0.6.0
  - @sdods/mcp@0.6.0

## 0.5.2

### Patch Changes

- Updated dependencies [45a38a8]
  - @sdods/contracts@0.5.2
  - @sdods/mcp@0.5.2

## 0.5.1

### Patch Changes

- Updated dependencies [bd833e1]
  - @sdods/contracts@0.5.1
  - @sdods/mcp@0.5.1

## 0.5.0

### Patch Changes

- Updated dependencies [f179b8e]
  - @sdods/contracts@0.5.0
  - @sdods/mcp@0.5.0

## 0.4.0

### Patch Changes

- 4abc389: Close access-control holes in the server and in agent jobs.
  
  - Run ids `.` and `..` are refused. The router decodes `%2E%2E` before the id check ran, so `GET /api/runs/%2E%2E/files/sdods.db` returned the platform database to anyone with `artifacts:read`.
  - Run files, trees, comparisons, artifacts and HTML reports check the caller's workspace role for the run's project (from the database, a live job, or the run's `run.json`). `/reports/*` sat outside `/api/` and needed no session at all. Ingest refuses to write into a run, or file a manifest under a project, the caller cannot edit.
  - HTML, SVG and XML served from run directories carry `Content-Security-Policy: sandbox` and `nosniff`, so an uploaded page runs with an opaque origin instead of the viewer's session. Uploaded `artifacts.tgz` archives can no longer write `html-report/`, which is served unsandboxed because the Playwright report needs `localStorage`.
  - The auth gate matches the routed path. `/%61pi/tokens` reached `/api/tokens` while skipping authentication and the CSRF check.
  - Sign-ins are throttled per username as well as per IP. `trustProxy` is now `SDODS_TRUST_PROXY` (default `false`); it was always on, so a forged `X-Forwarded-For` gave every guess a fresh address. The Cloud Run deploy sets it to `true`.
  - Agent job `plan` and `spec` must be regular files inside the project, outside dotfiles and hidden directories. They were read verbatim, so `spec: "/proc/self/environ"` streamed the server's environment back through the job log.
  - Agent CLIs (claude-code, codex) start the sdods MCP server without the `agents` capability and disallow `proposal_accept` / `proposal_reject`, so a job can no longer accept its own proposal. Claude Code is limited to the role's tools. Playwright's own MCP server is no longer attached by default, and the bridge used by the OpenAI-compatible and Ollama adapters drops `browser_run_code_unsafe`, `browser_run_code` and `browser_evaluate` from it.
  - `sdods config show` (plain, `--json`, `--explain`) masks header-auth values and credential-looking headers such as `X-Api-Key`; `--explain` reads from the same redacted tree instead of a weaker regex of its own.
- @sdods/contracts@0.4.0
  - @sdods/mcp@0.4.0

## 0.3.2

### Patch Changes

- @sdods/contracts@0.3.2
  - @sdods/mcp@0.3.2

## 0.3.1

### Patch Changes

- Updated dependencies [77c4a03]
  - @sdods/contracts@0.3.1
  - @sdods/mcp@0.3.1

## 0.3.0

### Patch Changes

- @sdods/contracts@0.3.0
  - @sdods/mcp@0.3.0
