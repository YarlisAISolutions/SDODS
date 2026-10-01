---
name: sdods-sponsor
description: Step-by-step runbook to take SDODS sponsorships live — create the Stripe products, prices, payment links and customer portal, fill them into sdods.com/sponsor, flip SPONSOR_ENABLED everywhere, and verify with a real payment — with every human-in-the-loop gate marked. Use when asked to turn on sponsorships or donations, "buy SDODS a coffee", set up Stripe payment links for the sponsor page, handle stripe-sponsor.json, flip SPONSOR_ENABLED, or why sdods.com/sponsor is not found.
---

# Taking SDODS sponsorships live

This is a runbook. Follow the steps in order. Each step ends with a **check**, and you do not move
on until that check passes. Tracking issue: YarlisAISolutions/sdods#127.

**Current state:** the site code is merged and off. `sdods.com/sponsor/` (#124), the
`SPONSOR_ENABLED` switch (#129) and both scripts in `scripts/sponsor/` are ready. The only missing
piece is the live Stripe objects, and only the account owner can create the key that makes them.
The Stripe account already has the public name **SDODS Developers**, the statement descriptor
**SDODS DEVELOPERS**, support email `admin@sdods.com` and privacy URL `https://sdods.com/privacy/`.

| File | What it does |
|---|---|
| `scripts/sponsor/stripe-sponsor-setup.py` | Creates 2 products, 7 prices, 7 payment links and a customer-portal login page in **live** mode, tagged `metadata[source]=sdods-sponsor`. Idempotent: progress goes to `./stripe-sponsor.json`, re-runs skip what exists. |
| `scripts/sponsor/sponsor-go-live.py` | Reads `stripe-sponsor.json` (public URLs only) and, in one pass: fills the 8 URLs into `apps/www/lib/sponsor.ts`, flips the switch in all 4 copies, unwraps the 3 `<!-- sponsor: -->` blocks in `README.md`, uncomments `.github/FUNDING.yml`, adds `"funding"` to the 8 published `package.json` files. |
| `tests/sponsor.test.ts` | Fails on a half-filled link set, a non-Stripe URL, or copies of the switch that disagree. |

---

## How human-in-the-loop (HITL) gates work

> 🧑 **HUMAN STEP** — *what*
> - **Why a human:** the reason an agent cannot do it
> - **Do:** the exact clicks or commands
> - **Agent confirms with:** a command whose output proves the step is done

**Agent protocol at a gate:**

1. **Stop.** Print the step exactly as written, then wait.
2. **Never ask for the key in chat.** The `rk_live_…` value must not pass through the model, an
   issue, a commit or a file. The person runs the script in their own terminal.
3. **Confirm, don't trust.** Run the *Agent confirms with* check after the person says "done".
4. **Record progress** on #127 as a checklist.

`stripe-sponsor.json` itself is **not** a secret: it holds only public `buy.stripe.com` and
`billing.stripe.com` URLs plus object ids. It is safe to hand to an agent.

---

## Step 0 — Pre-flight (agent)

```bash
grep -n 'SPONSOR_ENABLED: boolean' packages/contracts/src/sponsor.ts   # = false
grep -c "url: ''" apps/www/lib/sponsor.ts                              # 6
grep -c '<!-- sponsor:' README.md                                      # 3
stripe get /v1/payment_links --live -d limit=3                         # "data": [] means not started
```

The `stripe` CLI login key is **read-only** — it can list but not create (`more_permissions_required:
product_write`). That is why Step 2 needs a separate restricted key.

**Check:** if `payment_links` is not empty, someone already ran Step 3. Ask for `stripe-sponsor.json`
and skip to Step 4.

## Step 1 — Optional Stripe tidy-up

> 🧑 **HUMAN STEP 1** — receipts and payment methods (optional, 3 min)
> - **Why a human:** Stripe Dashboard behind 2FA.
> - **Do:** ⚙ Settings ▸ Business ▸ Public details: turn off "Show phone number on receipts",
>   set a business support address. ⚙ Settings ▸ Payments ▸ Payment methods: turn on ACH Direct
>   Debit, and Link / Apple Pay / Google Pay if wanted.
> - **Agent confirms with:** nothing; it is optional.

## Step 2 — Restricted live key

> 🧑 **HUMAN STEP 2** — create the key (3 min)
> - **Why a human:** a live key created behind Dashboard 2FA; secret custody.
> - **Do:** Dashboard (**live mode**) ▸ Developers ▸ API keys ▸ **Create restricted key** ▸
>   "Building your own integration". Name: `SDODS sponsor setup`. Set **Write** in the left
>   *Permissions* column on exactly **Products**, **Prices**, **Payment Links**, **Customer Portal**.
>   Everything else stays **None** — if Stripe asks for an IP allowlist, something under Core or
>   Identity is on; set it back. Copy the `rk_live_…` value once.
> - **Agent confirms with:** nothing yet; Step 3 proves it.

## Step 3 — Create the Stripe objects

> 🧑 **HUMAN STEP 3** — run the setup script (1 min)
> - **Why a human:** it needs the live key from Step 2.
> - **Do:** in your own terminal (`brew install stripe/stripe-cli/stripe` if missing):
>   ```bash
>   mkdir -p ~/sdods-stripe && cp scripts/sponsor/stripe-sponsor-setup.py ~/sdods-stripe/
>   cd ~/sdods-stripe && STRIPE_API_KEY=rk_live_PASTE_HERE python3 stripe-sponsor-setup.py
>   ```
>   If it stops on a permission, add that one row as **Write** and run the same command again.
>   Then **expire the key**: Developers ▸ API keys ▸ `⋯` ▸ Expire key.
> - **Agent confirms with:**
>   ```bash
>   stripe get /v1/payment_links --live -d limit=10 | grep -c '"url": "https://buy.stripe.com/'   # 7
>   jq -r 'keys[]' ~/sdods-stripe/stripe-sponsor.json | grep -c '^link_'                           # 7
>   ```

## Step 4 — Turn sponsorship on (agent)

From a branch off `main`:

```bash
git switch -c feat/sponsor-go-live origin/main
python3 scripts/sponsor/sponsor-go-live.py . ~/sdods-stripe/stripe-sponsor.json
bun run test tests/sponsor.test.ts tests/wiring.test.ts
bun run www:build
```

The script exits with `no change in <file>` if an anchor moved. Fix the anchor in the script in the
same PR rather than hand-editing around it. If a new package becomes published (not `"private":
true`), add it to the `funding` list in the script.

**Check:** tests pass, `www:build` succeeds, and `git diff --stat` touches the 15 files listed in
the table above. Open the PR; on its Firebase preview the tiers show and the nav and footer show
**Sponsor**.

## Step 5 — Verify with real money

> 🧑 **HUMAN STEP 5** — end-to-end checkout (10 min, after the PR is deployed)
> - **Why a human:** a real card payment.
> - **Do:**
>   - Open all 7 links: header says **SDODS Developers**, amounts right, monthly links say
>     "per month", the "Name or company to thank publicly" field is there.
>   - Pay **$1** through the any-amount link, land on `/sponsor/thanks/`; the card shows **SDODS DEVELOPERS**.
>   - Subscribe at **$5/month**, use "Change your card or cancel" on `/sponsor/`, cancel.
>   - Refund the $1 in Dashboard ▸ Transactions.
> - **Agent confirms with:**
>   ```bash
>   curl -fsS https://sdods.com/sponsor/ | grep -c 'buy.stripe.com'   # ≥ 7
>   ```

Then comment `done` with the checks on #127 and close it.

---

## Turning it off again

Set `SPONSOR_ENABLED` back to `false` in all four copies (contracts, `install.sh`, `install.ps1`,
desktop `menu.ts`), re-wrap the README blocks and comment the FUNDING line. `tests/sponsor.test.ts`
tells you which copy you missed. Deactivate the payment links in Stripe if they should stop
accepting money too — a link that is still active keeps working for anyone who saved it.
