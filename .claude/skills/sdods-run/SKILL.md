---
name: sdods-run
description: Run SDODS test suites for a project across environments, layers (ui/api/hybrid/recorded), browsers, suites (@smoke/@regression) and user roles, then read the results. Use when the user says "run the tests", "smoke on staging", "regression on all browsers", "run as <role>", or asks what failed.
---

# SDODS run skill

## Parameters

| Name | Default | Notes |
|---|---|---|
| `project` | only project if one exists | `bun run sdods project list` |
| `env` | project `envs.default` | `bun run sdods env list -p <project>` |
| `layer` | all layers in the project | `-l ui`, `-l api`, `-l hybrid`, `-l recorded` (repeatable) |
| `browser` | project `browsers` | `-b chromium -b firefox -b webkit`, or `--project-matrix` for all |
| `tags` | none | Cucumber expression, e.g. `"@smoke and not @mock"`, `@user:admin`, `@jira:DEMO-12` |
| `headed` | false | `--headed` for a visible browser |
| `workers` | runner default | `-w 2` |
| `shard` | none | `--shard 1/3` |
| `har` | off | `--har-replay --strict` for offline runs, `--har-update` to refresh |

## Steps

1. Validate before running (cheap, catches config and tag mistakes):
   ```bash
   bun run sdods config validate
   bun run sdods lint -p <project>
   bun run sdods run -p <project> -e <env> --list          # shows the run targets that would run
   ```
2. Run the requested slice. Typical combinations:
   ```bash
   bun run sdods run -p <project> -e <env> -l api                                  # API only, no browser
   bun run sdods run -p <project> -e <env> -l ui -b chromium -t @smoke             # quick UI smoke
   bun run sdods run -p <project> -e <env> -t @regression --project-matrix         # every browser in the yaml
   bun run sdods run -p <project> -e <env> -t "@user:admin"                        # scenarios that lease admin users
   bun run sdods run -p <project> -e <env> -l hybrid -w 2                          # API→UI chaining
   bun run sdods run -p <project> -e <env> --har-replay --strict -t @smoke         # offline, CI-style
   ```
3. Read results:
   ```bash
   bun run sdods report --last                    # summary: totals, failed, flaky, report paths
   bun run sdods report --last --open             # HTML report + dashboard
   bun run sdods heal report --last               # locators that were healed
   ```
   Artifacts: `.sdods/runs/<runId>/<project>/<fingerprint>/r<retry>/` holds `scenario-start.png`, `NN-before.png`/`NN-after.png` per UI step (policy by suite tag), `api/*.json` per API call, `heal.jsonl`.
4. If something failed, collect: the scenario name, the error from `summary.json`, the `failure.png`, and the trace (`bun run sdods trace --last`). Then either fix the feature/page object or hand it to the healer agent:
   ```bash
   bun run sdods agent heal -p <project> --scenario <fingerprint> --dry-run
   ```
5. Repeat for other environments or roles by changing `-e` / `-t "@user:<role>"` only.

## Exit codes

`0` all passed · `1` test failures · `2` configuration or usage error · `3` lint errors · `130` cancelled.
