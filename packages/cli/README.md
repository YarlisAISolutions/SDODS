# @sdods/cli

SDODS is an automation platform for BDD testing: UI, API and hybrid flows, with
self-healing locators, data-driven scenarios, an MCP server and AI agents.

```bash
npm i -g @sdods/cli     # or: bun add -g @sdods/cli
sdods init ~/my-tests   # scaffolds a workspace, demo project included
cd ~/my-tests
sdods run -p demo-shop -e staging -l api
```

Or install everything, browsers included, with one command:

```bash
curl -fsSL https://sdods.com/install.sh | sh
```

Documentation: https://docs.sdods.com
