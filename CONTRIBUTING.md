# Contributing to SDODS

Thank you for helping. SDODS is Apache-2.0 and welcomes issues, docs fixes and pull requests.

## Setup

```bash
git clone https://github.com/siri1410/SDODS.git && cd SDODS
bun install                      # pnpm install also works
npx playwright install --with-deps
bun run typecheck && bun run lint && bun run test
bun run sdods doctor
```

## Repository layout

- `packages/*` — the product, one package per responsibility (see `docs/ARCHITECTURE.md` for the graph).
- `projects/demo-shop` — the reference project; it doubles as the release acceptance suite and carries every tag in the taxonomy.
- `apps/docs` — the documentation site (Docusaurus).
- `docs/` — architecture notes and assets.

## Working agreements

1. **Tests with every change.** Unit tests in `packages/<name>/test`, CLI end-to-end tests under `tests/cli`, web tests as SDODS features under `packages/web/e2e`.
2. **Tag everything.** New demo scenarios carry one layer tag and one suite tag; `sdods lint` must pass.
3. **Keep the dependency graph acyclic.** `contracts → core → db → mcp → integrations → agents → server → web`.
4. **CLI-first.** A feature lands in the CLI (and MCP tool registry when relevant) before it gets a screen.
5. **No secrets in YAML.** Use `${VAR}`.
6. **Docs are code.** Update the relevant `apps/docs` page; examples marked `sdods-verify` are executed in CI.

## Pull requests

- Branch from `main`; one topic per PR.
- Run `bun run typecheck && bun run lint && bun run test` locally.
- Add a changeset (`bunx changeset`) when a package's behaviour changes.
- Describe the user-visible change and how you verified it.

## Reporting bugs

Include the `sdods` command, `sdods doctor --json` output, the run id, and the relevant part of `.sdods/runs/<runId>/run.log`.
