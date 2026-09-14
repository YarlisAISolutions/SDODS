#!/usr/bin/env bash
# Deploy (or update) Maxi, the docs assistant, on Cloud Run.
# Usage: bash deploy/deploy-maxi.sh [image-tag]
# Env overrides: GCP_PROJECT, GCP_REGION, SERVICE, MAXI_MODEL, MAXI_DAILY_BUDGET_USD, MAX_INSTANCES,
# ANTHROPIC_WORKSPACE_ID (only for a key that is not scoped to a workspace; an id, not a secret)
#
# One-time setup (see deploy/README.md, "Maxi"): the runtime service account maxi-runtime@ with
# roles/datastore.user and secretAccessor on the maxi-anthropic-key secret.
#
# MAXI_TRUST_PROXY=1: Cloud Run's front end appends exactly one X-Forwarded-For hop, so the client
# address is the last one and a visitor cannot pick their own rate-limit bucket by sending the header.
# --timeout 300: a long answer with a few tool rounds streams for well under a minute; five minutes
# leaves room without holding dead connections open.
# No comments inside the command below: a comment line ends the backslash continuation, and the
# flags after it silently never reach gcloud (tests/deploy-scripts.test.ts).
set -euo pipefail

PROJECT="${GCP_PROJECT:-automax-docs}"
REGION="${GCP_REGION:-us-central1}"
SERVICE="${SERVICE:-sdods-maxi}"
TAG="${1:-latest}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/sdods/maxi:${TAG}"
RUNTIME_SA="maxi-runtime@${PROJECT}.iam.gserviceaccount.com"

gcloud run deploy "$SERVICE" \
  --project "$PROJECT" --region "$REGION" \
  --image "$IMAGE" \
  --platform managed \
  --service-account "$RUNTIME_SA" \
  --allow-unauthenticated \
  --port 8080 \
  --cpu 1 --memory 512Mi \
  --min-instances 0 --max-instances "${MAX_INSTANCES:-3}" \
  --concurrency 80 --timeout 300 \
  --cpu-boost \
  --set-secrets "ANTHROPIC_API_KEY=maxi-anthropic-key:latest" \
  --set-env-vars "MAXI_MODEL=${MAXI_MODEL:-claude-sonnet-5},MAXI_DAILY_BUDGET_USD=${MAXI_DAILY_BUDGET_USD:-3},MAXI_FIRESTORE_PROJECT=${PROJECT},MAXI_CORPUS_URL=https://docs.sdods.com/llms-full.txt,MAXI_TRUST_PROXY=1,ANTHROPIC_WORKSPACE_ID=${ANTHROPIC_WORKSPACE_ID:-}" \
  --quiet

URL=$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format 'value(status.url)')
echo "service url: $URL"
curl -fsS "$URL/health" | head -c 300 && echo
