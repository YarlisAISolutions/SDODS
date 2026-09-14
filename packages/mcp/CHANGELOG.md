# @sdods/mcp

## 0.7.1

### Patch Changes

- Updated dependencies [805752a]
  - @sdods/contracts@0.7.1

## 0.7.0

### Minor Changes

- 5b69426: SDODS for AI coding tools.
  
  - `sdods skills list` and `sdods skills install [--agent claude,agents,cursor,copilot,gemini] [--global]` copy the bundled Agent Skills (`sdods`, `sdods-run`, `sdods-record`, `sdods-start-ui`) to where Claude Code, Codex, Cursor, Copilot and Gemini CLI read them; `npx -y @sdods/cli skills install` needs no global install. `sdods init` installs the same set into `.claude/skills` and `.agents/skills`, and no longer copies SDODS's own release skills.
  - `sdods mcp install gemini` writes `.gemini/settings.json`.
  - Every stdio snippet now launches `npx -y @sdods/cli mcp`. `npx sdods mcp` pointed at a package that does not exist, so clients configured from `mcp install --file`, `agent install`, the web UI or `/api/mcp/info` failed with CONNECTION_CLOSED outside a checkout.
  - `sdods mcp install claude|codex --http-url` passes the bearer token (`${SDODS_TOKEN}` / `--bearer-token-env-var SDODS_TOKEN`); before, both registered a server that answered 401.
  - `sdods mcp install windsurf` writes Windsurf's real config, `~/.codeium/windsurf/mcp_config.json`, with `serverUrl` for remote servers.

### Patch Changes

- @sdods/contracts@0.7.0

## 0.6.0

### Patch Changes

- @sdods/contracts@0.6.0

## 0.5.2

### Patch Changes

- Updated dependencies [45a38a8]
  - @sdods/contracts@0.5.2

## 0.5.1

### Patch Changes

- Updated dependencies [bd833e1]
  - @sdods/contracts@0.5.1

## 0.5.0

### Patch Changes

- Updated dependencies [f179b8e]
  - @sdods/contracts@0.5.0

## 0.4.0

### Patch Changes

- @sdods/contracts@0.4.0

## 0.3.2

### Patch Changes

- @sdods/contracts@0.3.2

## 0.3.1

### Patch Changes

- Updated dependencies [77c4a03]
  - @sdods/contracts@0.3.1

## 0.3.0

### Patch Changes

- @sdods/contracts@0.3.0
