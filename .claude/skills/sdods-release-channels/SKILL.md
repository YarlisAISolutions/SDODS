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

`release.yml` runs changesets on every push to `main`. `scripts/publish-npm.sh` prints a
`New tag: <pkg>@<version>` line per package, which is the **only** signal changesets/action reads
to set its `published` output. Do not remove it: without it a successful publish reads as "nothing
published" and the image job below never runs. That was the actual bug.

### Docker — automatic, after npm

Gated on `needs.changesets.outputs.published`, not on a `v*` tag. It used to gate on the tag and
nothing in this repository creates one, so the job had never run and the image did not exist.
Do not "fix" it by pushing a tag from CI: a tag pushed with `GITHUB_TOKEN` does not trigger
workflows, so the job still would not run.

**GHCR packages default to private, and visibility is a UI-only setting.** After the first push:
Profile → Packages → `sdods-server` → Package settings → Change visibility → Public. Until then
`channels:sync` reports `no anonymous pull token (403)` and the Docker tab stays hidden.

### Homebrew — you push the tap

```bash
gh repo create siri1410/homebrew-sdods --public -d 'Homebrew tap for SDODS'
```

Copy the rendered formula into the tap as `Formula/sdods.rb`, then audit it before anyone installs
from it. `--new-formula` is stricter than the default and is what catches a bad `url` or a missing
license:

```bash
brew audit --strict --online --new-formula ./Formula/sdods.rb
```

```bash
brew install --build-from-source ./Formula/sdods.rb && sdods doctor
```

The formula builds from the **npm tarball**, not from a clone, which is why the private source
repository is not a problem here.

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
looks right has been verified zero times.

## Adding a seventh channel

1. Add it to `INSTALL_CHANNELS` in `apps/www/lib/install-channels.ts` with `live: false`. Give it
   `under:` if it belongs inside another tab's panel rather than owning a tab — Scoop and winget
   sit under Windows because a visitor choosing how to install is choosing once, not three times.
2. Add a probe in `scripts/sync-channels.ts` and wire it into the `live` map. A channel with no
   probe can never go live, which is the correct failure.
3. Put its manifest template in `packaging/<manager>/` with `{{PLACEHOLDER}}` fields.
4. Add the command to the docs table in `getting-started/installation.mdx`.
5. `bunx vitest run tests/install-channels.test.ts`.
