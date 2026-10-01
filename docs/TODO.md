# TODO — open work, as stories

The open GitHub issues on [YarlisAISolutions/sdods](https://github.com/YarlisAISolutions/sdods/issues),
rewritten as user stories with acceptance criteria. Each one is blocked on a person (an account, a
payment, a legal agreement or an outside reviewer), so each lists the **next human step** and the
**skill** an agent follows to carry the rest.

The issue is the source of truth for the checklist; this page is the overview. Update it when an
issue moves, and delete a story when its issue closes.

_Last reviewed: 2026-10-01._

| # | Story | Blocked on | Skill | Status |
|---|---|---|---|---|
| [#169](https://github.com/YarlisAISolutions/sdods/issues/169) | Mac users open the desktop app without warnings | Apple Developer Program enrolment ($99/yr) | `sdods-sign-macos` | Windows done · macOS waiting |
| [#170](https://github.com/YarlisAISolutions/sdods/issues/170) | Windows users install with `winget` | A winget moderator | `sdods-release-channels` | Submitted, validated, in review |
| [#127](https://github.com/YarlisAISolutions/sdods/issues/127) | Users can sponsor SDODS | A restricted live Stripe key | `sdods-sponsor` | Code ready, switch off |

Paths in the "Repo name" rows of older issue bodies say `siri1410/SDODS`; the repository is now
`YarlisAISolutions/sdods` and the old name redirects.

---

## #169 — Signed macOS desktop app

**As a** Mac user downloading SDODS from sdods.com/download,
**I want** the app to open on the first double-click,
**so that** I don't have to run `xattr` in Terminal or trust an app macOS calls "damaged".

**Where it stands (2026-10-01)**

- ✅ Windows: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET` are set, and
  `desktop-v0.1.3` installers are Authenticode-signed by **YARLIS LLC** (Azure Artifact Signing).
- ✅ sdods.com/download offers macOS, Windows and Linux (`NEXT_PUBLIC_DESKTOP_PLATFORMS:
  macos,windows,linux` in `www.yml`, #222 and #231). The macOS card carries the `xattr` workaround.
- ❌ macOS: none of `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` is set, so the `.dmg` is ad-hoc signed only.
- No code change needed: `desktop.yml` signs and notarizes as soon as the five secrets exist.

**Acceptance criteria**

- [ ] The five Apple secrets exist on the repository.
- [ ] A new `desktop-v*` release builds; the macOS job log shows signing and notarization, not
      `skipped macOS signing`.
- [ ] `spctl -a -vv /Applications/SDODS.app` prints `accepted` and `source=Notarized Developer ID`.
- [ ] `bun run desktop:sync-release desktop-v<ver> --signed` records it, and the release notes
      drop the `xattr` instructions.

**Next human step:** enrol in the Apple Developer Program, create a **Developer ID Application**
certificate and an app-specific password, then set the five secrets. `sdods-sign-macos` walks
through each gate; the Windows side is in `sdods-sign-windows` if a credential needs rotating.

---

## #170 — SDODS on winget

**As a** Windows user,
**I want** `winget install SDODS.SDODS`,
**so that** I install and upgrade SDODS the same way as my other tools.

**Where it stands (2026-10-01)**

- ✅ Submitted as [microsoft/winget-pkgs#435418](https://github.com/microsoft/winget-pkgs/pull/435418),
  updated on 2026-09-30 to **0.1.3**, the first signed release, with `Publisher: YARLIS LLC`.
- ✅ Microsoft CLA signed (company, Yarlis AI Solutions). Labels: `Validation-Completed`,
  `Azure-Pipeline-Passed`.
- ⏳ Waiting for a community moderator to approve and merge. Nothing to do on our side.
- The winget option stays hidden on sdods.com/install until the manifest is live
  (`channels:sync` reads it from `microsoft/winget-pkgs`).

**Acceptance criteria**

- [ ] microsoft/winget-pkgs#435418 is merged.
- [ ] `winget install SDODS.SDODS` installs the desktop app.
- [ ] `bun run channels:sync -- --check` shows `✔ winget`, and sdods.com/install lists winget.

**Next human step:** answer moderator feedback on the PR if any arrives. When a newer desktop
release ships before the merge, update the same PR rather than opening another (see
`sdods-release-channels`, *winget*).

---

## #127 — Sponsorships on sdods.com

**As a** developer or company that relies on SDODS,
**I want** to sponsor it once or monthly from sdods.com/sponsor,
**so that** I can fund the project without emailing anyone.

**Where it stands (2026-10-01)**

- ✅ The sponsor page (#124) and the `SPONSOR_ENABLED` switch (#129) are merged, switch off.
- ✅ Stripe account branding: public name **SDODS Developers**, statement descriptor
  **SDODS DEVELOPERS**, support email and privacy URL.
- ✅ Both scripts that lived in the issue body are now in the repo:
  `scripts/sponsor/stripe-sponsor-setup.py` and `scripts/sponsor/sponsor-go-live.py`.
  The go-live script was dry-run on 2026-10-01 against `main` with placeholder URLs, and
  `tests/sponsor.test.ts` and `tests/wiring.test.ts` passed (15/15).
- ❌ `stripe get /v1/payment_links --live` returns an empty list: no products, prices or links yet.

**Acceptance criteria**

- [ ] 2 products, 7 prices, 7 payment links and a customer-portal login exist in live mode.
- [ ] `sponsor-go-live.py` PR merged: 8 URLs filled, switch on in all four copies, README and
      FUNDING.yml uncommented, `funding` in the 8 published `package.json` files.
- [ ] https://sdods.com/sponsor/ lists the tiers with `buy.stripe.com` buttons; nav and footer
      show **Sponsor**.
- [ ] A real $1 payment lands on `/sponsor/thanks/` and reads **SDODS DEVELOPERS** on the card;
      a $5/month subscription is cancelled through the portal; the $1 is refunded.

**Next human step:** create the restricted live key (Products, Prices, Payment Links, Customer
Portal: Write; everything else None), run `stripe-sponsor-setup.py` in your own terminal, expire
the key, then hand `stripe-sponsor.json` to an agent. `sdods-sponsor` has every step.

---

## Closed in this review

- **#167 — Ship the 2026-09-15 upgrades.** See the closing comment on the issue for the Homebrew
  tap verification. `VIRUSTOTAL_API_KEY` stays an optional nice-to-have: without it the desktop scan
  job prints one line and skips.
