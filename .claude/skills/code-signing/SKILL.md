---
name: code-signing
description: Obtain and wire code-signing certificates for the SDODS desktop app so macOS Gatekeeper and Windows SmartScreen stop blocking it. Use when asked about signing, notarization, Gatekeeper, SmartScreen, "app is damaged", "unidentified developer", Developer ID certificates, Azure Artifact Signing, or why the installers show security warnings.
---

# Signing the SDODS desktop installers

Unsigned installers work, but every user is told not to run them. macOS refuses a double-click
("SDODS is damaged" or "unidentified developer") and Windows SmartScreen interrupts the install.
That undercuts the one-click promise more than any technical problem in the app.

Signing also gates a distribution channel: **winget's validation flags unsigned installers**, so the `microsoft/winget-pkgs` submission is the one that most wants the certificate. See the `sdods-release-channels` skill for the rest of that pipeline.

**Everything in the build is already wired.** Supply the credentials as CI secrets and signing turns
on with no code change. What cannot be automated is acquiring the certificates: both require a
person's legal identity and a payment.

Facts below were verified against Microsoft and Apple documentation in September 2026. Two pieces
of widely repeated advice are now **wrong** — see the corrections at the end.

---

## macOS — Gatekeeper

### What to buy

**Apple Developer Program, $99/year.** There is no free path that satisfies Gatekeeper. Enrol at
<https://developer.apple.com/programs/>. Individual enrolment needs a legal name and payment;
organisation enrolment additionally needs a D-U-N-S number and takes longer.

### What to create

A **Developer ID Application** certificate — *not* "Apple Distribution", which is for the App
Store and will not satisfy Gatekeeper for direct download.

1. Xcode → Settings → Accounts → Manage Certificates → **+** → Developer ID Application.
   (Or Certificates, Identifiers & Profiles on the developer portal with a CSR.)
2. Export it from Keychain Access as a `.p12` with a strong password.
3. Base64 it for CI: `base64 -i cert.p12 | pbcopy`.

### Notarization credentials

Notarization is a separate step: Apple scans the signed app and issues a ticket. It needs an
**app-specific password**, not your Apple ID password — create one at <https://appleid.apple.com>
under Sign-In and Security. You also need your **Team ID** (developer portal → Membership).

Locally, store credentials in the keychain once so the secret never reaches an env var or a log:

```bash
xcrun notarytool store-credentials sdods-notary \
  --apple-id you@example.com --team-id ABCDE12345 --password <app-specific-password>
```

### CI secrets

| Secret | Value |
|---|---|
| `MAC_CSC_LINK` | base64 of the `.p12` |
| `MAC_CSC_KEY_PASSWORD` | the `.p12` password |
| `APPLE_ID` | the Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | app-specific password |
| `APPLE_TEAM_ID` | 10-character Team ID |

`.github/workflows/desktop.yml` already passes all five. electron-builder signs and notarizes when
they are present and silently skips when they are not, so unsigned builds keep working.

### What is already correct in this repo

- `hardenedRuntime: true` — required for notarization.
- `entitlements` **and** `entitlementsInherit` both point at `build/entitlements.mac.plist`.
- That plist sets `com.apple.security.cs.disable-library-validation`. **Do not remove it.** The app
  runs `.node` native modules that npm downloads at runtime; to the hardened runtime those are
  unsigned code, so without this the app notarizes successfully and then dies at first database
  open with an opaque dyld error.
- `mac.binaries` lists `Contents/Resources/node/bin/node`, so the bundled Node runtime is signed
  too. A second executable inside the bundle is not signed automatically.

### Timing

`notarytool` typically returns in 2–10 minutes for a 100–200 MB bundle, ~15 at the 95th percentile.
Around major macOS releases it can take 30–60. Budget for it in the release process; it is not a
sign that something is wrong.

### Verifying

```bash
codesign --verify --deep --strict --verbose=2 /Applications/SDODS.app
spctl -a -vvv -t install /Applications/SDODS.app     # expect "accepted / Notarized Developer ID"
xcrun stapler validate /Applications/SDODS.app
```

### Until certificates exist

Users can bypass Gatekeeper themselves — right-click SDODS in Applications → **Open** → confirm.
macOS remembers the choice. The download page prints this automatically while
`DESKTOP_RELEASE.signed` is false. `xattr -dr com.apple.quarantine /Applications/SDODS.app` also
works but is worse advice to give strangers.

---

## Windows — SmartScreen

### The gating question: where are you?

**Azure Artifact Signing** (formerly Azure Trusted Signing) is the best option, but it is
geographically restricted:

- **Individual developers: USA and Canada only.**
- Organisations: USA, Canada, EU, UK.

If you are an individual outside the US/Canada, this route is closed and an OV certificate is the
answer. Settle this before spending time on Azure — it determines the whole path.

### Option A — Azure Artifact Signing (preferred where available)

Generally available since April 2026. ~**$9.99/month** for 5,000 signatures and one certificate
profile ($99.99/month for 100,000 and ten profiles) — cheaper than any traditional certificate,
and **no hardware token**, which is what makes it work in CI at all.

Individuals may now apply as self-employed; the 3-years-of-history requirement from the preview
was dropped at GA. Identity validation runs through a third party (au10tix) and takes a few
business days.

Setup:

1. Azure subscription → create an **Artifact Signing** account (pick the region nearest your CI).
2. Complete identity validation. Assign yourself the **Identity Verifier** role — validation
   cannot be completed without it, which is the usual place people get stuck.
3. Create a **certificate profile** (type: Public Trust).
4. Create a service principal for CI and grant it **Code Signing Certificate Profile Signer** on
   the account.

Then set, on the repository (Settings → Secrets and variables → Actions):

| Kind | Name | Value |
|---|---|---|
| secret | `AZURE_TENANT_ID` | the service principal's tenant |
| secret | `AZURE_CLIENT_ID` | the service principal's app (client) ID |
| secret | `AZURE_CLIENT_SECRET` | the service principal's client secret |
| variable | `AZURE_SIGN_ENDPOINT` | `https://<region>.codesigning.azure.net/` |
| variable | `AZURE_SIGN_ACCOUNT` | the Artifact Signing account name |
| variable | `AZURE_SIGN_PROFILE` | the certificate profile name |
| variable | `AZURE_SIGN_PUBLISHER` | the subject CN on the certificate, exactly |

**Do not put `azureSignOptions` in `electron-builder.yml`.** Once that block exists,
electron-builder always signs through Azure and fails without credentials, which breaks every local
and fork build. `desktop.yml` passes it as `-c.win.azureSignOptions.*` only when `AZURE_CLIENT_ID`
is set, fails if any of the other six is missing, and then fails the build if any Windows `.exe`
is not validly Authenticode-signed. All of this runs on GitHub's Windows runner, so it can be set
up entirely from a Mac.

**Version note:** `azureSignOptions` is electron-builder v26 syntax, which is what this repo pins
(26.15.3, the current release). v27 collapses Windows signing into a single `win.sign`
discriminated union (`type: 'signtool' | 'hsm' | 'pkcs11' | 'azure'`) and removes
`win.azureSignOptions` / `win.signtoolOptions`; `electron-builder migrate-schema` rewrites it.
Check which major version is installed before copying config from a blog post.

### Option B — OV certificate

From DigiCert, Sectigo, GlobalSign and similar. **$150–300/year.**

Since June 2023 the CA/Browser Forum requires the private key to live on an HSM or hardware token.
That is the real cost: a USB token cannot be plugged into a GitHub-hosted runner, so you either use
the CA's cloud HSM option or sign on a self-hosted runner. Choose a cloud-HSM product if you want
CI signing at all.

Wire it through the existing `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` secrets, or the CA's own
signing tool via a custom `sign` hook.

### Option C — self-signed

Testing and enterprise-managed fleets only. Windows does not trust it, so public users get a
**stronger** block than with no signature at all. Never ship this publicly.

### Reputation

Signing does not remove SmartScreen warnings on day one. Reputation accrues to the publisher
identity as releases are downloaded and run without incident. What matters is signing **every**
release with the **same** identity — switching certificates resets the accumulated trust.

---

## Linux

No signing is required: AppImage and `.deb` install without any equivalent of Gatekeeper. Optional
hardening if it becomes useful:

- GPG-sign the `.deb` and publish the public key.
- Ship a `.zsync` file beside the AppImage for delta updates.

`SHA256SUMS.txt` already ships with every release, which is the verification most Linux users
expect.

---

## Two corrections to common advice

**EV certificates no longer bypass SmartScreen.** They did — instantly, on first download — which
is why almost every older guide recommends paying the EV premium for a new app. **Microsoft removed
that behaviour in 2024.** EV-signed files now build reputation exactly like OV-signed ones. An
existing EV certificate is still perfectly valid; buying one *specifically* to skip SmartScreen is
no longer justified. (I gave this outdated advice earlier in this project.)

**"Azure Trusted Signing" is now "Azure Artifact Signing."** Same service, renamed. Search results
and documentation are split across both names, and the individual-developer eligibility rules
changed at GA — preview-era pages saying individuals cannot sign up are out of date.

---

## Is there a free option?

**Windows: yes, but only for open source.** [SignPath Foundation](https://signpath.org/terms)
gives qualifying projects free OV-level signing through a managed pipeline. Their conditions:

- an **OSI-approved licence with no commercial dual-licensing** — Apache-2.0 qualifies;
- **no proprietary or non-open-source components**, including code from the maintainer;
- actively maintained, already released in the form to be signed, and functionality described on
  the download page.

SDODS is Apache-2.0, so the licence is fine — but the repository is **private**, and the programme
is for open-source projects. Today it does not qualify. Making the source public would unlock it,
and would also remove the need for the separate public releases repo and let the
`NEXT_PUBLIC_REPO_PUBLIC` flags across both sites switch on. Applications take days to weeks.

**macOS: no.** There is no free path to a Developer ID certificate or to notarization. A free Apple
ID signs for local development only; the result still fails Gatekeeper on anyone else's Mac. The
$99/year membership is unavoidable for direct distribution.

**Linux: already free** — nothing to sign.

So the realistic floors are **$99/year** (Apple, plus SignPath for Windows if the source goes
public) or **~$219/year** (Apple plus Azure Artifact Signing at $9.99/month) with the source
staying private.

---

## After signing works

1. Verify a real download on a machine that has never seen the app, not the build machine.
2. Sync the download page with `--signed`, which removes the Gatekeeper/SmartScreen instructions:
   ```bash
   bun run desktop:sync-release desktop-v0.1.0 --signed
   ```
3. Enable `electron-updater` for the app shell. It was left off deliberately: Squirrel.Mac
   **refuses to install an unsigned update**, so auto-update only becomes real once macOS signing
   is in place. See the `sdods-desktop-release` skill.
