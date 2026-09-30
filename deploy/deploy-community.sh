#!/usr/bin/env bash
# Deploy (or update) the community Q&A backend on Cloud Run.
# Usage: bash deploy/deploy-community.sh [image-tag]
# Env overrides: GCP_PROJECT, GCP_REGION, SERVICE, COMMUNITY_DAILY_BUDGET_USD, MAX_INSTANCES,
# COMMUNITY_REVIEW_MODEL, COMMUNITY_ESCALATION_MODEL, COMMUNITY_UPVOTE_REP,
# ANTHROPIC_WORKSPACE_ID (only for a key that is not scoped to a workspace; an id, not a secret)
#
# One-time setup is a person's job: see .claude/skills/sdods-community/SKILL.md. The runtime
# service account community-runtime@ needs roles/datastore.user, roles/firebaseauth.admin (to set
# the editor/admin custom claims) and secretAccessor on the community-anthropic-key secret.
#
# --no-invoker-iam-check, not --allow-unauthenticated: the organisation restricts IAM members to its
# own domain, so an allUsers invoker binding is refused and the service stays private (every request
# 403s). Turning off the invoker check makes it public without that binding. The service authenticates
# every write itself (Firebase ID tokens).
# COMMUNITY_UPVOTE_REP=1: anyone signed in can upvote while the community is new. With Stack
# Overflow's 15, nobody can upvote until an answer of theirs is accepted. Raise it once there are
# regulars (COMMUNITY_UPVOTE_REP=15 bash deploy/deploy-community.sh). Downvoting stays at 125.
# COMMUNITY_TRUST_PROXY=1: Cloud Run's front end appends exactly one X-Forwarded-For hop, so the
# client address is the last one and a visitor cannot pick their own rate-limit bucket.
# No comments inside the command below: a comment line ends the backslash continuation, and the
# flags after it silently never reach gcloud (tests/deploy-scripts.test.ts).
set -euo pipefail

PROJECT="${GCP_PROJECT:-automax-docs}"
REGION="${GCP_REGION:-us-central1}"
SERVICE="${SERVICE:-sdods-community}"
TAG="${1:-latest}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/sdods/community:${TAG}"
RUNTIME_SA="community-runtime@${PROJECT}.iam.gserviceaccount.com"

gcloud run deploy "$SERVICE" \
  --project "$PROJECT" --region "$REGION" \
  --image "$IMAGE" \
  --platform managed \
  --service-account "$RUNTIME_SA" \
  --no-invoker-iam-check \
  --port 8080 \
  --cpu 1 --memory 512Mi \
  --min-instances 0 --max-instances "${MAX_INSTANCES:-3}" \
  --concurrency 80 --timeout 120 \
  --cpu-boost \
  --set-secrets "ANTHROPIC_API_KEY=community-anthropic-key:latest" \
  --set-env-vars "COMMUNITY_FIREBASE_PROJECT=${PROJECT},COMMUNITY_FIRESTORE_PROJECT=${PROJECT},COMMUNITY_ALLOWED_ORIGIN_PATTERNS=https://sdods-automax--*.web.app,COMMUNITY_REVIEW_MODEL=${COMMUNITY_REVIEW_MODEL:-claude-haiku-4-5},COMMUNITY_ESCALATION_MODEL=${COMMUNITY_ESCALATION_MODEL:-claude-sonnet-5},COMMUNITY_DAILY_BUDGET_USD=${COMMUNITY_DAILY_BUDGET_USD:-5},COMMUNITY_UPVOTE_REP=${COMMUNITY_UPVOTE_REP:-1},COMMUNITY_TRUST_PROXY=1,ANTHROPIC_WORKSPACE_ID=${ANTHROPIC_WORKSPACE_ID:-}" \
  --quiet

URL=$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format 'value(status.url)')
echo "service url: $URL"
curl -fsS "$URL/health" | head -c 300 && echo
