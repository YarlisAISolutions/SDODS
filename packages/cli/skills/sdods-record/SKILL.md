---
name: sdods-record
description: Record a browser flow with SDODS for a given project, environment, user role and device, save it as a runnable spec, replay it, and optionally convert it into a Gherkin feature with reusable steps. Use when the user says "record", "codegen", "capture a flow", "re-record as <role>", or wants the same flow recorded across environments or users.
---

# SDODS record & playback skill

Re-runnable recipe. Ask for the parameters you do not have, then follow the steps. Never edit `main` directly; recordings land in `projects/<project>/recorded/` and conversions become proposals.

Commands below use `sdods`. Without a global install use `npx -y @sdods/cli` in its place; inside
an SDODS source checkout use `bun run sdods`.

## Parameters

| Name | Required | Example | Notes |
|---|---|---|---|
| `project` | yes | `demo-shop` | `sdods project list` shows slugs |
| `env` | yes | `staging`, `local` | `sdods env list -p <project>` |
| `name` | yes | `checkout-standard` | becomes `recorded/<name>.spec.ts`; include the role in the name |
| `role` | no | `standard`, `problem`, `admin` | leases a pool user of that role and starts logged in (storageState) |
| `url` | no | `/inventory.html` | route path or absolute URL to open first |
| `device` | no | `"iPhone 15"`, `"Pixel 7"` | device name for mobile emulation |
| `browser` | no | `chromium` (default), `firefox`, `webkit` | |
| `har` | no | `true` | also capture network into `har/<env>/<name>.har` for offline replay |

## Steps

1. **Check the environment** (fail fast on missing vars):
   ```bash
   sdods doctor -p <project>
   sdods env list -p <project>
   ```
2. **Make sure the role has login state** (skip when no role):
   ```bash
   sdods auth list -p <project> -e <env>
   sdods auth capture -p <project> -e <env> --user <role>      # only if missing or expired
   ```
3. **Record** (opens the recorder; the person performs the flow and closes the window):
   ```bash
   sdods record -p <project> -e <env> --name <name> [--user <role>] [--url <url>] [--device "<device>"] [--browser <browser>] [--save-har]
   ```
   Output: `projects/<project>/recorded/<name>.spec.ts`, post-processed (SDODS fixtures, routes instead of absolute URLs, tags `@recorded @ui @regression`, header comment with project/env/role/device).
4. **Play it back** on the same environment, then on another one:
   ```bash
   sdods run -p <project> -e <env> -l recorded --grep "<name>"
   sdods run -p <project> -e <other-env> -l recorded --grep "<name>"
   ```
   Look at `.sdods/runs/<runId>/` for screenshots and the HTML report (`sdods report --last --open`).
5. **Repeat for other roles, environments or devices** by changing only the parameters. Use distinct names (`checkout-standard`, `checkout-problem`, `checkout-standard-iphone`).
6. **Convert to Gherkin** when the flow is stable (agent proposal, reviewed by a person):
   ```bash
   sdods record convert projects/<project>/recorded/<name>.spec.ts
   sdods proposals list
   sdods proposals show <id>
   sdods proposals accept <id> --branch sdods/<id>     # after review
   sdods lint -p <project>
   ```
   The proposal reuses existing steps first (`sdods steps list -p <project>`), adds only unmatched steps, and creates a page object with heal-aware locators.
7. **Offline replay** (CI-friendly) when HAR was captured:
   ```bash
   sdods har replay -p <project> -e <env> --strict -t "@har:<name>"
   ```

## Matrix template

Ask the user which cells to record, then run step 3 per cell:

| role \ env | local | staging |
|---|---|---|
| standard | `--user standard -e local` | `--user standard -e staging` |
| problem | `--user problem -e local` | `--user problem -e staging` |
| admin (mobile) | `--user admin -e local --device "iPhone 15"` | `--user admin -e staging --device "iPhone 15"` |

## Done when

- Each recording runs green with `-l recorded` on its environment.
- Names, roles and envs are visible in `sdods features list -p <project> --json` or `recorded/` file headers.
- Converted features pass `sdods lint` and are tagged with one layer tag and one suite tag.
