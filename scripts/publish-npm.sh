#!/usr/bin/env bash
# Publish the @sdods/* packages to npm, in dependency order.
#
#   bash scripts/publish-npm.sh <otp>     # one-time password from your authenticator
#   NPM_TOKEN=<automation token> bash scripts/publish-npm.sh
#   SDODS_NPM_TOKEN_SECRET=automax-npm-token bash scripts/publish-npm.sh   # from Secret Manager
#
# An npm *automation* token bypasses 2FA; a classic publish token does not and will fail with
# EOTP, in which case pass an OTP instead. The token is written to a private temp .npmrc that is
# removed on exit -- never to the working tree, and never echoed.
#
# Each package is published from a staged copy under .publish-stage (see
# scripts/stage-npm-packages.ts): the staging step applies the `publishConfig` field overrides that
# point `exports` at dist/ and pins `workspace:*` to real versions — npm does neither on its own.
# Versions already on the registry are skipped, so re-running is safe.
set -euo pipefail
cd "$(dirname "$0")/.."

OTP="${1:-}"
PKGS=(contracts core db mcp integrations agents server cli)
STAGE=.publish-stage
REGISTRY="${NPM_REGISTRY:-https://registry.npmjs.org}"

npm_args=(--access public)
[ -n "$OTP" ] && npm_args+=(--otp "$OTP")

# Pull the token from Google Secret Manager when asked, so it never lives in a shell history or
# a file in the repo. Requires gcloud auth; the secret holds the raw token and nothing else.
if [ -z "${NPM_TOKEN:-}" ] && [ -n "${SDODS_NPM_TOKEN_SECRET:-}" ]; then
  echo "Reading ${SDODS_NPM_TOKEN_SECRET} from Secret Manager"
  NPM_TOKEN=$(gcloud secrets versions access latest \
    --secret "$SDODS_NPM_TOKEN_SECRET" \
    --project "${SDODS_GCP_PROJECT:-automax-docs}" 2>/dev/null) ||
    { echo "could not read secret ${SDODS_NPM_TOKEN_SECRET}" >&2; exit 4; }
  [ -n "$NPM_TOKEN" ] || { echo "secret ${SDODS_NPM_TOKEN_SECRET} is empty" >&2; exit 4; }
fi

# A token authenticates through a throwaway userconfig; 0600 and removed on exit.
if [ -n "${NPM_TOKEN:-}" ]; then
  NPMRC=$(mktemp)
  chmod 600 "$NPMRC"
  trap 'rm -f "$NPMRC"' EXIT INT TERM
  host=${REGISTRY#https:}; host=${host#http:}
  printf '%s/:_authToken=%s\nregistry=%s/\n' "${host%/}" "$NPM_TOKEN" "${REGISTRY%/}" > "$NPMRC"
  export npm_config_userconfig="$NPMRC"
fi

echo "Building dist output"
bun run typecheck >/dev/null

# A published install has no checkout to read from: stage init's workspace assets into
# packages/cli/templates and the built dashboard into packages/server/web. See the script header
# of scripts/build-publish-assets.ts.
echo "Building the dashboard"
bun run web:build >/dev/null
echo "Staging publish assets"
bun run publish:assets >/dev/null

echo "Staging package manifests"
bun run publish:stage "$STAGE" >/dev/null

published=0 skipped=0
for p in "${PKGS[@]}"; do
  dir="$STAGE/$p"
  [ -d "$dir" ] || { echo "  ! $p was not staged" >&2; exit 1; }
  name=$(node -e "process.stdout.write(require('./$dir/package.json').name)")
  version=$(node -e "process.stdout.write(require('./$dir/package.json').version)")
  if npm view "$name@$version" version >/dev/null 2>&1; then
    printf '  = %-26s %s already published\n' "$name" "$version"
    skipped=$((skipped + 1))
    continue
  fi
  printf '  + %-26s %s\n' "$name" "$version"
  ( cd "$dir" && npm publish "${npm_args[@]}" >/dev/null )
  published=$((published + 1))
done

echo
echo "published $published, skipped $skipped"
echo "install: npm i -g @sdods/cli   →   sdods --help"
