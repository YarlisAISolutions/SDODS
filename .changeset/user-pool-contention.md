---
'@sdods/contracts': minor
'@sdods/core': minor
'@sdods/cli': minor
---

User pools no longer starve workers silently (#153).

- `sdods run` stops before generating specs when a selected `@user:<role>` has fewer pool accounts than the scenarios of that role the workers could run at once. It exits `2` with `USER_POOL_TOO_SMALL` and names the role, the account count and the worker count. The count follows the selection (`--layer`, `--browser`, `--tags`, `--module`, `--feature`, `--since`, tag-gate skips, serial files, shards) and is skipped for `mode: shared`, `leaseScope: scenario`, database or OpenAPI datasets, `--list`, `--ui` and `--debug`. `--allow-pool-contention` runs anyway. `sdods doctor` prints accounts per role against the worker count (`-w` to set it).
- `data.userPool.leaseScope: scenario | worker` (default `worker`, unchanged). With `scenario` an account is released when each scenario ends, including accounts leased by the `I use a leased user …` steps, so one account serialises its scenarios instead of starving whole workers. In that mode `waitMs` defaults to `leaseTtlMs`, and the time spent waiting is added to the scenario's timeout.
- Waiters for a role are served in arrival order, so a worker that just released an account no longer wins it straight back.
- **Removed:** `data.userPool.leaseStore: db`. It was accepted and never implemented, so sharded runs that relied on it did not share leases. It is now a configuration error ("leaseStore 'db' was never implemented; use 'file' (see #153)"); use `file`, or give each runner its own accounts.
- `data.userPool.waitMs` is now optional in the schema (its effective default is unchanged for `leaseScope: worker`).
- Fix: the shard offset in lease owners used `--workers ?? 1`, so with Playwright's default worker count a worker on shard 2 could share an owner with one on shard 1.
