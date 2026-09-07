#!/usr/bin/env bash
# Build a signed flat apt repository from the .deb files of a published desktop release.
#
#   packaging/apt/build-repo.sh <deb-dir> <out-dir> [pool-path]
#
# The .deb files are 120-130 MB each, which is over GitHub's 100 MB per-file limit, so they cannot
# be committed anywhere -- not to a Pages branch and not to this repository. They stay on the
# public release, which is where they already are, and the repository serves metadata only:
# `Packages` records each file under <pool-path>/, and the host redirects that path to the release
# asset. apt follows the redirect and then verifies the download against the SHA-256 in `Packages`,
# so nothing is trusted less for having been fetched from somewhere else.
#
# SDODS_APT_METADATA_ONLY=1 deletes the .deb files after the metadata is built, which is what makes
# the output small enough to commit. The paths inside `Packages` are unaffected.
#
# A flat repository, not a pool: there is one package with two architectures, and the pool layout
# exists to make thousands of packages navigable. Flat keeps the whole repo four files plus the
# debs, which a static host serves without any configuration.
#
# Signing is optional here and mandatory in practice. Without SDODS_APT_GPG_KEY this writes an
# unsigned repo, which apt refuses to use unless the source line says [trusted=yes] — fine for a
# local check, never for sdods.com. The key belongs to the project, not to this script: export the
# armoured private key into SDODS_APT_GPG_KEY in CI and it signs; leave it unset and it says so.
set -euo pipefail

DEB_DIR="${1:?usage: build-repo.sh <deb-dir> <out-dir> [pool-path]}"
OUT_DIR="${2:?usage: build-repo.sh <deb-dir> <out-dir> [pool-path]}"
POOL="${3:-pool}"
ORIGIN="SDODS"

command -v apt-ftparchive >/dev/null || {
  echo "✖ apt-ftparchive is missing — install apt-utils (this only runs on Debian/Ubuntu)." >&2
  exit 1
}

debs=$(find "$DEB_DIR" -maxdepth 1 -name '*.deb' | wc -l | tr -d ' ')
if [ "$debs" = "0" ]; then
  echo "✖ no .deb files in $DEB_DIR — nothing to publish." >&2
  exit 1
fi

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR/$POOL"
cp "$DEB_DIR"/*.deb "$OUT_DIR/$POOL/"

cd "$OUT_DIR"

# Paths inside Packages must be relative to the repository root, which is why this runs from
# inside OUT_DIR rather than passing an absolute path -- each entry comes out as
# `Filename: <pool-path>/<file>.deb`, which is what the host redirects.
apt-ftparchive packages . > Packages
gzip -9kf Packages

# No Suite, Codename or Components: this is a flat repository, reached by a sources line ending
# in `./` rather than `<suite> <component>`. A flat repo has no components, and declaring a suite
# it is not being addressed by makes apt warn "Conflicting distribution" on every update.
apt-ftparchive \
  -o "APT::FTPArchive::Release::Origin=$ORIGIN" \
  -o "APT::FTPArchive::Release::Label=$ORIGIN" \
  -o "APT::FTPArchive::Release::Architectures=amd64 arm64" \
  release . > Release

if [ -n "${SDODS_APT_GPG_KEY:-}" ]; then
  export GNUPGHOME
  GNUPGHOME=$(mktemp -d)
  chmod 700 "$GNUPGHOME"
  printf '%s' "$SDODS_APT_GPG_KEY" | gpg --batch --import
  key=$(gpg --list-secret-keys --with-colons | awk -F: '/^sec:/ {print $5; exit}')
  # InRelease (inline signature) is what modern apt reads; Release.gpg is kept for older clients,
  # and costs one extra call.
  gpg --batch --yes --default-key "$key" --clearsign -o InRelease Release
  gpg --batch --yes --default-key "$key" -abs -o Release.gpg Release
  # The public key visitors add to /usr/share/keyrings. Dearmoured: apt reads binary keyrings, and
  # an armoured file in that directory fails with a signature error that names the wrong cause.
  gpg --export "$key" > sdods-archive-keyring.gpg
  rm -rf "$GNUPGHOME"
  echo "✔ signed apt repo in $OUT_DIR ($debs package(s), flat layout)"
else
  echo "⚠ SDODS_APT_GPG_KEY is not set — wrote an UNSIGNED repo in $OUT_DIR."
  echo "  apt will reject it without [trusted=yes]. Do not deploy this to sdods.com."
fi

# Done last: the metadata above records each file's size and SHA-256, so removing the payload now
# changes nothing apt reads. It is what keeps the published repository a few kilobytes.
if [ -n "${SDODS_APT_METADATA_ONLY:-}" ]; then
  find "$POOL" -name '*.deb' -delete
  echo "  metadata only — .deb files removed, $POOL/ paths kept for the host to redirect"
fi
