#!/usr/bin/env bash
# Deploy (or update) the AutoMax API on Cloud Run.
# Usage: bash deploy/deploy-cloud-run.sh [image-tag]
# Env overrides: GCP_PROJECT, GCP_REGION, SERVICE, CLOUDSQL_INSTANCE, PUBLIC_URL, MIN_INSTANCES, MAX_INSTANCES
set -euo pipefail

PROJECT="${GCP_PROJECT:-automax-docs}"
REGION="${GCP_REGION:-us-central1}"
SERVICE="${SERVICE:-automax-api}"
INSTANCE="${CLOUDSQL_INSTANCE:-automax-pg}"
TAG="${1:-latest}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/automax/automax-api:${TAG}"
PUBLIC_URL="${PUBLIC_URL:-https://api.sdods.com}"
RUNTIME_SA="automax-api-runtime@${PROJECT}.iam.gserviceaccount.com"
CONN="${PROJECT}:${REGION}:${INSTANCE}"

# AUTOMAX_SESSION_COOKIE=__session: Firebase Hosting forwards only that cookie name to Cloud Run.
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
  --set-secrets "SESSION_SECRET=automax-session-secret:latest,DB_PASSWORD=automax-db-password:latest" \
  --set-env-vars "DB_DRIVER=postgres,DB_USER=automax,DB_NAME=automax,CLOUDSQL_CONNECTION=${CONN},HOST=0.0.0.0,AUTOMAX_ROOT=/app,AUTOMAX_PUBLIC_URL=${PUBLIC_URL},AUTOMAX_PROJECTS_DIR=/app/projects,AUTOMAX_ARTIFACTS_DIR=/tmp/automax/runs,AUTOMAX_MAX_CONCURRENT_RUNS=1,AUTOMAX_SESSION_COOKIE=__session" \
  --quiet

URL=$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format 'value(status.url)')
echo "service url: $URL"
curl -fsS "$URL/api/health" | head -c 200 && echo
