---
name: automax-record
description: Record a browser flow with AutoMax for a given project, environment, user role and device, save it as a runnable spec, replay it, and optionally convert it into a Gherkin feature with reusable steps. Use when the user says "record", "codegen", "capture a flow", "re-record as <role>", or wants the same flow recorded across environments or users.
---

# AutoMax record & playback skill

Re-runnable recipe. Ask for the parameters you do not have, then follow the steps. Never edit `main` directly; recordings land in `projects/<project>/recorded/` and conversions become proposals.

## Parameters

| Name | Required | Example | Notes |
|---|---|---|---|
| `project` | yes | `demo-shop` | `bun run automax project list` shows slugs |
| `env` | yes | `staging`, `local` | `bun run automax env list -p <project>` |
| `name` | yes | `checkout-standard` | becomes `recorded/<name>.spec.ts`; include the role in the name |
| `role` | no | `standard`, `problem`, `admin` | leases a pool user of that role and starts logged in (storageState) |
| `url` | no | `/inventory.html` | route path or absolute URL to open first |
| `device` | no | `"iPhone 15"`, `"Pixel 7"` | Playwright device name for mobile emulation |
| `browser` | no | `chromium` (default), `firefox`, `webkit` | |
| `har` | no | `true` | also capture network into `har/<env>/<name>.har` for offline replay |

## Steps

1. **Check the environment** (fail fast on missing vars):
   ```bash
   bun run automax doctor -p <project>
   bun run automax env list -p <project>
   ```
2. **Make sure the role has login state** (skip when no role):
   ```bash
   bun run automax auth list -p <project> -e <env>
   bun run automax auth capture -p <project> -e <env> --user <role>      # only if missing or expired
   ```
3. **Record** (opens Playwright codegen; the person performs the flow and closes the window):
   ```bash
   bun run automax record -p <project> -e <env> --name <name> [--user <role>] [--url <url>] [--device "<device>"] [--browser <browser>] [--save-har]
   ```
   Output: `projects/<project>/recorded/<name>.spec.ts`, post-processed (AutoMax fixtures, routes instead of absolute URLs, tags `@recorded @ui @regression`, header comment with project/env/role/device).
4. **Play it back** on the same environment, then on another one:
   ```bash
   bun run automax run -p <project> -e <env> -l recorded --grep "<name>"
   bun run automax run -p <project> -e <other-env> -l recorded --grep "<name>"
   ```
   Look at `.automax/runs/<runId>/` for screenshots and the HTML report (`bun run automax report --last --open`).
5. **Repeat for other roles, environments or devices** by changing only the parameters. Use distinct names (`checkout-standard`, `checkout-problem`, `checkout-standard-iphone`).
6. **Convert to Gherkin** when the flow is stable (agent proposal, reviewed by a person):
   ```bash
   bun run automax record convert projects/<project>/recorded/<name>.spec.ts
   bun run automax proposals list
   bun run automax proposals show <id>
   bun run automax proposals accept <id> --branch automax/<id>     # after review
   bun run automax lint -p <project>
   ```
   The proposal reuses existing steps first (`bun run automax steps list -p <project>`), adds only unmatched steps, and creates a page object with heal-aware locators.
7. **Offline replay** (CI-friendly) when HAR was captured:
   ```bash
   bun run automax har replay -p <project> -e <env> --strict -t "@har:<name>"
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
- Names, roles and envs are visible in `automax features list -p <project> --json` or `recorded/` file headers.
- Converted features pass `automax lint` and are tagged with one layer tag and one suite tag.
