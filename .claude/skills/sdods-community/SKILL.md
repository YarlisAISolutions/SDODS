---
name: sdods-community
description: Set up, deploy and run the SDODS community Q&A backend (packages/community, Cloud Run service sdods-community) — signed-in posting, the AI review agent that only accepts SDODS questions and answers, the editor queue and editor/admin roles — with every human-in-the-loop step marked. Use when asked to set up or deploy the community service, enable GitHub/Google sign-in on sdods.com, make someone an editor, tune the auto-review, investigate why a post was rejected or queued, or change the community's Firestore rules.
---

# The SDODS community Q&A backend

`packages/community` is a small Fastify service on Cloud Run (`sdods-community`), built like Maxi.
Every question and answer on sdods.com/questions goes through it:

```
browser (signed in with GitHub/Google) ──ID token──► sdods-community
   1. verify the Firebase ID token (jose, Google's published keys)
   2. per-account + per-IP rate limits
   3. mask pasted credentials (src/redact.ts) — before storing, before the model sees anything
   4. review: claude-haiku-4-5 → claude-sonnet-5 only if unsure (src/review.ts)
   5. decide(): publish | reject (with a reason for the author) | queue for an editor
   6. write the post to Firestore (REST, service account) + the verdict to communityReviews
```

**Only SDODS posts get in.** The reviewer reports signals (`relevance: sdods | adjacent | off_topic`,
confidence, spam, abuse, quality notes). `decide()` is plain code:

| Signal | Outcome |
|---|---|
| spam or abuse, confidence ≥ 0.85 | rejected |
| off_topic, confidence ≥ 0.85 | rejected, author told why |
| sdods, answers the question, confidence ≥ 0.8 | published |
| anything else | second opinion from Sonnet; still unsure → editor queue |
| API error, refusal, truncation, budget spent | editor queue. **Never** auto-publish or auto-reject on failure |

A Playwright/Gherkin/CI question is on-topic only when it is about doing that *through* SDODS; the
system prompt in `src/review.ts` states the line. Change thresholds in `DEFAULT_THRESHOLDS`, not in
the prompt.

**Roles** are Firebase custom claims (`role: editor | admin`), set by `POST /admin/role`. The
addresses `admin@sdods.com` / `admin@yarlis.com` (verified) are admins with no claim, matching
`firestore.rules`. Editors see and resolve the queue; admins also assign roles.

---

## How human-in-the-loop gates work

Steps that need a Google Cloud / Firebase console, a payment method, an OAuth app, or custody of a
secret are marked:

> 🧑 **HUMAN STEP** — *what*
> - **Why a human:** why an agent cannot do it
> - **Do:** exact clicks or commands
> - **Agent confirms with:** a command whose output proves it is done

**Agent protocol:** stop and print the step; never ask for a secret in chat (the person runs the
command themselves, e.g. with `! <command>` in Claude Code; `gcloud secrets create … --data-file=-`
reads from stdin); run the confirm command when they say done, and stay at the gate if it fails;
record progress in the tracking issue.

---

## One-time setup

### 1. Anthropic key and spend limit

> 🧑 **HUMAN STEP 1** — create a dedicated API key and store it in Secret Manager
> - **Why a human:** billing, and custody of the key.
> - **Do:** in the Anthropic Console create a workspace (e.g. `sdods-community`) with a monthly spend
>   limit (the hard stop; `COMMUNITY_DAILY_BUDGET_USD` is only the service's own estimate), create a
>   key inside it, then:
>   ```bash
>   gcloud secrets create community-anthropic-key --project automax-docs --replication-policy automatic
>   printf %s "$KEY" | gcloud secrets versions add community-anthropic-key --project automax-docs --data-file=-
>   ```
> - **Agent confirms with:** `gcloud secrets versions list community-anthropic-key --project automax-docs`
>   shows one `enabled` version.

### 2. Runtime service account

> 🧑 **HUMAN STEP 2** — create `community-runtime@` with the least it needs
> - **Why a human:** IAM grants on the production project.
> - **Do:**
>   ```bash
>   P=automax-docs; SA=community-runtime@$P.iam.gserviceaccount.com
>   gcloud iam service-accounts create community-runtime --project $P --display-name "SDODS community"
>   gcloud projects add-iam-policy-binding $P --member serviceAccount:$SA --role roles/datastore.user
>   gcloud projects add-iam-policy-binding $P --member serviceAccount:$SA --role roles/firebaseauth.admin
>   gcloud secrets add-iam-policy-binding community-anthropic-key --project $P \
>     --member serviceAccount:$SA --role roles/secretmanager.secretAccessor
>   # the CI deployer is github-deploy-api@ (the account behind GCP_SA_KEY_AUTOMAX; api.yml says so).
>   D=github-deploy-api@$P.iam.gserviceaccount.com
>   gcloud iam service-accounts add-iam-policy-binding $SA --project $P \
>     --member serviceAccount:$D --role roles/iam.serviceAccountUser
>   # …and must be able to *see* the secret, or the workflow's setup check skips the deploy:
>   gcloud secrets add-iam-policy-binding community-anthropic-key --project $P \
>     --member serviceAccount:$D --role roles/secretmanager.viewer
>   ```
>   `roles/firebaseauth.admin` is what lets `POST /admin/role` set custom claims. The last grant
>   mirrors Maxi's; without it the run is green but prints "not set up … skipping".
>
> **Leave `COMMUNITY_ANTHROPIC_WORKSPACE_ID` unset** for a key created inside a workspace. Sending
> another workspace's id (e.g. Maxi's `ANTHROPIC_WORKSPACE_ID`) makes every Claude call 404, and
> every post then waits for an editor. Check a key without printing it:
> `K=$(gcloud secrets versions access latest --secret community-anthropic-key --project automax-docs); curl -s -o /dev/null -w "%{http_code}\n" -H "x-api-key: $K" -H "anthropic-version: 2023-06-01" https://api.anthropic.com/v1/models; unset K`

**Public access.** The organisation only allows IAM members from its own domain, so Cloud Run's
`allUsers` invoker binding is refused and a new service answers every request with 403.
`deploy-community.sh` therefore deploys with `--no-invoker-iam-check`. On an existing service:
`gcloud run services update sdods-community --region us-central1 --project automax-docs --no-invoker-iam-check`.
Confirm with `curl https://sdods-community-7rxessch3q-uc.a.run.app/health` → `{"ok":true,…}`.
> - **Agent confirms with:** `gcloud projects get-iam-policy automax-docs --flatten bindings --filter "bindings.members:community-runtime@" --format "value(bindings.role)"`
>   lists `roles/datastore.user` and `roles/firebaseauth.admin`.

After steps 1 and 2 exist, the next push that touches `packages/community/**` deploys the service
(`.github/workflows/community.yml`). Until then that workflow only checks the image builds and
prints a notice.

### 3. Sign-in providers

> 🧑 **HUMAN STEP 3** — enable Google and GitHub sign-in on the Firebase project
> - **Why a human:** Firebase console, and a GitHub OAuth app owned by the organisation.
> - **Do:**
>   1. Firebase console → `automax-docs` → Authentication → Sign-in method → enable **Google**.
>   2. github.com → YarlisAISolutions → Settings → Developer settings → OAuth Apps → New:
>      homepage `https://sdods.com`, callback **`https://automax-docs.firebaseapp.com/__/auth/handler`**.
>      Copy the client ID and generate a client secret.
>   3. Firebase → Sign-in method → **GitHub** → paste both.
>   4. Authentication → Settings → Authorized domains: add `sdods.com`, `www.sdods.com` and
>      `sdods-automax--*.web.app` preview hosts as needed (each preview host is added individually).
> - **Agent confirms with:** the person signs in on a preview of the site change with each provider
>   and `GET /me` with the resulting token returns their uid.

### 4. Firestore rules

> 🧑 **HUMAN STEP 4** — deploy `firestore.rules`
> - **Why a human:** rules are deployed by hand today (no workflow has the rights), and a wrong rule
>   exposes or locks the database.
> - **Do:** `firebase deploy --only firestore:rules,firestore:indexes --project automax-docs`
> - **Agent confirms with:** Firebase console → Firestore → Rules shows the `users/{uid}` and
>   `communityReviews` blocks.

**Order matters.** The site still writes posts straight to Firestore until the site change that
posts through this service ships. Deploy the rules in this PR first (they only *add* editor reads
and the new collections), ship the site change, and only then tighten the rules to deny browser
writes. Denying first breaks posting between the two deploys.

### 5. First editors

> 🧑 **HUMAN STEP 5** — choose editors
> - **Why a human:** who moderates the community is an owner's decision.
> - **Do:** sign in on sdods.com as an admin address and use the role control on the moderation page
>   (site change), or call the API with an admin's ID token:
>   `curl -X POST $URL/admin/role -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"uid":"…","role":"editor"}'`
> - **Agent confirms with:** that user's `users/{uid}` document shows `role: editor`. The claim
>   reaches their token within the hour (or at next sign-in).

---

## Running it

| Task | How |
|---|---|
| Why was a post rejected or queued? | `communityReviews` in Firestore: every call's model, signals, decision and cost, keyed by post path |
| Change strictness | `DEFAULT_THRESHOLDS` in `src/review.ts` (tests in `test/review.test.ts`) |
| Change what counts as on-topic | `SYSTEM_PROMPT` in `src/review.ts`; keep it frozen per deploy (it is the cache prefix) |
| Budget | `COMMUNITY_DAILY_BUDGET_USD=10 bash deploy/deploy-community.sh <tag>`; past it posts queue for editors |
| Hold new accounts for review | `COMMUNITY_NEW_ACCOUNT_QUEUE_HOURS=24` |
| Local run | `ANTHROPIC_API_KEY=… bun run --cwd packages/community dev` (in-memory store without `COMMUNITY_FIRESTORE_PROJECT`) |
| Tests | `bunx vitest run packages/community` — decide(), failure paths, redaction, token checks, every route |

**Cost:** a clear post is one Haiku call (≈1k input, ≈100 output tokens, well under a cent); only
unsure posts pay for Sonnet. The $5/day default covers thousands of posts.

---

## Votes, accepted answers and reputation (phase 2)

All of it is written by the service only, inside one Firestore transaction per action: the vote
(`votes/{uid}__{post}`), the post's `score`, every affected `users/{uid}.rep`, and a
`repEvents` history row. The rules are in one pure module, `src/reputation.ts`:

| Event | Reputation |
|---|---|
| Your question or answer is upvoted | +10 |
| Your question or answer is downvoted | −2 (and −1 to whoever downvoted an *answer*) |
| Your answer is accepted | +15 (nothing for accepting your own) |
| You accept someone's answer | +2 |
| Vote changed or withdrawn, answer un-accepted | fully reversed |
| Floor | never below 1 |

| Privilege | Default | Setting |
|---|---|---|
| Vote up | 15 rep | `COMMUNITY_UPVOTE_REP` |
| Vote down | 125 rep | `COMMUNITY_DOWNVOTE_REP` |
| Votes per day | 40 | `COMMUNITY_VOTES_PER_DAY` |

Editors and admins are exempt from the reputation thresholds. Replies are not scored. The
illustrative archive threads are never votable; answers people post on them are.

**Bootstrapping a new community:** with Stack Overflow's thresholds, the first members cannot upvote
until an answer of theirs is accepted (+15). If that stalls early activity, lower
`COMMUNITY_UPVOTE_REP` (e.g. to 1) at deploy time and raise it later; nothing is migrated.

Routes: `POST /votes {path, value: 1|-1|0}`, `GET /votes/mine?paths=…`,
`POST /accept {questionId, answerId|null}` (asker only).

## Roadmap (phase 3)

- **Phase 3:** badges (bronze/silver/gold), edits with revision history and suggested edits, close
  as duplicate/off-topic, flags, comments.
- The illustrative archive threads stay separate and labelled; real reputation is never mixed with
  them.
