#!/usr/bin/env bash
# One-time bootstrap: run migrations, sync the hierarchy and create the platform admin
# as a Cloud Run job that shares the API image, secrets and Cloud SQL connection.
# Usage: bash deploy/bootstrap-admin.sh [image-tag]
set -euo pipefail

PROJECT="${GCP_PROJECT:-automax-docs}"
REGION="${GCP_REGION:-us-central1}"
INSTANCE="${CLOUDSQL_INSTANCE:-automax-pg}"
TAG="${1:-latest}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/sdods/automax-api:${TAG}"
RUNTIME_SA="automax-api-runtime@${PROJECT}.iam.gserviceaccount.com"
CONN="${PROJECT}:${REGION}:${INSTANCE}"
JOB="automax-bootstrap"

if gcloud run jobs describe "$JOB" --project "$PROJECT" --region "$REGION" >/dev/null 2>&1; then
  ACTION=update
else
  ACTION=create
fi

gcloud run jobs "$ACTION" "$JOB" \
  --project "$PROJECT" --region "$REGION" \
  --image "$IMAGE" \
  --service-account "$RUNTIME_SA" \
  --set-cloudsql-instances "$CONN" \
  --set-secrets "SESSION_SECRET=automax-session-secret:latest,DB_PASSWORD=automax-db-password:latest,ADMIN_PASSWORD=automax-admin-password:latest" \
  --set-env-vars "DB_DRIVER=postgres,DB_USER=automax,DB_NAME=automax,CLOUDSQL_CONNECTION=${CONN},SDODS_ROOT=/app,ADMIN_USERNAME=${ADMIN_USERNAME:-admin}" \
  --args bootstrap \
  --max-retries 0 --task-timeout 600 \
  --quiet

gcloud run jobs execute "$JOB" --project "$PROJECT" --region "$REGION" --wait --quiet
echo "admin username: ${ADMIN_USERNAME:-admin}"
echo "admin password: gcloud secrets versions access latest --secret automax-admin-password --project ${PROJECT}"
