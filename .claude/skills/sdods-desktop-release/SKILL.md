---
name: sdods-desktop-release
description: Build, test, release and publish the SDODS desktop app (apps/desktop) for macOS, Windows and Linux, and update the download page on sdods.com. Use when asked to build the desktop app, cut a desktop release, tag desktop-v*, publish installers, refresh the download page, or debug a packaged build that will not start.
---

# Releasing the SDODS desktop app

The desktop app is an Electron **supervisor**: it owns a private SDODS workspace, installs
`@sdods/cli` from npm into it, and runs `sdods serve` as a child of a **bundled Node runtime**. It
does not reimplement SDODS and it does not host the server in-process.

Read this before changing anything in `apps/desktop` — most of it is here because something failed
in a way that produced no error message.

## The loop

```bash
# 1. Prove the runtime contract (no Electron involved). Catches npm/init/native-module problems.
bun run --cwd apps/desktop probe

# 2. Develop
bun run desktop:dev

# 3. Package for this machine
bun run --cwd apps/desktop dist:mac      # dist:win · dist:linux

# 4. Release
git tag desktop-v0.1.0 && git push origin desktop-v0.1.0   # triggers .github/workflows/desktop.yml
#    ... workflow drafts a release in the PUBLIC releases repo; publish it by hand ...
bun run desktop:sync-release desktop-v0.1.0                # writes apps/www/lib/desktop-release.ts
bun run channels:sync                                      # renders the Scoop/winget/apt manifests
git commit -am 'chore(www): desktop 0.1.0 downloads' && merge to main   # www workflow deploys
```

Three package managers install this release rather than the CLI — Scoop, winget and apt — and none
of their manifests can be rendered until it is published, because each one needs the SHA-256 of an
asset that must be downloaded first. `channels:sync` does that and refuses on a draft. Pushing the
manifests to the tap, the bucket and Microsoft's queue is a separate step: see the
`sdods-release-channels` skill.

**Order matters.** Sync the manifests only after the release is *published*, not while it is a
draft — the download page links straight at the asset URLs, and draft assets are not downloadable.
The sync script refuses to run against a draft for exactly this reason.

## The download page is switched off, per platform

`sdods.com/download` offers nothing right now, and that is deliberate. The installers are
unsigned, so macOS reports them as malware ("Apple could not verify...") and Windows blocks them
behind SmartScreen. A download most visitors are actively warned away from costs more trust than
no download at all, and the CLI install is a complete SDODS that nothing blocks.

The switch is a **list of platforms**, not a boolean, because the reason for hiding is per-platform:

| Platform | What it is waiting for |
|---|---|
| macOS | a Developer ID certificate — $99/year |
| Windows | its own certificate — Azure Artifact Signing ~$10/month, or an OV cert |
| Linux | **nothing.** No Gatekeeper, no SmartScreen; the `.deb` and AppImage install unsigned today |

So Linux can be switched on at any time for free, and macOS can go live the moment the Apple
certificate lands without waiting on Windows.

```bash
NEXT_PUBLIC_DESKTOP_PLATFORMS=linux          # only Linux
NEXT_PUBLIC_DESKTOP_PLATFORMS=macos,linux    # after the Apple certificate
NEXT_PUBLIC_DESKTOP_PLATFORMS=all            # everything
```

Unset means none, which is the current state. An unrecognised value **fails the build** rather than
silently hiding a platform — `=mac` is a typo that would otherwise look like a deliberate choice.

**Nothing is deleted.** Releases still build and publish and `desktop-release.ts` stays current, so
re-enabling needs no re-sync. `DESKTOP_PLATFORMS` lives in `apps/www/lib/desktop-release.ts` (not
`links.ts` — it needs the `Platform` type, and importing it there would be a cycle) and gates:
the nav tab, the header button, the page body, the sitemap entry, the 404 suggestion, the picker's
recommendation and per-platform grid, and the apt page's CTA — which follows the **Linux** flag
specifically, so a macOS-only rollout does not send apt users to a page with no `.deb` on it.

The `/download` route survives rather than 404ing, because people bookmark download pages. A
visitor whose own platform is switched off is told why instead of being shown a grid of other
people's operating systems.

## Where the binaries live, and why not in this repo

`YarlisAISolutions/SDODS` is **private**, and **release assets on a private repo are private too** — a
GitHub download link would 404 for every visitor. So installers are published to a separate
**public** repository that holds nothing but releases:

```bash
gh repo create YarlisAISolutions/sdods-releases --public -d 'SDODS desktop installers'
```

Then, on the source repo: a `DESKTOP_RELEASE_TOKEN` secret (a fine-grained PAT with
`Contents: read+write` on the releases repo **only** — `GITHUB_TOKEN` cannot write across
repositories), and optionally a `DESKTOP_RELEASE_REPO` variable to point somewhere else.

Source stays closed; only the built installers are public. This also keeps `electron-updater`
straightforward later, since it reads GitHub releases natively.

**Beware:** `git ls-remote https://github.com/YarlisAISolutions/SDODS.git` **succeeds** on a machine with
`gh auth` configured, because its credential helper is global. That is not an anonymous probe and
it has produced the wrong conclusion here twice. Check visibility with
`gh api repos/<slug> --jq .private`.

## Naming and versioning

- **SemVer** on `apps/desktop/package.json`; the tag is `desktop-v<version>`, kept separate from
  the `@sdods/*` npm versions because the app ships on its own cadence.
- **Every artifact says what it is**: `<product>-<version>-<platform>-<arch>.<ext>` —
  `SDODS-0.1.0-mac-arm64.dmg`, `SDODS-Setup-0.1.0-win-x64.exe`,
  `SDODS-0.1.0-linux-x64.AppImage`. electron-builder's defaults omit the platform on macOS, so
  `SDODS-0.1.0-arm64.dmg` could equally be a Linux build in a listing of six files.
- **`SHA256SUMS.txt`** ships with every release. It matters more than usual while builds are
  unsigned: it is the only way a user can verify what they downloaded.
  `sha256sum -c SHA256SUMS.txt --ignore-missing`

## Verifying a build actually works

A packaged build that starts is not the same as one that works. The real test is a run started
from the app's own Runs page — that exercises `process.execPath`, the workspace layout and the
browser cache at once.

```bash
# Install like a user, then launch with NOTHING on PATH. This is the zero-prerequisite promise.
env -i HOME="$HOME" USER="$USER" TMPDIR="$TMPDIR" PATH="/usr/bin:/bin:/usr/sbin:/sbin" \
  SDODS_DESKTOP_WORKSPACE=/tmp/sdods-test \
  /Applications/SDODS.app/Contents/MacOS/SDODS
```

Then: Runs → Start run → layer `ui`, browser `chromium`, tags `@smoke` → Run. It should pass 4/0/0.

Useful env vars:

| Variable | Purpose |
|---|---|
| `SDODS_DESKTOP_WORKSPACE` | Override the `~/SDODS` default. Always set this when testing, or you litter the real home directory. |
| `SDODS_DESKTOP_NODE` | Point at a specific `node` binary instead of the staged/system one. |

Logs: `~/Library/Application Support/SDODS/logs/desktop.log` (menu → Open Logs Folder). App state
lives beside it; `rm -rf` that directory for a clean first-run test.

## Traps — each one cost a debugging session

**Never spawn `process.execPath`.** Under Electron that is the Electron binary, so spawning it
launches a second copy of the app, which hits the single-instance lock and dies **silently**. Use
`nodeBin()` from `src/main/runtime.ts`. Same reason the server is a child process rather than
in-process: `packages/server/src/services/cli.ts` builds every child argv from `process.execPath`.

**Never spawn `npm` by bare name.** Windows has `npm.cmd`, not `npm`, and a GUI app launched from
the Dock inherits a minimal PATH. Use `npmCli()`, which resolves npm's own entry point.

**A missing `extraResources` source is only a warning.** It once produced an x64 `.dmg` with no
Node runtime and a zero exit code. `scripts/before-pack.mjs` stages the runtime per arch and fails
hard; `desktop.yml` re-checks every packaged app. Do not remove either.

**Signals do not fire in the packaged app.** A SIGTERM runs none of `before-quit`, `will-quit`,
`exit`, or `process.on('SIGTERM')` — Electron terminates natively — so the detached server child
outlives the app. The guarantee is the pidfile: the server's pid is recorded and the next launch
reaps it. Test it with `kill -9` on the app, not `kill`.

**Browsers are needed for every layer, not just UI.** SDODS merges one BDD fixture set across
layers, so an api-layer run against an empty `PLAYWRIGHT_BROWSERS_PATH` fails with
`browserType.launch: Executable doesn't exist`. Chromium is fetched after the dashboard loads.

**`sdods init` needs `--force --no-install --no-browsers`.** It refuses a non-empty directory,
its `--pm` accepts only `bun|pnpm` (neither is on a user machine), and it would pull browsers. It
overwrites `package.json` on purpose — its manifest declares `@playwright/test` and
`playwright-bdd`, which `sdods run` needs — so npm install runs again afterwards.

**`@sdods/server@0.2.1` hardcodes `cliBin: resolve(rootDir, 'packages/cli/src/bin.ts')`**, a
monorepo-only path, so UI-triggered runs die with ERR_MODULE_NOT_FOUND. `bootstrap.ts` writes a
bridge at that path, but only while the installed server still contains that string. **Publishing a
server newer than 0.2.1 removes the need for it** and fixes `sdods serve` for every npm user.

**A root-level `node_modules` never reaches the package.** app-builder-lib's copy filter drops a
directory named `node_modules` when it sits at the *root* of a copy
(`out/util/filter.js`: `if (relative === "node_modules") return false`), and the check runs before
any pattern, so no `filter` can re-include it. Node ships npm at `node_modules/npm` on **Windows**
and at `lib/node_modules/npm` everywhere else — so this silently stripped npm from the Windows
builds only. Every 0.1.0 Windows installer shipped without npm and died in `npmCli()` on first run
before it could fetch `@sdods/cli`; there is no fallback, because nothing searches PATH for npm.
The fix is a second `extraResources` entry whose `from` *is* the `node_modules` directory, so the
rule has nothing to match. `desktop.yml` now asserts npm as well as node in every packaged app —
checking only the thing that broke last time is how the next hollow artifact ships.

**`executableName` is not Linux-only.** It is needed on Linux (the scoped package name
`@sdods/desktop` is rejected as a file path), but at the **top level** it also renames the macOS
bundle to `sdods.app` and the Windows binary to `sdods.exe`. That shipped a lowercase app in
Finder and made the download page's `xattr -dr com.apple.quarantine /Applications/SDODS.app` wrong
on case-sensitive volumes. Keep it under `linux:`.

**The deb needs `libasound2` and nothing else declares it.** Electron links `libasound.so.2`; none
of electron-builder's default depends pull it in, so `apt install` reported success and the app
then failed to start on any host without ALSA. Ubuntu 24.04 renamed the package `libasound2t64`
and left `libasound2` as a virtual name with two providers, which apt will not resolve on its own
— so the dependency must be the alternation `libasound2t64 | libasound2`, not a bare name.

**The ARM64 AppImage cannot start on a stock distro.** Its AppImageKit runtime declares
`NEEDED: libz.so` — the `zlib1g-dev` symlink — instead of `libz.so.1`, so it dies with
`error while loading shared libraries: libz.so` before any of our code runs. The x86_64 runtime
declares `libz.so.1` and is fine. Both runtimes also dlopen `libfuse.so.2`, which Ubuntu 22.04+
no longer installs by default. Until the static `type2-runtime` is swapped in, ARM64 Linux users
should be sent to the `.deb`.

**An unsigned macOS build must still be signed ad-hoc.** With no Developer ID, electron-builder
skips signing and leaves the linker's placeholder: `Identifier=Electron`, `Sealed Resources=none`,
no `_CodeSignature`. A signature claiming sealed resources that has none reads as *tampered*, so a
quarantined download reports "SDODS is damaged and can't be opened" rather than the ordinary
unidentified-developer prompt. `scripts/after-pack.mjs` re-signs ad-hoc, which costs nothing and
yields a valid signature; it runs **before** electron-builder's signing step, so real credentials
still win.

**Do not build the macOS `universal` target.** It lipo-merges two packs that each want a different
`node` binary at one path. `before-pack.mjs` rejects it. Ship separate arm64 and x64 artifacts.

**`apps/desktop` must declare no production dependencies.** electron-builder's dependency collector
has no handling for bun's `node_modules/.bun` symlink layout. Everything is bundled by rollup and
`files` excludes `node_modules` outright. Adding a runtime dependency will break packaging.

## Browser architecture detection on the download page

An Apple silicon Mac reports `Intel Mac OS X` in its user agent. Parsing the UA alone recommends
the Intel build to nearly every modern Mac. `detectArch()` uses
`navigator.userAgentData.getHighEntropyValues(['architecture'])`, which is truthful on Chromium;
Safari and Firefox return nothing, so macOS defaults to Apple silicon deliberately. Every other
build is listed underneath, and the full list is server-rendered so no-JS visitors lose nothing.

## Signing

Builds are unsigned today, so macOS shows "damaged / unidentified developer" and Windows shows
SmartScreen. The download page prints the per-OS workaround automatically while
`DESKTOP_RELEASE.signed` is false.

Everything is wired behind CI secrets already — supply them and signing turns on with no code
change: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
for macOS; `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` for Windows. Obtaining the certificates requires
a person: Apple Developer Program ($99/yr), and for Windows **Azure Trusted Signing** (~$10/month)
rather than a traditional OV certificate, which has required an FIPS hardware token since June 2023
and does not fit CI. After signing lands, pass `--signed` to `desktop:sync-release`.

**`CSC_LINK` also arms the macOS updater.** Squirrel.Mac will not install an update into an
unsigned app, so `src/main/updater.ts` stays dormant on macOS unless the build says it is signed.
That is a build-time constant, `__DESKTOP_SIGNED__`, which `electron.vite.config.ts` sets from
`CSC_LINK`/`CSC_NAME` being present (override with `DESKTOP_SIGNED=1|0`). It is not probed at
runtime because `after-pack.mjs` ad-hoc signs every macOS build, so "has a valid signature" is
true of the unsigned ones too. The consequence: a Mac build signed some other way (a keychain
identity with no `CSC_*` variable) ships with its updater off until you pass `DESKTOP_SIGNED=1`.

## Updates

Installed apps update themselves from the `latest*.yml` feeds every release carries. Where each
install gets its updates:

| Install | Updates through |
|---|---|
| Windows NSIS (incl. winget) | the app — works unsigned |
| Linux AppImage | the app — works unsigned |
| macOS `.dmg` | the app **once signed**; until then, a new download |
| Linux `.deb` / apt | `apt upgrade`; the app never runs `dpkg` |
| Scoop | `scoop update sdods` |

The feed the app reads is `Resources/app-update.yml`, written from `publish:` in
`electron-builder.yml`. **It must name `sdods-releases`**: through 0.1.1 it named the private
source repo, where every asset 404s (those builds had no updater code either, so 0.1.x users move
up by downloading once). `desktop.yml` now fails a build whose feed points anywhere else.

The flow never restarts on its own: download in the background, then "SDODS x.y.z is ready —
Restart to update" with Restart / Later. Restart stops `sdods serve` and **waits for it to exit**
before `quitAndInstall` — on Windows the installer replaces the directory the child's `node.exe`
runs from, and a relaunch would otherwise find the port still taken. If it has not exited after
10 s the pidfile is left for the relaunch to reap. `autoInstallOnAppQuit` is off for the same
reason. `SDODS_DESKTOP_NO_UPDATE=1` turns the whole thing off; the menu has "Check for Updates…" and
a persisted "Check for Updates Automatically" (`autoUpdate` in `config.json`).

**Linux constructs `AppImageUpdater` explicitly.** electron-updater's singleton picks `DebUpdater`
whenever `resources/package-type` exists, and the deb target writes that file into `linux-unpacked`
— the directory the x64 AppImage is built from.

Prove a change against the real feed without Electron or installing anything — it bundles the
updater through Rollup and pretends to be a packaged app at the given version:

```bash
bun run --cwd apps/desktop probe:update --version 0.1.0 --expect available
```

## Files

| Path | What it is |
|---|---|
| `apps/desktop/src/main/index.ts` | Lifecycle: bootstrap → serve → authenticate → load. Pidfile and orphan reaping. |
| `apps/desktop/src/main/runtime.ts` | Bundled Node resolution and the child environment. |
| `apps/desktop/src/main/bootstrap.ts` | The five-step first-run install, and the 0.2.1 CLI bridge. |
| `apps/desktop/src/main/server.ts` | Port choice, `sdods serve` child, health poll, setup-token capture. |
| `apps/desktop/src/main/auth.ts` | Admin creation, safeStorage vault, cookie injection. |
| `apps/desktop/src/main/updater.ts` | Self-update: the platform gate, six-hourly checks, the Restart prompt. |
| `apps/desktop/test/updater.test.ts` | Gate matrix and restart ordering, electron and electron-updater mocked. |
| `apps/desktop/scripts/probe.ts` | The runtime contract, provable without Electron. |
| `apps/desktop/scripts/update-probe.ts` | A real update check against the release feed, without Electron. |
| `apps/desktop/scripts/fetch-node-runtime.ts` | Downloads + SHASUMS-verifies + prunes Node. |
| `scripts/sync-desktop-release.ts` | GitHub release → `apps/www/lib/desktop-release.ts`. |
| `.github/workflows/desktop.yml` | Tag-gated matrix build, artifact verification, draft release. |
