# Hosting the SDODS server (api.sdods.com)

```
Route 53 (sdods.com)            GCP project automax-docs (us-central1)
api.sdods.com  CNAME ─────────► Firebase Hosting site `sdods-automax-api`
                                  rewrite ** ─► Cloud Run service `automax-api` (scale to zero)
                                                 ├─ Secret Manager: SESSION_SECRET, DB password, admin password
                                                 └─ Cloud SQL Postgres 16 `automax-pg` (db-f1-micro, zonal)
```

The container is the same image for everything: `deploy/entrypoint.sh serve` migrates and starts the
server (Fastify API + web UI + `/mcp`), `bootstrap` creates the admin, and any other argument is passed
to the `sdods` CLI (`db status`, `run -p demo-shop …`). The image is built on the official Playwright
image so UI runs triggered from the web UI work inside the container.

## One-time setup (already done for automax-docs)

| Step | Command |
| --- | --- |
| Billing + APIs | `gcloud billing projects link automax-docs --billing-account <id>` · `gcloud services enable run artifactregistry cloudbuild secretmanager sqladmin` |
| Artifact Registry | `gcloud artifacts repositories create sdods --repository-format=docker --location=us-central1` |
| Secrets | `automax-session-secret`, `automax-db-password`, `automax-admin-password` (random, Secret Manager) |
| Cloud SQL | `gcloud sql instances create automax-pg --database-version=POSTGRES_16 --edition=ENTERPRISE --tier=db-f1-micro --region=us-central1 --storage-size=10 --storage-type=HDD --availability-type=zonal --no-backup` then `gcloud sql databases create automax --instance automax-pg` and `gcloud sql users create automax --instance automax-pg --password "$(gcloud secrets versions access latest --secret automax-db-password)"` |
| Service accounts | runtime `automax-api-runtime@` (secretAccessor, cloudsql.client); CI `github-deploy-api@` (run.admin, cloudbuild.builds.editor, artifactregistry.writer, iam.serviceAccountUser, storage.admin, serviceUsageConsumer, logging.viewer, plus artifactregistry.repoAdmin on the `sdods` repository so it can move the `latest` tag) — its key is the GitHub secret `GCP_SA_KEY_AUTOMAX` |

## Deploy

```bash
bun run api:build            # Cloud Build → us-central1-docker.pkg.dev/automax-docs/sdods/automax-api:latest
bun run api:deploy           # gcloud run deploy automax-api (secrets, Cloud SQL connector, env)
bun run api:bootstrap        # Cloud Run job: migrate + sync hierarchy + create admin (idempotent)
bun run api:deploy-hosting   # Firebase Hosting site sdods-automax-api → rewrite to Cloud Run
```

`.github/workflows/api.yml` runs the first two on every push to `main` that touches `packages/**`,
`projects/**`, `Dockerfile` or `deploy/**` (skipped when the `GCP_SA_KEY_AUTOMAX` secret is absent).

## Custom domain

1. Create the hosting site once: `firebase hosting:sites:create sdods-automax-api --project automax-docs`.
2. Register the domain: `POST https://firebasehosting.googleapis.com/v1beta1/projects/automax-docs/sites/sdods-automax-api/customDomains?customDomainId=api.sdods.com` with header `x-goog-user-project: automax-docs` (or the Firebase console → Hosting → Add custom domain).
3. Route 53: replace the `api.sdods.com` A record with `CNAME sdods-automax-api.web.app` (zone `Z04704512KW8HY61QOMEK`).
4. Wait for `certState: CERT_ACTIVE`, then `bun run api:deploy-hosting`.

Until then the service answers on its Cloud Run URL (`gcloud run services describe automax-api --region us-central1 --format 'value(status.url)'`).

## Admin credentials and tokens

```bash
gcloud secrets versions access latest --secret automax-admin-password --project automax-docs   # admin password
# then in the web UI: Settings → API tokens (free, scoped) for MCP clients and CI ingest
```

## Operate

Cloud resource names below still carry the pre-rebrand prefix. They identify infrastructure that
is already serving traffic, so renaming them would mean new service URLs, new DNS records and a
fresh set of secrets for no user-visible gain. Treat them as opaque identifiers, not as branding.

| Task | How |
| --- | --- |
| Logs | `gcloud run services logs read automax-api --region us-central1 --limit 100` |
| Migrations | run automatically at container start (`sdods db migrate`); manual: `gcloud run jobs execute automax-bootstrap --region us-central1 --wait` |
| Rotate a secret | `gcloud secrets versions add automax-session-secret --data-file=<(openssl rand -base64 36)` then `bun run api:deploy` (services read `:latest` on new revisions) |
| Rotate the DB password | add a new secret version, then `gcloud sql users set-password automax --instance automax-pg --password "$(gcloud secrets versions access latest --secret automax-db-password)"`, then redeploy |
| Scale | `MIN_INSTANCES=1 bun run api:deploy` for no cold starts (adds ~$8/month) |
| Tear down | `gcloud run services delete automax-api --region us-central1` · `gcloud run jobs delete automax-bootstrap --region us-central1` · `gcloud sql instances delete automax-pg` · delete the three secrets · `firebase hosting:sites:delete sdods-automax-api` · restore the Route 53 A record |

## Cost (us-central1, list prices)

| Item | Monthly |
| --- | --- |
| Cloud SQL `db-f1-micro` (shared core, 10 GB HDD, zonal, no backups) | ≈ $8–10, always on |
| Cloud Run (min 0, 1 vCPU / 2 GiB, cpu-boost) | $0 idle; within free tier for light use; ≈ $0.05 per 1000 requests + CPU seconds beyond it |
| Artifact Registry (image ≈ 3 GB) | ≈ $0.30 |
| Secret Manager (3 secrets, few accesses) | ≈ $0.20 |
| Firebase Hosting rewrite traffic | free tier (10 GB/month egress) |

Notes: run artifacts written by UI-triggered runs live in `/tmp` and disappear with the instance; use
`sdods report ingest --server` from CI for durable results, or mount a bucket later. Postgres is the
only stateful component; `sdods db export` produces a JSONL backup.

## Maxi, the docs assistant

```
docs.sdods.com/llms-full.txt ◄── refreshed hourly (ETag) ─┐
                                                          │
sdods.com / docs.sdods.com  ── POST /chat (SSE) ──►  Cloud Run `sdods-maxi` ──► Claude API (Sonnet 5)
  chat widget (@sdods/site-kit)                          ├─ Secret Manager: maxi-anthropic-key
                                                         └─ Firestore: maxiChats (anonymous logs), maxiUsage (daily spend)
```

Maxi is not trained or fine-tuned. Every request carries the published docs (`llms-full.txt`, built by
`apps/docs`) as a cached system prompt, so answers follow the docs as soon as they deploy: no Maxi
redeploy is needed for a docs change. The service is separate from `automax-api` so chat traffic
never competes with test runs, and its Anthropic key is isolated.

### One-time setupimage.png

| Step | Command |
| --- | --- |
| Anthropic key | Create a key in its own Console workspace with a **monthly spend limit** (the hard stop), then `printf %s "$KEY" \| gcloud secrets create maxi-anthropic-key --data-file=- --project automax-docs` |
| Runtime account | `gcloud iam service-accounts create maxi-runtime --project automax-docs` · grant `roles/datastore.user` on the project and `roles/secretmanager.secretAccessor` on `maxi-anthropic-key` |
| CI account | `github-deploy-api@` already deploys `automax-api`; it also needs `iam.serviceAccountUser` on `maxi-runtime@` |
| Firestore rules | `firebase deploy --only firestore:rules --project automax-docs` (adds the closed `maxiChats` and `maxiUsage` rules) |
| First deploy | push to `main`, or run the `maxi` workflow by hand; then `curl "$(gcloud run services describe sdods-maxi --region us-central1 --format 'value(status.url)')/health"` |
| Turn the widget on | set the repository variable `MAXI_URL` to the service URL, then rebuild www and docs. Unset, the widget renders nothing |

Serving Maxi behind Firebase Hosting (a `maxi.sdods.com` rewrite like `api.sdods.com`) is only safe if
Hosting streams the SSE response instead of buffering it; check on a preview channel first. Otherwise
use the `run.app` URL or a Cloud Run domain mapping. Behind Hosting, deploy with
`MAXI_TRUST_PROXY=2` so per-IP limits count the extra hop.

### Operate

| Task | How |
| --- | --- |
| Logs | `gcloud run services logs read sdods-maxi --region us-central1 --limit 100` (one `chat` line per answer with tokens and estimated cost) |
| Switch model | `MAXI_MODEL=claude-opus-5 bun run maxi:deploy` (stronger scripts, about 2.5x the cost) |
| Daily budget | `MAXI_DAILY_BUDGET_USD=40 bun run maxi:deploy`; past it Maxi says it's resting until tomorrow (UTC) |
| Step catalog | `bun run maxi:steps` after changing demo-shop steps, then commit `packages/maxi/data/steps.json` |
| Quality check | `ANTHROPIC_API_KEY=… bun run maxi:eval` (about $1; `MAXI_CORPUS_FILE=$PWD/apps/docs/out/llms-full.txt` checks a local docs build) |
| Key without a workspace | the API rejects it unless requests name a workspace: deploy with `ANTHROPIC_WORKSPACE_ID=wrkspc_… bun run maxi:deploy` (and set it for `maxi:eval`), or use a key created inside a workspace |
| Rotate the key | add a secret version, then `bun run maxi:deploy` |
| Turn off | unset `MAXI_URL` and rebuild the sites; `gcloud run services delete sdods-maxi --region us-central1` |

### Keeping answers relevant

1. Fix the docs, not the prompt. A wrong or missing answer is almost always a docs gap; once the docs
   deploy, Maxi picks the change up within the hour.
2. Each week, read the 👎 votes and "I'm not sure" answers in Firestore `maxiChats` (the console, or
   any reader signed in as the moderator), fix the docs they point at, and add the question to
   `packages/maxi/evals/golden.yaml`.
3. Run `bun run maxi:eval` after persona, model or large docs changes and compare with the last run.
