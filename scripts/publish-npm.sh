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

# A CLEAN build, not `tsc -b`. `tsc -b` is incremental: it trusts .tsbuildinfo and emits nothing
# when it believes dist/ is current, so a dist/ left over from an older source tree (a restored
# build cache, an interrupted build, a stale worktree) is staged and published verbatim. That is
# not hypothetical -- @sdods/core@0.2.2 shipped `apiContext.auth = undefined` in
# dist/steps/api.steps.js while every commit in that release had `auth = null` in src, which
# silently un-fixed A1 for every consumer. And because the loop below skips any version already
# on the registry, a stale tarball can never be corrected at that version: only a NEW version
# can. So the build is forced, and verified below, before anything is staged.
echo "Building dist output (clean)"
rm -rf packages/*/dist packages/*/*.tsbuildinfo tsconfig.tsbuildinfo 2>/dev/null || true
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

# Prove the staged output derives from the source in this checkout. Compares the newest mtime
# under each package's src/ against its staged dist/: a dist older than the source it claims to
# compile is the exact failure that shipped 0.2.2, and it must stop the publish rather than
# reach the registry where it becomes permanent.
echo "Verifying staged output is newer than source"
for p in "${PKGS[@]}"; do
  src="packages/$p/src"
  dist="$STAGE/$p/dist"
  [ -d "$src" ] || continue
  [ -d "$dist" ] || { echo "  ! $p staged without a dist/" >&2; exit 5; }
  newest_src=$(find "$src" -type f -newer "$dist" -print -quit 2>/dev/null || true)
  if [ -n "$newest_src" ]; then
    echo "  ! $p: $newest_src is newer than the staged dist/ -- the build did not run" >&2
    exit 5
  fi
done

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
  # Print only after the publish lands: announcing it first made a failed publish read as a
  # success line immediately followed by an unrelated-looking error.
  ( cd "$dir" && npm publish "${npm_args[@]}" >/dev/null ) || {
    printf '  ! %-26s %s failed to publish\n' "$name" "$version" >&2
    exit 1
  }
  printf '  + %-26s %s\n' "$name" "$version"
  # changesets/action decides its `published` output by scanning this stdout for "New tag:" lines.
  # It is the only signal it accepts, and without it a successful publish reads as "nothing was
  # published" -- which is why the GHCR image job never ran.
  printf 'New tag: %s@%s\n' "$name" "$version"
  published=$((published + 1))
done

echo
echo "published $published, skipped $skipped"
echo "install: npm i -g @sdods/cli   →   sdods --help"
