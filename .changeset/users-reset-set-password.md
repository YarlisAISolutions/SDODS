---
'@sdods/cli': minor
'@sdods/db': minor
---

`sdods users reset --yes` removes every user with their sessions, API tokens and memberships, so the next `sdods serve` offers the one-time `/setup` link again; projects, runs and schedules are kept. `sdods users set-password <username> --password <pw> [--activate]` sets a password from the terminal, signs the user out everywhere and can re-enable a deactivated account, so a locked-out sole admin no longer has to wipe the database. Both are audited. The docs gain a "Reinstall or reset" section for installed, clone, Docker and desktop setups.
