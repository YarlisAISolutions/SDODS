#!/usr/bin/env bash
# Deploy (or update) the SDODS API on Cloud Run.
# Usage: bash deploy/deploy-cloud-run.sh [image-tag]
# Env overrides: GCP_PROJECT, GCP_REGION, SERVICE, CLOUDSQL_INSTANCE, PUBLIC_URL, MIN_INSTANCES, MAX_INSTANCES
set -euo pipefail

PROJECT="${GCP_PROJECT:-automax-docs}"
REGION="${GCP_REGION:-us-central1}"
SERVICE="${SERVICE:-automax-api}"
INSTANCE="${CLOUDSQL_INSTANCE:-automax-pg}"
TAG="${1:-latest}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/sdods/automax-api:${TAG}"
PUBLIC_URL="${PUBLIC_URL:-https://api.sdods.com}"
RUNTIME_SA="automax-api-runtime@${PROJECT}.iam.gserviceaccount.com"
CONN="${PROJECT}:${REGION}:${INSTANCE}"

# SDODS_SESSION_COOKIE=__session: Firebase Hosting forwards only that cookie name to Cloud Run.
# DB_USER and DB_NAME name the Cloud SQL role and database that already exist. They keep the
# pre-rebrand prefix on purpose; renaming them would mean migrating live data.
gcloud run deploy "$SERVICE" \
  --project "$PROJECT" --region "$REGION" \
  --image "$IMAGE" \
  --platform managed \
  --service-account "$RUNTIME_SA" \
  --allow-unauthenticated \
  --port 8080 \
  --cpu 1 --memory 2Gi \
  --min-instances "${MIN_INSTANCES:-0}" --max-instances "${MAX_INSTANCES:-2}" \
  --concurrency 40 --timeout 900 \
  --cpu-boost \
  --add-cloudsql-instances "$CONN" \
  # SDODS_TRUST_PROXY: Cloud Run always sits behind Google's front end, which sets X-Forwarded-For
  # and -Proto; trusting it keeps req.protocol (Secure cookies) and per-IP limits meaningful. A hop
  # count matching the real chain (Firebase Hosting adds one) is stricter; sign-ins are also
  # throttled per username, so a forged header no longer buys unlimited guesses either way.
  --set-secrets "SESSION_SECRET=automax-session-secret:latest,DB_PASSWORD=automax-db-password:latest" \
  --set-env-vars "DB_DRIVER=postgres,DB_USER=automax,DB_NAME=automax,CLOUDSQL_CONNECTION=${CONN},HOST=0.0.0.0,SDODS_ROOT=/app,SDODS_PUBLIC_URL=${PUBLIC_URL},SDODS_PROJECTS_DIR=/app/projects,SDODS_ARTIFACTS_DIR=/tmp/sdods/runs,SDODS_MAX_CONCURRENT_RUNS=1,SDODS_SESSION_COOKIE=__session,SDODS_TRUST_PROXY=${SDODS_TRUST_PROXY:-true}" \
  --quiet

URL=$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format 'value(status.url)')
echo "service url: $URL"
curl -fsS "$URL/api/health" | head -c 200 && echo
