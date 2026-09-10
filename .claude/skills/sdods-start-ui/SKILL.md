---
name: sdods-start-ui
description: Start the SDODS web UI on any OS and get the first user signed in. Use when someone says "start the UI", "open the dashboard", "run the web app", "sdods serve", "I can't log in", "it says the web UI is not available", "port 4444 in use", "how do I register", or is onboarding onto SDODS for the first time.
---

# Start the SDODS web UI

The UI is served by `sdods serve` — one Fastify process that serves the REST API, SSE run
streaming, MCP over HTTP, the scheduler and the React app. There is no separate UI process in
production. Docs: <https://docs.sdods.com/docs/getting-started/web-ui/> ·
<https://docs.sdods.com/docs/getting-started/installation/>

## 0. Preflight — check what is already on the machine

Most "the UI won't start" reports are really a Node or npm problem that predates SDODS. Run this
before installing anything; it takes a second and decides which install is safe.

```bash
node -v; command -v node          # need v22+
command -v bun fnm nvm volta asdf # is a version manager in charge of node?
npm config get prefix             # where npm -g would write
which -a sdods                    # copies already installed (often more than one)
```

Then read the four rules below. They are the failures that actually happen.

### Node must be 22+, and being below it does not say so

SDODS needs Node 22. Below that you do **not** get a clean version message — you get a crash from
somewhere deep in a dependency, because the code uses APIs that only exist in 22+:

```text
TypeError: TEXT_ENCODINGS.union is not a function     ← this is "your Node is too old"
```

If you see an unexplained `TypeError` from a package you have never heard of, check `node -v` first.

### If a version manager owns Node, `npm install -g` is a trap

With fnm, nvm, volta or asdf, **global npm packages belong to the Node version that was active when
you installed them**. Switch versions and they are simply gone. Demonstrated on a machine with four
Node versions installed:

```text
$ fnm exec --using=v22.22.2 npm ls -g   →  codex, bruno, firebase-tools, …
$ fnm exec --using=v24.15.0 npm ls -g   →  corepack, npm, openclaw       ← different world
```

So `npm install -g @sdods/cli` under Node 22, then `fnm use 24`, and `sdods: command not found` —
with the package still on disk. Pick one:

| Your situation | Do this |
|---|---|
| a version manager is in charge (the common case) | use the installer — it defaults to **bun**, which installs to `~/.bun` and is the same regardless of which Node is active |
| you want npm anyway | pin the Node version first (`fnm use 22 && fnm default 22`), and re-install after any switch |
| no version manager, Node from the OS or Homebrew | `npm install -g @sdods/cli` is fine |

### Never `sudo npm install -g`

If `npm config get prefix` points somewhere unwritable (`/usr/local`, `/usr`), `npm -g` fails with
`EACCES`. `sudo` "fixes" it and leaves root-owned files that break every later install. Instead:

```bash
npm config set prefix ~/.npm-global          # then add ~/.npm-global/bin to PATH
```

or just use the installer, which writes only to `~/.sdods`, `~/.bun` and `~/.local/bin`.

### More than one `sdods` is normal — know which one wins

`which -a sdods` frequently returns several (an installer shim, a Homebrew copy, a bun global).
**The first on PATH wins**, and they drift apart. Inside a checkout none of them is the right one —
use `bun run sdods`. See the callout in §1.

### Already installed, and you just want it working

| Symptom | Do this |
|---|---|
| `sdods: command not found`, but you installed it | you switched Node versions — re-install, or use the bun/installer path |
| unexplained `TypeError` from a dependency | `node -v`; anything under 22 is the cause |
| `EACCES` during install | do **not** sudo — repoint the npm prefix, or use the installer |
| two machines disagree | compare `sdods --version` **and** `which -a sdods` on both |
| everything looks installed but behaves oddly | `sdods doctor` — but run it outside a checkout, or with `bun run sdods` inside one |

Only the server runs on Node. Do not try to run it under `bun` directly — the native modules abort
with `panic: NAPI FATAL ERROR`. `bun run sdods` is safe because it shells out to Node via tsx.

## 1. Identify the install, because the command differs

Run both. **Where you are matters more than what is on PATH** — a global `sdods` and a source
checkout very often coexist, and the two are not interchangeable.

```bash
sdods --version || echo "not on PATH"
grep -m1 '"name"' package.json 2>/dev/null || echo "not in a checkout"
```

Read the rows in order and take the first that matches:

| Condition | You have | Start command |
|---|---|---|
| `package.json` says `sdods-monorepo` — **even if `sdods` is on PATH** | a **source checkout** | `bun run web:build`, then `bun run sdods serve --open` |
| `sdods` on PATH, anywhere else | a **global install** (installer, npm, Homebrew) | `sdods serve --open` |
| neither, Docker is running | the **container** | `docker run --rm -p 8080:8080 -v sdods-data:/data ghcr.io/siri1410/sdods-server` |
| you want no terminal at all | the **desktop app** | install from <https://sdods.com/download>, launch it |

> **Inside a checkout, always use `bun run sdods`, never the global `sdods`.** The two drift, and
> the failure is confusing because both report the same version. A global CLI run against this
> repo's `demo-shop` dies with
> `✖ CONFIG_INVALID: browsers.1: Invalid option: expected one of "chromium"|"firefox"|…` — the
> repo's project yaml lists `edge`, which the older published schema does not know. Same version
> string, different schema. `which -a sdods` will often show three copies.

Prerequisites differ per row: the global install needs **Node 22+**; a source checkout also needs
**bun** and a completed `bun install` (running it from a directory outside the installed tree fails
with `Cannot find package 'tsx'`).

`sdods doctor` reports Node, bun, the runner, browsers, projects, env vars and the database, and
continues past *check* failures. It does not survive a bad project yaml — invalid config aborts it
with exit 2 before any check runs.

## 1a. Does the UI actually ship with my install?

The UI is a prebuilt bundle, not a live build, so this has a different answer per channel. Every
**published** channel carries it; the one that does not is the source checkout — which is the one
the docs hand to new contributors.

| Channel (as listed on sdods.com/install) | UI included | Why |
|---|---|---|
| macOS / Linux `install.sh` | yes | installs `@sdods/cli` globally, which depends on `@sdods/server`, which vendors the bundle |
| Windows `install.ps1` | yes | same global package, same vendored bundle |
| Homebrew | yes | the tap carries the formula only; the software comes from npm |
| npm `-g @sdods/cli` | yes | `@sdods/server`'s published tarball contains `web/index.html` |
| Docker | yes | the image builds the bundle at `RUN bun run --filter @sdods/web build` |
| Desktop app (winget · Scoop · apt) | yes | it bootstraps the same npm packages and supervises `sdods serve` |
| **source checkout** | **no** | `packages/web/dist/` is gitignored — run `bun run web:build` first |

Prove it on any install. The first command is the verdict; run the second only if it said `real UI`
(on a stub there is no asset to find, so it would curl `/` and report a misleading 200):

```bash
curl -s http://127.0.0.1:4444/ | grep -q 'not available in this install' \
  && echo 'STUB — no UI bundle' || echo 'real UI'
curl -s -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:4444$(curl -s http://127.0.0.1:4444/ \
  | grep -o 'src="/assets/[^"]*"' | head -1 | sed 's/src="//;s/"//')"
```

## 2. Start it, per OS

The CLI is identical on every OS; only the shell and the paths differ.

| OS / shell | Start the UI |
|---|---|
| macOS, Linux (bash/zsh) | `sdods serve --open` |
| Windows (PowerShell) | `sdods serve --open` |
| Windows (cmd) | `sdods serve --open` — the installer writes both `sdods.cmd` and `sdods.ps1` |
| WSL | use the Linux command inside WSL, not the PowerShell one |
| Docker (any host) | `docker run --rm -p 8080:8080 -v sdods-data:/data ghcr.io/siri1410/sdods-server` |

Defaults: **`http://127.0.0.1:4444`** for the CLI, **`http://localhost:8080`** for Docker (the
image binds `0.0.0.0:8080`). `--open` launches the browser (`open` / `start` / `xdg-open` by
platform). `--host 0.0.0.0` exposes it on the LAN — only do that deliberately.

On Apple silicon the published image is `linux/amd64` only, and Docker refuses the pull rather
than emulating. Add the platform flag:

```bash
docker run --rm --platform linux/amd64 -p 8080:8080 -v sdods-data:/data ghcr.io/siri1410/sdods-server
```

If the run must come from a source checkout, `bun run web:build` is not optional — see
Troubleshooting.

## 3. Get the first user in (registration)

There are two ways in, and `serve` tells you which applies. On a database with **no users** — and
only when `--auth-disabled` is off — startup prints a one-time setup URL. You will see it **twice**:
once as this plain line from the CLI, and once more as a raw pino JSON log line with slightly
different wording. Same token, not two tokens:

```text
✔ SDODS server listening on http://127.0.0.1:4444
ℹ First run: create the admin at http://127.0.0.1:4444/setup?token=<token> (or: sdods users create --admin --username <name> --password <pw>)
```

- **Browser path** — open that `/setup?token=…` URL and fill the form. Best for onboarding
  someone who should never touch a terminal. The token is printed once per fresh database.
  **On an unbuilt source checkout this URL 404s** — the stub page answers `/` only and there is no
  SPA fallback, so run `bun run web:build` first or use the CLI path.
- **CLI path** — works headlessly, in CI, and in containers:

```bash
sdods users create --admin --username admin --password '<at least 8 chars>'
```

`--admin` makes a platform admin and owner of every organization without one. Add teammates with
`--role viewer|editor|admin`, and scope them per workspace:

```bash
sdods users create --username sam --role editor
sdods users grant sam --workspace default --role editor
```

Run `users create` and `serve` **from the same workspace root**. Resolution walks up from the cwd
looking for a workspace marker (`sdods.workspace.yaml`, `sdods.config.ts`, `sdods.config.json`) and
uses that directory's `.sdods/sdods.db`. With no marker above you, it falls back to `.sdods/sdods.db`
relative to the cwd — which is how you end up creating the admin in one database and serving another,
and the login then fails with entirely correct credentials. `SQLITE_PATH` overrides all of it, and is
the reliable way to pin both commands to one file:

```bash
SQLITE_PATH=/path/to/sdods.db sdods users create --admin --username admin --password '<pw>'
SQLITE_PATH=/path/to/sdods.db sdods serve --open
```

> **Lost the token?** Restart `serve` to print a new one — a fresh database prints one every start.
> Current versions redirect a first-time visitor to `/setup` on their own and accept the token
> pasted into the form, so the terminal is not the only way in. Older ones do neither: they land you
> on `/login`, which only suggests `sdods users create`, and `/setup` takes the token from the query
> string alone. If that is what you see, use the CLI path or upgrade.

`--auth-disabled` makes every request a local admin. It is a development shortcut on a machine
only you can reach, never a way to skip onboarding on a shared host.

## 4. Fastest path from nothing to a working UI

```bash
curl -fsSL https://sdods.com/install.sh | sh -s -- --workspace ~/my-tests   # macOS/Linux
cd ~/my-tests
sdods users create --admin --username admin --password 'change-me-now'
sdods serve --open
```

Windows PowerShell, same shape:

```powershell
& ([scriptblock]::Create((irm https://sdods.com/install.ps1))) -Workspace C:\my-tests
cd C:\my-tests
sdods users create --admin --username admin --password 'change-me-now'
sdods serve --open
```

`--workspace` runs `sdods init` for you, so the workspace already has the `demo-shop` project and
there is something to look at on the dashboard immediately. Without a project the UI is real but
empty, which reads as broken to a first-time user.

**If SDODS is already installed**, run the same command again — it upgrades in place rather than
adding a second copy, and it is the safe response to a version that looks stale. Two flags are worth
knowing before you run it anywhere you care about:

```bash
sh install.sh --dry-run        # prints every step, changes nothing
sh install.sh --version-check  # prints the versions and paths it resolved here, then exits
```

Paste the `--version-check` output into any support thread: it is the whole environment in one
block, and it settles the "which Node, which copy" questions from §0 immediately.

## 5. Confirm it is actually up

```bash
curl -s http://127.0.0.1:4444/api/health          # {"ok":true,"version":…,"driver":"sqlite",…}
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4444/   # 200
```

A `200` on `/` that returns a short page saying *"The web UI is not available in this install"* is
the API running **without** the UI bundle — that is the source-checkout case, not a healthy start.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| A page saying the web UI was not found (**HTTP 503**) | no UI bundle. The server tries four locations: `<root>/packages/web/dist`, `<root>/node_modules/@sdods/web/dist`, the sibling `web/dist` in a checkout, then the copy vendored into `@sdods/server` at pack time. On a fresh clone none exist — `packages/web/dist/` is gitignored | `bun run web:build`, then restart `serve` |
| `CONFIG_INVALID: Port 4444 is already in use.` | something already holds the port, often another `serve` or the desktop app | take the port it suggests: `sdods serve --port 4445`, or find the holder (`lsof -i :4444` · `netstat -ano \| findstr :4444`). On versions before this fix the command printed `INTERNAL: listen EADDRINUSE` and then hung — Ctrl+C and upgrade |
| Login fails with the right password | `users create` and `serve` ran in different workspaces, so two `.sdods/sdods.db` files | run both from one workspace root; `sdods users list` in that directory should show the account |
| No setup token printed | the database already has users, **or** you passed `--auth-disabled`, which suppresses it | sign in, `sdods users create`, or restart without `--auth-disabled` |
| `/setup?token=…` returns 404 | an SDODS older than the fix that made the stub answer every route | upgrade, or `bun run web:build` and restart, or use `sdods users create --admin` |
| Fresh install, but `/login` says "ask an admin" | the login page does not redirect to `/setup` | open the `/setup?token=…` URL from the `serve` output, or `sdods users create --admin` |
| Global CLI errors on a repo project (`CONFIG_INVALID`, unknown browser) | version skew between the global CLI and the checkout | use `bun run sdods` inside a checkout; upgrade the global one otherwise |
| `sdods: command not found` after installing | the bin dir is not on PATH — `~/.local/bin`, or `%LOCALAPPDATA%\SDODS\bin` on Windows | add it, or re-run the installer with `--modify-path` / `-ModifyPath` |
| Docker: `no matching manifest for linux/arm64/v8` | amd64-only image on Apple silicon | add `--platform linux/amd64` |
| UI loads, runs never start | browser engines missing | `sdods browsers install -b chromium` (the positional `sdods browsers install chromium` also works on current versions, and failed with `too many arguments` before). Bare `sdods browsers install` installs all engines; on Linux `--with-deps` needs root |
| Node too old | SDODS needs Node 22+ | `nvm use 22` / `fnm use 22`. On macOS/Linux the installer also takes `--install-node`; **`install.ps1` has no such flag** — it exits and tells you to run `winget install OpenJS.NodeJS.LTS`, `scoop install nodejs-lts` or `nvm install 22` |
| Anything else | — | `sdods doctor` first; it reports what it found, not what it expected |

## Keeping it current

`upgrade` reads the npm registry and reports; it installs nothing without `--apply`.

```bash
sdods upgrade                       # what is behind
sdods upgrade --apply               # install the latest @sdods/* packages
sdods browsers install --with-deps  # refresh engines afterwards (Linux needs root)
sdods doctor                        # confirm
```

CI does this on a schedule: `.github/workflows/dependencies.yml` reports freshness into one rolling
issue every morning, and on the 1st of the month upgrades `@sdods/*` and Playwright, runs the suite,
and opens a PR only if it passes.

After any upgrade, restart `serve` — a running server keeps the old bundle in memory.

## Working on the UI itself

Only for developing the React app — not how anyone runs SDODS:

```bash
bun run web:dev      # Vite on :5173 with MSW mocks, no server needed
bun run sdods serve  # in a second terminal, for the real API
```

The Vite dev proxy targets `http://127.0.0.1:4444` whether or not mocks are on, so if you start the
API on another port the proxied routes will not follow it.
