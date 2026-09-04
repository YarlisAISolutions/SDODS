#!/usr/bin/env bash
# Publish the @sdods/* packages to npm, in dependency order.
#
#   bash scripts/publish-npm.sh <otp>     # one-time password from your authenticator
#   NPM_TOKEN=<automation token> bash scripts/publish-npm.sh
#
# Each package is packed with bun first, because the workspace uses the `workspace:*`
# protocol that npm does not understand; bun rewrites it to the real version in the tarball.
# Versions already on the registry are skipped, so re-running is safe.
set -euo pipefail
cd "$(dirname "$0")/.."

OTP="${1:-}"
PKGS=(contracts core db mcp integrations agents server cli)
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT

npm_args=(--access public)
[ -n "$OTP" ] && npm_args+=(--otp "$OTP")

echo "Building dist output"
bun run typecheck >/dev/null

published=0 skipped=0
for p in "${PKGS[@]}"; do
  name=$(node -e "process.stdout.write(require('./packages/$p/package.json').name)")
  version=$(node -e "process.stdout.write(require('./packages/$p/package.json').version)")
  if npm view "$name@$version" version >/dev/null 2>&1; then
    printf '  = %-26s %s already published\n' "$name" "$version"
    skipped=$((skipped + 1))
    continue
  fi
  ( cd "packages/$p" && bun pm pack --destination "$OUT" >/dev/null )
  tgz=$(ls "$OUT"/*.tgz | head -1)
  printf '  + %-26s %s\n' "$name" "$version"
  npm publish "$tgz" "${npm_args[@]}" >/dev/null
  rm -f "$tgz"
  published=$((published + 1))
done

echo
echo "published $published, skipped $skipped"
echo "install: npm i -g @sdods/cli   →   sdods --help"
