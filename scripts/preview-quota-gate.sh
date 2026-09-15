#!/usr/bin/env bash
# Decide whether a failed Firebase preview deploy fails the job. docs.yml and www.yml run this after
# their preview step, which is `continue-on-error`, has failed.
#
#   FIREBASE_SERVICE_ACCOUNT='<json>' SITE=<hosting site> CHANNEL=pr-<n> \
#     bash scripts/preview-quota-gate.sh
#
# A full channel quota ("HTTP Error: 429, Couldn't create channel on .../sites/<site>: channel quota
# reached") says nothing about the change under review: it means other PRs' channels have not been
# deleted yet (previews.yml does that as they close). That one error becomes a warning. Any other
# failure -- a bad firebase.json, a revoked key, a broken artifact -- still fails the job.
#
# The action does not expose its error. It prints it to the log and reports only "The process npx
# failed with exit code 1" in its check run, so the cause is not readable after the fact. It is
# re-asked instead: create the channel directly. Only a new channel counts against the quota, so
#   - "quota"          -> the deploy could not have created it either: warn, pass.
#   - already exists   -> the channel was there, so the quota was not the problem: fail.
#   - created          -> there is room now, so whatever failed was something else: fail. The channel
#                         is left for the re-run to deploy into; previews.yml deletes it on close.
#
# The action's own "Deploy Preview" check run on the PR is still marked failed on a quota error.
# Only the workflow job is made to pass: that check run carries no site or job reference to tell the
# docs one from the www one, and marking the wrong one neutral would hide a real failure.
set -euo pipefail

: "${FIREBASE_SERVICE_ACCOUNT:?service account json}" "${SITE:?hosting site id}" "${CHANNEL:?channel id}"

creds="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/firebase-service-account-gate.json"
( umask 077 && printf '%s' "$FIREBASE_SERVICE_ACCOUNT" > "$creds" )
trap 'rm -f "$creds"' EXIT
export GOOGLE_APPLICATION_CREDENTIALS="$creds"

set +e
out=$(npx -y firebase-tools@latest hosting:channel:create "$CHANNEL" \
  --site "$SITE" --project automax-docs --expires 3d --non-interactive 2>&1)
status=$?
set -e
printf '%s\n' "$out"

if [ "$status" -ne 0 ] && printf '%s' "$out" | grep -qi 'channel quota'; then
  echo "::warning::No preview for $SITE: its channel quota is full, which is not caused by this change. Channels are deleted as PRs close (previews.yml); re-run this job once one has."
  exit 0
fi

if [ "$status" -eq 0 ]; then
  echo "::error::The $SITE preview deploy failed, and the channel quota is not full -- see the preview step's log."
else
  echo "::error::The $SITE preview deploy failed for a reason other than the channel quota -- see the preview step's log."
fi
exit 1
