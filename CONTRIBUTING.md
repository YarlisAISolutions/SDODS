# Contributing to SDODS

Thank you for helping. SDODS is Apache-2.0 and welcomes issues, docs fixes and pull requests.

## Setup

```bash
git clone https://github.com/YarlisAISolutions/SDODS.git && cd SDODS
bun install                      # Bun 1.4 (packageManager in package.json); pnpm install also works
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
- Add a changeset (`bunx changeset`) when a published `@sdods/*` package's behaviour changes. The packages are versioned together (`fixed` in `.changeset/config.json`), so pick the bump for the change and the rest follow.
- Describe the user-visible change and how you verified it; the pull request template has the checklist.
- No DCO or CLA: you do not need to sign off commits. Contributions are accepted under Apache-2.0.

## Dependencies

Two things keep dependencies current, and they do not overlap:

- `.github/workflows/dependencies.yml` moves `@sdods/*` and Playwright on the 1st of the month (they travel with the Docker base image and the visual baselines) and posts a freshness report on the 15th.
- Dependabot (`.github/dependabot.yml`) opens grouped minor and patch updates for everything else, npm and GitHub Actions, on the 8th. It ignores what the workflow owns and the versions it holds back.

## Security

Report vulnerabilities privately, not in issues: see [SECURITY.md](SECURITY.md).

## Reporting bugs

Open an [issue](https://github.com/YarlisAISolutions/SDODS/issues/new/choose). Include the `sdods` command, `sdods doctor --json` output, the run id, and the relevant part of `.sdods/runs/<runId>/run.log`. Ideas and questions go to [Discussions](https://github.com/YarlisAISolutions/SDODS/discussions).
