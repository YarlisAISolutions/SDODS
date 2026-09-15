---
name: sdods-release-channels
description: Publish SDODS through the package managers — Homebrew, Scoop, winget, npm, Docker/GHCR and the apt repository — and keep the install page honest about which of them actually work. Use when asked to add or fix a distribution channel, publish to a package manager, push the tap or bucket, submit the winget manifest, build the apt repo, or when a channel is missing from sdods.com/install.
---

# Distribution channels

SDODS ships through six package managers on top of the two install scripts. They are **not one
release**: they publish on three schedules, from two repositories, and two of them are published by
someone who is not you.

| Channel   | Publishes         | Where the manifest lives      | Who publishes it          |
| --------- | ----------------- | ----------------------------- | ------------------------- |
| npm       | the CLI           | — (`release.yml`)             | changesets, on `main`     |
| Docker    | the server image  | — (`release.yml`)             | `release.yml`, after npm  |
| Homebrew  | the CLI           | `siri1410/homebrew-sdods`     | you, `git push`           |
| Scoop     | the desktop app   | `siri1410/scoop-sdods`        | you, `git push`           |
| winget    | the desktop app   | `microsoft/winget-pkgs`       | **Microsoft's reviewers** |
| apt       | the desktop app   | Pages on `sdods-releases`     | `apt.yml`, run by hand    |

## The one rule

**A channel goes live when its registry answers, not when its manifest is committed here.**

`bun run channels:sync` probes each one — npm's registry, GHCR's anonymous pull token, the tap and
bucket contents API, winget-pkgs, and the apt `InRelease` file — and writes the result into
`apps/www/lib/install-channels.ts`. The install page renders live channels only, so a tab whose
command would 404 cannot ship. Never flip a `live:` flag by hand; the flag is an observation.

```bash
bun run channels:sync
```

```bash
bun run channels:sync -- --check   # non-zero if the committed state has drifted
```

Nobody has to remember to run it: `.github/workflows/channels.yml` runs the sync after every
`release` run on `main`, daily, and on demand, and opens or refreshes the `chore/channels-sync` PR
when anything drifted. Merge that PR; do not edit its diff.

Every SHA-256 in `packaging/` is computed from bytes the script downloaded. Do not transcribe one
from a release page — it is the single field where being wrong means the package manager refuses
to install at all, after every check here has passed.

## The order things must happen in

Two channels install the CLI from npm, and three install the desktop app from a release. Neither
can be published before the thing it points at.

```
changesets publishes @sdods/cli  →  release.yml builds the GHCR image  →  channels:sync
                                 →  Homebrew formula (npm tarball)     →  push the tap
desktop-v* tag → workflow drafts → a PERSON publishes the release      →  channels:sync
                                 →  Scoop, winget, apt manifests       →  push / submit / run apt.yml
```

## Per channel

### npm — automatic

`release.yml` runs `changesets/action@v2` on every push to `main`. For each package it publishes,
`scripts/publish-npm.sh` appends one line to the file named by `$CHANGESETS_OUTPUT`:

```
{"type":"git-tag","tag":"@sdods/cli@0.9.0","packageName":"@sdods/cli"}
```

That file is the **only** signal v2 reads to set `published` and `published-packages` and to create
the GitHub releases and tags. Do not remove it: without it a successful publish reads as "nothing
published" and the image job below never runs. That was the actual bug under v1, which scanned
stdout for the `New tag: <pkg>@<version>` lines the script still prints for people reading the log.
`tests/publish-npm.test.ts` runs the script against the action's own reader, and
`bash scripts/publish-npm.sh --dry-run` shows the file without publishing anything.

### Docker — automatic, after npm

Gated on `needs.changesets.outputs.published`, not on a `v*` tag. It used to gate on the tag and
nothing in this repository creates one, so the job had never run and the image did not exist.
Do not "fix" it by pushing a tag from CI: a tag pushed with `GITHUB_TOKEN` does not trigger
workflows, so the job still would not run.

**The image is `linux/amd64` only, and Docker does not emulate a missing architecture** — it
refuses the pull with `no matching manifest for linux/arm64/v8`. Apple silicon needs
`--platform linux/amd64`. Building arm64 in CI was tried and abandoned: under QEMU on an amd64
runner the arm64 stage did not finish in 90 minutes, because `bun install`, the native module
builds and the web bundle all run emulated. Fixing it properly means either a native arm64 runner
(a paid tier for a private repository) or splitting the Dockerfile so the arch-independent web
bundle builds on `$BUILDPLATFORM`. `channels:sync` reads the architectures out of the manifest and
writes the note from them, so the page cannot claim an arch the image does not carry.

**GHCR packages default to private, and visibility is a UI-only setting.** After the first push:
Profile → Packages → `sdods-server` → Package settings → Change visibility → Public. Until then
`channels:sync` reports `no anonymous pull token (403)` and the Docker tab stays hidden.

### Homebrew — you push the tap

```bash
gh repo create siri1410/homebrew-sdods --public -d 'Homebrew tap for SDODS'
```

Copy the rendered formula into the tap as `Formula/sdods.rb`, then verify it locally before anyone
installs from it. `--new` implies `--strict` and `--online` and is the check that catches a bad
`url`, a redundant `version` or a foreign-architecture binary (it is `--new`, not `--new-formula`,
which current Homebrew rejects):

```bash
brew audit --strict --new siri1410/sdods/sdods
```

```bash
brew install --build-from-source siri1410/sdods/sdods && brew test sdods
```

You can do all of that without publishing anything: `brew tap-new siri1410/sdods --no-git` makes a
local tap, and `brew untap siri1410/sdods` removes it.

The formula builds from the **npm tarball**, not from a clone, which is why the private source
repository is not a problem here.

Three things about it are load-bearing, and each was found by running it rather than reading it:

- **You cannot publish the formula the same day you publish the packages.** Homebrew's
  `std_npm_args` passes `--min-release-age=`, so npm refuses any dependency published inside that
  window: `No matching version found for @sdods/agents@X with a date before <date>`. The formula is
  correct; it is too new. Wait for the packages to age out, then install.
- **Foreign prebuilds must be deleted.** `better-sqlite3` ships prebuilt binaries for every
  platform and npm installs all of them; audit then fails with *"Binaries built for a non-native
  architecture were installed into sdods's prefix"*. The `install` block removes every
  `prebuilds/*` directory but this machine's.
- **`brew test` runs in an empty directory, so `sdods doctor` exits 1** — there are no projects to
  find, which is the right answer for a fresh install. The test asserts exit `1` deliberately;
  asserting `0` fails on a perfectly good install. It runs against Homebrew's `node`, which is
  well ahead of 22 — that path is tested, and the native modules resolve on it.

### Scoop — you push the bucket

```bash
gh repo create siri1410/scoop-sdods --public -d 'Scoop bucket for SDODS'
```

The manifest goes in as `bucket/sdods.json`. It installs the NSIS desktop installer silently with
`/S /D=$dir`; `/D` must be last and unquoted, which is an NSIS rule — quote it and the install
silently lands in the default directory instead of Scoop's.

### winget — you can open the PR, not merge it

```bash
wingetcreate submit --token <PAT> packaging/winget
```

Then it sits in Microsoft's review queue. Expect friction: the installers are **unsigned**, and
that is a thing their validation flags. See the `code-signing` skill — winget is the channel that
most wants the certificate.

### apt — a person runs the workflow

`.github/workflows/apt.yml`, triggered manually. It needs `SDODS_APT_GPG_KEY` (the armoured
private key of the **project** signing key, as a repository secret) and `DESKTOP_RELEASE_TOKEN`.
It refuses to build unsigned: an unsigned repo can only be added with `[trusted=yes]`, which
disables signature checking for everything else that machine installs.

The workflow proves the repo works before publishing it — it adds the built repo as a local apt
source and asserts `apt-cache policy sdods` reports an installable candidate. A repo that merely
looks right has been verified zero times. The `apt · flat repo layout` job in `ci.yml` runs the
same proof on every PR against a synthetic package, so the layout is exercised without a key.

**It is a standard `dists/` repository, not a flat one, and that is load-bearing.** A flat repo is
addressed with a `./` distribution, which puts a `./` segment into every path apt builds:

```
https://sdods.com/apt/./InRelease
```

Firebase Hosting answers that with a 302 to an internal origin host that 404s. The result is a
repository where every file is served correctly to `curl` on the normalised path, and every real
`apt update` fails with *"does not have a Release file"*. It shipped that way, and only an actual
`apt install` in a container found it — checking that the files were reachable was not the same
question.

`build-repo.sh` also scans the pool directory by name rather than `.`, because `apt-ftparchive
packages .` writes `Filename: ./pool/...` and that is the same broken segment one level down. And
it splits the index per architecture with awk rather than `apt-ftparchive --arch`, which matches
nothing here and silently writes an empty `Packages`.

**GitHub Pages has to be enabled on the releases repository** — Settings → Pages → source
`gh-pages` — or the workflow pushes the branch and the URL keeps 404ing.

## Adding a seventh channel

1. Add it to `INSTALL_CHANNELS` in `apps/www/lib/install-channels.ts` with `live: false`. Give it
   `under:` if it belongs inside another tab's panel rather than owning a tab — Scoop and winget
   sit under Windows because a visitor choosing how to install is choosing once, not three times.
2. Add a probe in `scripts/sync-channels.ts` and wire it into the `live` map. A channel with no
   probe can never go live, which is the correct failure.
3. Put its manifest template in `packaging/<manager>/` with `{{PLACEHOLDER}}` fields.
4. Add the command to the docs table in `getting-started/installation.mdx`.
5. `bunx vitest run tests/install-channels.test.ts`.
