---
description: Check that SDODS is ready in this project — CLI, Node, browsers, workspace and MCP server — and fix what is missing.
argument-hint: '[project-slug]'
disable-model-invocation: true
---

Get SDODS working in the current project. Project hint from the user: $ARGUMENTS

1. Run `npx -y @sdods/cli doctor` (or `sdods doctor` if it is on PATH) and read every failed check.
2. If there is no `sdods.workspace.yaml` in this directory or above it, ask whether to scaffold one,
   then run `npx -y @sdods/cli init .` only after the user agrees. A directory that already has
   files needs `--force`; say so and confirm before adding it.
3. Confirm the `sdods` MCP server from this plugin is connected (`/mcp`). If it is not, run
   `npx -y @sdods/cli mcp --list-tools` to see the real error.
4. If browsers are missing, run `npx -y @sdods/cli browsers install chromium`.
5. List the projects (`project_list` tool, or `sdods project list`) and their environments.
6. Finish with the next commands that make sense here, for example `/sdods:run <project> <env> @smoke`.

Report what you checked, what you changed and anything that still needs the user.
