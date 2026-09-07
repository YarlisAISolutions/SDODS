#!/usr/bin/env bash
# Build a signed flat apt repository from the .deb files of a published desktop release.
#
#   packaging/apt/build-repo.sh <deb-dir> <out-dir>
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

DEB_DIR="${1:?usage: build-repo.sh <deb-dir> <out-dir>}"
OUT_DIR="${2:?usage: build-repo.sh <deb-dir> <out-dir>}"
SUITE="${SDODS_APT_SUITE:-stable}"
COMPONENT="${SDODS_APT_COMPONENT:-main}"
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
mkdir -p "$OUT_DIR"
cp "$DEB_DIR"/*.deb "$OUT_DIR/"

cd "$OUT_DIR"

# Paths inside Packages must be relative to the repository root, which is why this runs from
# inside OUT_DIR rather than passing an absolute path.
apt-ftparchive packages . > Packages
gzip -9kf Packages

apt-ftparchive \
  -o "APT::FTPArchive::Release::Origin=$ORIGIN" \
  -o "APT::FTPArchive::Release::Label=$ORIGIN" \
  -o "APT::FTPArchive::Release::Suite=$SUITE" \
  -o "APT::FTPArchive::Release::Codename=$SUITE" \
  -o "APT::FTPArchive::Release::Components=$COMPONENT" \
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
  echo "✔ signed apt repo in $OUT_DIR ($debs package(s), suite $SUITE)"
else
  echo "⚠ SDODS_APT_GPG_KEY is not set — wrote an UNSIGNED repo in $OUT_DIR."
  echo "  apt will reject it without [trusted=yes]. Do not deploy this to sdods.com."
fi
