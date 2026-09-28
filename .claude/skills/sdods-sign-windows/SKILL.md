---
name: sdods-sign-windows
description: Step-by-step runbook to Authenticode-sign the SDODS desktop Windows installers (Azure Artifact Signing, SignPath Foundation or an OV certificate), with every human-in-the-loop gate marked. Use when asked to sign the Windows build, set up Azure Artifact Signing / Trusted Signing, a service principal or certificate profile, apply to SignPath, fix SmartScreen warnings, unblock the winget submission, or rotate the Windows signing credentials.
---

# Signing the SDODS Windows installers

This is a runbook. Follow the steps in order. Each step ends with a **check**, and you do not move
on until that check passes. For the background (why sign, EV myths, cost floors, the macOS side)
see `code-signing`. For the release loop see `sdods-desktop-release`. For winget see
`sdods-release-channels`.

**Current state:** the Azure route is fully wired in `.github/workflows/desktop.yml` (#169). It
turns on when `AZURE_CLIENT_ID` is set, fails if any of the other six values is missing, and fails
the build if any `.exe` is not validly signed. The only missing pieces are credentials, and only a
person can obtain them. It all runs on GitHub's Windows runner, so the whole setup can be done
from a Mac.

Signing behaviour described here was checked against the `app-builder-lib` 26.16.1 source (the
version in `bun.lock`): `windowsCodeSign.js` (Azure wins when `azureSignOptions` is set) and
`platformPackager.getCscLink` (`WIN_CSC_LINK` falls back to `CSC_LINK`). Recheck both after an
electron-builder upgrade.

---

## How human-in-the-loop (HITL) gates work

Some steps need a legal identity, a payment, identity verification, a cloud portal, or custody of
a secret. An agent cannot and must not do them. Each such step is marked like this:

> 🧑 **HUMAN STEP** — *what*
> - **Why a human:** the reason an agent cannot do it
> - **Do:** the exact clicks or commands
> - **Agent confirms with:** a command whose output proves the step is done

**Agent protocol at a gate:**

1. **Stop.** Print the step exactly as written, then wait.
2. **Never ask for a secret in chat.** No client secrets, no PFX, no passwords. The person runs
   the command in their own terminal. In Claude Code they can type `! <command>` so it runs in
   this session without the value passing through the model. `gh secret set NAME` with no
   `--body` prompts for the value.
3. **Confirm, don't trust.** When the person says "done", run the *Agent confirms with* check.
   If it fails, say exactly what is missing and stay at the gate.
4. **Record progress** in the PR or issue (for example #169) as a checklist, so a later session can
   resume without redoing gates.

Steps without the marker are safe for an agent: reading files, running verify commands,
triggering the dry-run workflow, and reading logs.

---

## Step 0 — Choose the route (human decides, agent advises)

This decision determines everything that follows. Ask these questions in order:

```
Is the signer an individual in the USA/Canada, or an org in USA/Canada/EU/UK?
 ├─ yes → Route A: Azure Artifact Signing   (~$9.99/month, CI-native, wired today)  ← preferred
 └─ no  → Is it acceptable that SignPath signs via their pipeline and names "SignPath Foundation"?
          ├─ yes → Route B: SignPath Foundation (free for OSS; SDODS is public + Apache-2.0)
          └─ no  → Route C: OV certificate on a CA cloud HSM ($150–300/year)
```

> 🧑 **HUMAN STEP 0** — pick A, B or C
> - **Why a human:** eligibility depends on the person's legal residence or entity, and it is
>   their money.
> - **Agent confirms with:** record the chosen route in #169. **Use only one identity for
>   every release.** SmartScreen reputation belongs to the publisher identity, so switching
>   routes later resets it.

Never ship a self-signed certificate publicly. Windows blocks it harder than an unsigned file.

---

## Route A — Azure Artifact Signing (preferred)

Formerly "Azure Trusted Signing". Generally available since April 2026.

### A1 — Account and identity validation

> 🧑 **HUMAN STEP A1** — create the signing account and pass identity validation
> - **Why a human:** Azure billing, and government-ID verification through au10tix.
> - **Do:**
>   1. Azure portal → create (or pick) a subscription and resource group, for example `rg-sdods-signing`.
>   2. Create an **Artifact Signing** account. Choose the region nearest the CI, for example `East US`.
>      Pick the **Basic** SKU (5,000 signatures/month is plenty).
>   3. On the account → Access control (IAM) → assign **yourself** the **…Identity Verifier**
>      role. Without it the validation page stays greyed out, which is where most people get stuck.
>      The role names changed with the Trusted → Artifact Signing rename, so list them instead of
>      guessing:
>      ```bash
>      az role definition list --query "[?contains(roleName,'Signing')].roleName" -o tsv
>      ```
>      Pick the row ending in `Identity Verifier` here, and the row ending in
>      `Certificate Profile Signer` in A3.
>   4. Identity validation → **New** → Public Trust → Individual (self-employed) or Organisation.
>      This takes a few business days.
> - **Agent confirms with** (the person must be `az login`'d):
>   ```bash
>   az resource list --resource-type Microsoft.CodeSigning/codeSigningAccounts -o table
>   ```
>   The account is listed. The portal shows identity validation as **Completed**. Ask for a
>   screenshot of the status. There is no CLI for it.

### A2 — Certificate profile

> 🧑 **HUMAN STEP A2** — create a Public Trust certificate profile
> - **Why a human:** it binds the validated legal identity to a certificate. This cannot be undone
>   without re-validation.
> - **Do:** account → Certificate profiles → **Create** → type **Public Trust** → pick the
>   completed validation → name it, for example `sdods-public`.
> - **Agent confirms with:** ask for the profile name and the **Subject CN** shown on it (both
>   are not secret). The CN becomes `AZURE_SIGN_PUBLISHER` and must match **exactly**, including
>   case, punctuation and the `CN=` value only.

### A3 — Service principal for CI

> 🧑 **HUMAN STEP A3** — create a least-privilege identity for GitHub Actions
> - **Why a human:** it creates a credential that can sign as the person's legal identity.
> - **Do:**
>   ```bash
>   az ad sp create-for-rbac --name sdods-ci-signing --skip-assignment   # prints appId, tenant, password
>   ACCOUNT_ID=$(az resource show -g rg-sdods-signing -n <account> \
>     --resource-type Microsoft.CodeSigning/codeSigningAccounts --query id -o tsv)
>   az role assignment create --assignee <appId> \
>     --role "<the …Certificate Profile Signer name from the A1 listing>" \
>     --scope "$ACCOUNT_ID/certificateProfiles/<profile>"
>   ```
>   Scope the role to the **profile**, not the subscription. Set the client-secret expiry to
>   12 months or less and add a calendar reminder.
> - **Agent confirms with:**
>   ```bash
>   az role assignment list --assignee <appId> --all -o table
>   ```
>   Exactly one Signer role, scoped to the profile.

### A4 — Put the credentials in CI

> 🧑 **HUMAN STEP A4** — set 3 secrets and 4 variables
> - **Why a human:** secret custody.
> - **Do**, in their own terminal (or `! ` in Claude Code), from the repo root:
>   ```bash
>   gh secret set AZURE_TENANT_ID           # prompts
>   gh secret set AZURE_CLIENT_ID           # prompts (the appId)
>   gh secret set AZURE_CLIENT_SECRET       # prompts (the password from A3)
>   gh variable set AZURE_SIGN_ENDPOINT  --body 'https://eus.codesigning.azure.net/'   # region's endpoint
>   gh variable set AZURE_SIGN_ACCOUNT   --body '<account name>'
>   gh variable set AZURE_SIGN_PROFILE   --body '<profile name>'
>   gh variable set AZURE_SIGN_PUBLISHER --body '<Subject CN, exactly>'
>   ```
> - **Agent confirms with:**
>   ```bash
>   gh secret list   | grep -cE '^AZURE_(TENANT_ID|CLIENT_ID|CLIENT_SECRET)\b'          # 3
>   gh variable list | grep -cE '^AZURE_SIGN_(ENDPOINT|ACCOUNT|PROFILE|PUBLISHER)\b'   # 4
>   gh variable list | grep AZURE_SIGN_                # eyeball endpoint region + CN spelling
>   ```

**Do not put `azureSignOptions` in `electron-builder.yml`.** Once that block exists, every local
and fork build tries Azure and fails. The workflow passes it as `-c.win.azureSignOptions.*` only
when `AZURE_CLIENT_ID` is set.

Then go to **Step 5**.

---

## Route B — SignPath Foundation (free, open source)

SDODS became public on 2026-09-26 and is Apache-2.0, so it now plausibly qualifies. Conditions:
an OSI licence with no commercial dual-licensing, no proprietary components, active maintenance,
and the release already published in the form to be signed.

> 🧑 **HUMAN STEP B1** — apply at <https://signpath.org/apply>
> - **Why a human:** a legal agreement on behalf of the project. It takes days to weeks.
> - **Agent confirms with:** the acceptance email, and the organisation and project slugs.

Wiring is **not built yet**. SignPath signs *their* copy of an artifact that GitHub Actions
uploads, through `signpath/github-action-submit-signing-request`, then hands it back. An agent can
draft this as a PR:

- build unsigned → upload an artifact → a submit-signing-request step (`SIGNPATH_API_TOKEN`
  secret; organisation, project and signing-policy IDs as variables) → download the signed
  output → run the same `Get-AuthenticodeSignature` gate → attach.
- The `latest.yml` sha512 must be regenerated from the **signed** installer, or the updater
  rejects it.

> 🧑 **HUMAN STEP B2** — set `SIGNPATH_API_TOKEN`, review and merge the wiring PR, then
> **approve each signing request** in the SignPath UI. SignPath requires a human approval on
> release signing. That is by design, and it becomes part of every release.

Then go to **Step 5**.

---

## Route C — OV certificate (fallback)

Since June 2023 the private key must live on a hardware token or HSM. A USB token cannot be plugged
into a GitHub-hosted runner, so buy a **cloud-HSM** product (DigiCert KeyLocker, SSL.com eSigner,
GlobalSign and similar).

> 🧑 **HUMAN STEP C1** — buy the OV cert with cloud HSM and pass the CA's organisation validation.
> **Agent confirms with:** the CA dashboard shows the cert as issued, and the Subject CN is recorded.

Wiring varies by CA. Either use `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` (only if the CA
exports a PFX, which most no longer do), or use the CA's signing tool from a custom `win.sign`
hook. The agent drafts the hook as a PR. The 🧑 human sets the CA's API secrets and merges.

---

## Step 5 — Dry run without a release (agent)

```bash
gh workflow run desktop.yml --ref <branch> -f publish=false
gh run watch "$(gh run list --workflow desktop.yml -L1 --json databaseId -q '.[0].databaseId')"
```

In the **windows** job, check for:

- `Windows signing: Azure Artifact Signing (<account>/<profile>)` in *Build installers*
- the **Verify the Windows installers are signed** step lists every `.exe` as `Valid` with your
  CN (the setup exe **and** `win-*/SDODS.exe`, for x64 and arm64)

**Check:** that step is green. It fails the job on any unsigned exe, so green means signed.

---

## Step 6 — Verify the artifact

Agent, from a Mac or Linux machine:

```bash
gh run download <run-id> -n sdods-desktop-Windows -D "$TMPDIR/win"
# osslsigncode (brew install osslsigncode) reads Authenticode without Windows
osslsigncode verify -in "$TMPDIR/win/SDODS-Setup-"*-win-x64.exe | grep -E 'Subject|Signature verification|Timestamp'
```

Expect your CN, `Signature verification: ok`, and a **timestamp**. Without a timestamp the
signature dies when the short-lived Azure cert expires (every ~3 days).

> 🧑 **HUMAN STEP 6** — the real SmartScreen test
> - **Why a human:** needs a clean Windows machine and a browser download that carries Mark of
>   the Web.
> - **Do:** on a Windows PC that has never run SDODS, download the installer in Edge, then
>   right-click it → Properties → **Digital Signatures** and check that it shows your CN. Run it.
>   **Expect SmartScreen to still warn on the first releases.** Reputation builds as downloads
>   accumulate, and "Publisher: <your CN>" in place of "Unknown publisher" is the success signal
>   for now. Finish with the smoke run from `sdods-desktop-release` (4/0/0).
> - **Agent confirms with:** a screenshot of the Digital Signatures tab and of the SmartScreen
>   dialog, if any, showing the publisher name.

---

## Step 7 — Release it

Follow `sdods-desktop-release` → *The loop*.

> 🧑 **HUMAN STEP 7** — edit the draft's "These builds are unsigned" text, read the
> `virustotal` summary, and publish the draft.
> **Agent confirms with:** `gh release view desktop-v<ver> -R YarlisAISolutions/sdods-releases --json isDraft -q .isDraft` → `false`.

---

## After signing works (agent proposes, human merges)

1. `bun run desktop:sync-release desktop-v<ver> --signed=windows`, or `--signed=macos,windows`
   (same as `--signed=all`) if macOS is signed too. Only the platforms you name lose their
   workaround text. A bare `--signed` is refused. Signed Windows keeps a softer SmartScreen note,
   because reputation takes several releases to build.
2. Add `windows` to `NEXT_PUBLIC_DESKTOP_PLATFORMS`.
3. `bun run channels:sync`, then submit to winget (`sdods-release-channels`). winget validation
   was the channel waiting for this signature.
4. Make the release body in `desktop.yml` conditional.
5. Tick the Windows items in #169.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `AZURE_CLIENT_ID is set but X is not` | One of the other six missing | `gh secret list` / `gh variable list`, then set it |
| `403` / `Forbidden` from codesigning endpoint | Role missing or scoped wrong, or wrong region endpoint | Recheck A3's role assignment, and match `AZURE_SIGN_ENDPOINT` to the account's region |
| `publisherName` mismatch / signature invalid | `AZURE_SIGN_PUBLISHER` ≠ Subject CN | Copy the CN exactly from the profile |
| `401` after months of working | Client secret expired | Rotate (A3 + A4) |
| Signed with an **Apple** identity, or `Env WIN_CSC_LINK is not correct` | `CSC_LINK` (from `MAC_CSC_LINK`) reached the Windows runner. electron-builder falls back `WIN_CSC_LINK ?? CSC_LINK` when Azure is off | `desktop.yml` unsets the Apple env on non-macOS runners. Restore it if removed. |
| Verify step lists `NotSigned` on `win-*/SDODS.exe` only | Only the installer was signed | Check the electron-builder log. Both must be signed, and the gate is correct to fail. |
| Updater rejects a SignPath-signed build | `latest.yml` sha512 computed before signing | Regenerate after signing (Route B note) |

---

## Rotation and expiry

- **Azure:** the certificates are short-lived and renew automatically. Only the **service
  principal secret** expires. Rotating it repeats 🧑 A3 (new secret) and A4
  (`gh secret set AZURE_CLIENT_SECRET`). Identity validation must be renewed periodically, so watch
  the Azure email.
- **OV:** a yearly renewal. Keep the **same subject** so reputation carries over.
- Never let signing lapse between releases. An unsigned release in the middle of signed ones
  resets user trust and fails the workflow's own gate.

---

## Future enhancements (in priority order)

1. **Use OIDC federated credentials in place of `AZURE_CLIENT_SECRET`.** `azure/login@v2` with
   `id-token: write` and a federated credential on the service principal for
   `repo:YarlisAISolutions/SDODS:ref:refs/tags/desktop-v*`. This removes the only expiring secret.
   Check that electron-builder's Azure signer picks up the `az` CLI credential
   (`DefaultAzureCredential`) before removing the secret.
2. **Protect signing behind a GitHub Environment** (`signing`) with required reviewers, so a tag
   push waits for a 🧑 approval before any credential is exposed. This is a HITL gate that
   GitHub enforces.
3. **Sign the uninstaller and the NSIS plugins.** Confirm with `osslsigncode` against an
   unpacked install that nothing unsigned lands in `%LOCALAPPDATA%\Programs\SDODS`.
4. **electron-builder v27:** `win.azureSignOptions` becomes the `win.sign` union
   (`type: 'azure'`). Update the `-c.` flags in `desktop.yml` when upgrading
   (`electron-builder migrate-schema`).
5. **MSIX / Microsoft Store:** Store-signed, so there is no SmartScreen at all. This needs a
   Partner Center account (🧑) and a separate target. Evaluate once winget is live.
