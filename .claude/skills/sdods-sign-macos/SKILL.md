---
name: sdods-sign-macos
description: Step-by-step runbook to Developer ID sign and notarize the SDODS desktop app for macOS, with every human-in-the-loop gate marked. Use when asked to sign or notarize the Mac build, set up Apple Developer ID / notarytool / App Store Connect API key credentials, fix "SDODS is damaged" or "unidentified developer", turn on the macOS download or the macOS auto-updater, or rotate the Apple certificate.
---

# Signing and notarizing the SDODS macOS build

This is a runbook. Follow the steps in order. Each step ends with a **check**, and you do not move
on until that check passes. For the background (why sign at all, costs, free options, the Windows
side) see `code-signing`. For the release loop itself see `sdods-desktop-release`.

**Current state:** everything in the build is wired. The only missing pieces are credentials,
and only a person can obtain them. With no credentials, `scripts/after-pack.mjs` ad-hoc signs the
bundle, so users see "unidentified developer" and not "damaged".

Signing behaviour described here was checked against the `app-builder-lib` 26.16.1 source (the
version in `bun.lock`): `MacTargetHelper.notarizeIfProvided` and `platformPackager.getCscLink`.
Recheck both after an electron-builder upgrade.

---

## How human-in-the-loop (HITL) gates work

Some steps need a legal identity, a payment, Apple's own UI, or custody of a secret. An agent
cannot and must not do them. Each such step is marked like this:

> 🧑 **HUMAN STEP** — *what*
> - **Why a human:** the reason an agent cannot do it
> - **Do:** the exact clicks or commands
> - **Agent confirms with:** a command whose output proves the step is done

**Agent protocol at a gate:**

1. **Stop.** Print the step exactly as written, then wait.
2. **Never ask for a secret in chat.** No passwords, no `.p12`, no base64. The person runs
   the command in their own terminal. In Claude Code they can type `! <command>` so it runs
   in this session without the value passing through the model. Commands that read a secret
   read it from a file or from a hidden prompt (`gh secret set NAME` with no `--body` prompts
   for it).
3. **Confirm, don't trust.** When the person says "done", run the *Agent confirms with* check.
   If it fails, say exactly what is missing and stay at the gate.
4. **Record progress** in the PR or issue (for example #169) as a checklist, so a later session can
   resume without redoing gates.

Steps without the marker are safe for an agent: reading files, running verify commands,
triggering the dry-run workflow, and reading logs.

---

## Step 0 — Pre-flight (agent)

Confirm the wiring is intact before anyone spends money. Every item below must hold:

```bash
grep -n 'hardenedRuntime: true' apps/desktop/electron-builder.yml
grep -n 'entitlementsInherit'   apps/desktop/electron-builder.yml
grep -n 'Contents/Resources/node/bin/node' apps/desktop/electron-builder.yml   # mac.binaries
grep -n 'disable-library-validation' apps/desktop/build/entitlements.mac.plist
grep -n 'MAC_CSC_LINK\|APPLE_TEAM_ID' .github/workflows/desktop.yml
gh secret list | grep -E 'MAC_CSC|APPLE_' || echo 'no Apple secrets yet'
```

**Check:** all five greps match. If `gh secret list` already shows all five Apple secrets, skip to
Step 5.

---

## Step 1 — Apple Developer Program membership

> 🧑 **HUMAN STEP 1** — enrol in the Apple Developer Program ($99/year)
> - **Why a human:** legal identity, a payment, and Apple's two-factor sign-in.
> - **Do:** enrol at <https://developer.apple.com/programs/>.
>   - **Individual:** legal name and a card. Usually approved within hours to 2 days.
>   - **Organisation:** needs a D-U-N-S number as well. Allow 1–2 weeks.
>   - Choose one on purpose. The Developer ID's name is what macOS shows users, and
>     changing it later means a new certificate.
> - **Agent confirms with:** ask for the **Team ID** (10 characters, under developer portal →
>   Membership). It is not a secret. Record it in the tracking issue.

---

## Step 2 — Developer ID Application certificate

> 🧑 **HUMAN STEP 2** — create and export the signing certificate
> - **Why a human:** the private key is generated in the person's keychain and must stay in
>   their custody.
> - **Do:**
>   1. Xcode → Settings → Accounts → Manage Certificates → **+** → **Developer ID Application**.
>      Do not pick "Apple Distribution": that one is for the App Store and fails Gatekeeper.
>      (Only the Account Holder can create Developer ID certs on an organisation team.)
>   2. Keychain Access → My Certificates → right-click the new cert → Export → `.p12`, with a
>      strong password. Store the password in a password manager.
>   3. Back up the `.p12` and password somewhere offline. Losing them means revoking and
>      reissuing the certificate.
> - **Agent confirms with:**
>   ```bash
>   security find-identity -v -p codesigning | grep 'Developer ID Application'
>   ```
>   Expect one line of the form `Developer ID Application: <Name> (<TEAMID>)`, with the Team ID
>   from Step 1.

---

## Step 3 — Notarization credentials

Two ways work. electron-builder 26 turns notarization on **by itself** when either set of env
vars is present (`MacTargetHelper.notarizeIfProvided`), so `electron-builder.yml` needs no
`notarize:` key. Do not add `notarize: false`, because that switches notarization off.

| Option | Env vars | Use when |
|---|---|---|
| **A. App-specific password** (current wiring) | `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Quickest start. Tied to one person's Apple ID. |
| **B. App Store Connect API key** (recommended long-term) | `APPLE_API_KEY` (path to `.p8`), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | Not tied to a person, and can be revoked on its own. Needs a workflow change first, see *Future enhancements*. |

Use **Option A** now.

> 🧑 **HUMAN STEP 3** — create an app-specific password
> - **Why a human:** only the account owner can create it, and it requires 2FA.
> - **Do:** <https://appleid.apple.com> → Sign-In and Security → App-Specific Passwords →
>   **+** → label it `sdods-notarize`.
>   Optionally, to notarize from their own Mac, store it once in the keychain so it never
>   appears in an env var or log:
>   ```bash
>   xcrun notarytool store-credentials sdods-notary \
>     --apple-id <apple-id-email> --team-id <TEAMID>     # prompts for the password
>   ```
> - **Agent confirms with** (only if they stored the profile):
>   ```bash
>   xcrun notarytool history --keychain-profile sdods-notary
>   ```
>   An empty history with no auth error is a pass.

---

## Step 4 — Put the credentials in CI

> 🧑 **HUMAN STEP 4** — set five repository secrets
> - **Why a human:** secret custody. The values must never pass through chat or the model.
> - **Do**, in their own terminal (or `! ` in Claude Code), from the repo root:
>   ```bash
>   base64 -i ~/path/to/DeveloperID.p12 | gh secret set MAC_CSC_LINK
>   gh secret set MAC_CSC_KEY_PASSWORD            # prompts: the .p12 password
>   gh secret set APPLE_ID                        # prompts: Apple ID email
>   gh secret set APPLE_APP_SPECIFIC_PASSWORD     # prompts: from Step 3
>   gh secret set APPLE_TEAM_ID --body <TEAMID>   # not secret, but the workflow reads it as one
>   ```
>   Nothing is written to disk by the pipe. Delete any intermediate export you made.
> - **Agent confirms with:**
>   ```bash
>   gh secret list | grep -cE '^(MAC_CSC_LINK|MAC_CSC_KEY_PASSWORD|APPLE_ID|APPLE_APP_SPECIFIC_PASSWORD|APPLE_TEAM_ID)\b'
>   ```
>   Expect `5`. (`gh` shows names and dates, never values. That is how it should be.)

The names must match exactly. `desktop.yml` maps `MAC_CSC_LINK` → `CSC_LINK` and
`MAC_CSC_KEY_PASSWORD` → `CSC_KEY_PASSWORD`, and it unsets any that are empty.

The workflow unsets `CSC_*` and `APPLE_*` on the Windows and Linux runners. electron-builder's
Windows signer would otherwise fall back to `CSC_LINK` (the Apple `.p12`) when Azure is not
configured. Do not remove that `unset`. See *Troubleshooting*.

---

## Step 5 — Dry run without a release (agent)

`desktop.yml` has a `workflow_dispatch` with `publish: false`. It builds and uploads artifacts but
makes no release. Use it to prove signing works before any user can download anything.

```bash
gh workflow run desktop.yml --ref <branch> -f publish=false
gh run watch "$(gh run list --workflow desktop.yml -L1 --json databaseId -q '.[0].databaseId')"
```

In the **macos** job log, look for:

- `signing  file=release/mac-arm64/SDODS.app  identityName=Developer ID Application: …`
- `notarization successful` (or `notarizing` with no error after it)
- **Not** `skipped macOS signing` or `skipped macOS notarization`

Notarization usually takes 2–10 minutes, sometimes 15. Around major macOS releases it can take
30–60 minutes. A slow run is normal. The job's 60-minute timeout is the limit.

---

## Step 6 — Verify the artifact (agent downloads, human double-clicks)

Download it and verify it with Apple's own tools:

```bash
gh run download <run-id> -n sdods-desktop-macOS -D "$TMPDIR/mac"
hdiutil attach "$TMPDIR/mac/SDODS-"*-mac-arm64.dmg -nobrowse -mountpoint "$TMPDIR/dmg"
APP="$TMPDIR/dmg/SDODS.app"
codesign --verify --deep --strict --verbose=2 "$APP"                  # valid on disk
codesign -dv --verbose=4 "$APP" 2>&1 | grep -E 'Authority|TeamIdentifier|Runtime'
codesign -dv "$APP/Contents/Resources/node/bin/node" 2>&1 | grep Authority   # bundled Node signed too
spctl -a -vvv -t install "$APP"          # expect: accepted  source=Notarized Developer ID
xcrun stapler validate "$APP"            # expect: The validate action worked!
hdiutil detach "$TMPDIR/dmg"
```

**Check:** all six pass. `Authority=Developer ID Application: …`, `flags=0x10000(runtime)` present,
and `source=Notarized Developer ID`.

> 🧑 **HUMAN STEP 6** — the real Gatekeeper test
> - **Why a human:** needs a clean machine and a real quarantined download. Tool checks on the
>   build machine are not the same thing.
> - **Do:** on a Mac that has never run SDODS, download the `.dmg` in a browser (so it gets
>   the quarantine flag), drag the app to Applications, and **double-click** it. There should be
>   no warning beyond the standard "downloaded from the Internet — Open?". Then run the
>   `sdods-desktop-release` smoke test: Runs → Start run → `ui` / `chromium` / `@smoke`, which
>   passes 4/0/0. That run proves `disable-library-validation` still works for the native modules.
> - **Agent confirms with:** the person's report plus a screenshot of the first-launch dialog.
>   Anything mentioning "damaged" or "unidentified" is a fail.

---

## Step 7 — Release it

Follow `sdods-desktop-release` → *The loop* (tag `desktop-v*`, the workflow drafts the release).

> 🧑 **HUMAN STEP 7** — publish the draft release
> - **Why a human:** the draft is the deliberate gate before anyone can download. Read the
>   `virustotal` job summary first.
> - **Do:** fix the release body. It still says "These builds are unsigned" (see *After signing
>   works*). Then publish the draft in `YarlisAISolutions/sdods-releases`.
> - **Agent confirms with:**
>   `gh release view desktop-v<ver> -R YarlisAISolutions/sdods-releases --json isDraft -q .isDraft`
>   → `false`.

---

## After signing works (agent proposes, human merges)

1. `bun run desktop:sync-release desktop-v<ver> --signed=macos`, or `--signed=macos,windows` if
   Windows is signed too. This removes the Gatekeeper warning and the `xattr` install step for
   macOS only. The Windows SmartScreen advice stays until Windows is named. A bare `--signed` is
   refused.
2. Add `macos` to `NEXT_PUBLIC_DESKTOP_PLATFORMS` (for example `macos,linux`). macOS can go live
   without waiting on Windows.
3. **The macOS updater arms itself.** `electron.vite.config.ts` sets `__DESKTOP_SIGNED__` from
   `CSC_LINK`, and CI maps it from `MAC_CSC_LINK`, so signed builds ship with the updater on.
   Squirrel.Mac only installs updates into a signed app. Users on earlier unsigned builds must
   download once by hand.
4. Make the `release` job's body text conditional, or drop the "unsigned" paragraph.
5. Tick the macOS items in #169 and update `sdods-desktop-release` → *Updates* (the macOS row).

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `skipped macOS signing` + `identity not found` | `MAC_CSC_LINK` is not base64 of a `.p12`, or it is an "Apple Distribution" cert | Re-export a **Developer ID Application** `.p12`, then `base64 -i` it again |
| `apps/desktop not a file` | `CSC_LINK` set to an empty string | The workflow unsets empties. Check nobody removed that loop. |
| Notarization `Invalid` | Check the log: `xcrun notarytool log <submission-id> --keychain-profile sdods-notary` | Usually an unsigned nested binary. Add it to `mac.binaries`. |
| Notarized, then dies at first DB open with a dyld error | `disable-library-validation` was removed | Restore it in `build/entitlements.mac.plist` |
| `spctl` says `rejected`, `source=Unnotarized Developer ID` | Notarization skipped. One of the three `APPLE_*` vars is missing. | `gh secret list`, then re-run |
| Updater still dormant on a signed build | Signed from the keychain (`CSC_NAME`) with no `CSC_LINK` | Build with `DESKTOP_SIGNED=1` |
| **Windows job fails to sign, or signs with an Apple cert** | Someone removed the non-macOS `unset` in `desktop.yml`. electron-builder's Windows signer uses `WIN_CSC_LINK ?? CSC_LINK` (`platformPackager.getCscLink`) when `azureSignOptions` is absent | Restore the `runner.os != macOS` unset of `CSC_*`/`APPLE_*` in *Build installers* |

---

## Rotation and expiry

- Developer ID certificates last **5 years**. Anything signed **and notarized** keeps working after
  the cert expires, because the notarization ticket carries the timestamp. Put a calendar reminder
  for 60 days before expiry.
- Membership lapses yearly. A lapsed membership **cannot notarize**, which blocks releases, but
  shipped apps keep working.
- Rotation repeats Steps 2 and 4 (🧑). Revoke a certificate only if its key leaked: revocation
  can invalidate already-shipped builds.
- Rotate the app-specific password whenever the person who owns it leaves.

---

## Future enhancements (in priority order)

1. **Switch notarization to an App Store Connect API key (Option B).** Create a Team key with
   the *Developer* role, store the `.p8` as a secret, and write it to `$RUNNER_TEMP/key.p8` in the
   macOS job. Export `APPLE_API_KEY`, `APPLE_API_KEY_ID` and `APPLE_API_ISSUER` in place of the
   `APPLE_ID` trio. This removes the dependency on one person's Apple ID.
2. **Add a CI gate like the Windows one:** when `MAC_CSC_LINK` is set, fail the build unless
   `spctl -a -t install` reports `Notarized Developer ID` for each `.app`. Right now a silent
   notarization skip would still publish.
3. **Staple and verify the `.dmg` itself**, not just the app. electron-builder notarizes the app.
   Notarizing the dmg too lets offline first launches pass.
4. **electron-builder v27:** check `mac.notarize` and signing option names when upgrading
   (`electron-builder migrate-schema`).
5. **Mac App Store (`mas`) target:** a separate "Apple Distribution" cert, a provisioning profile
   and sandbox entitlements. The sandbox conflicts with spawning a bundled Node, so treat this as a
   research spike first.
