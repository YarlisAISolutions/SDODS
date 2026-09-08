#!/usr/bin/env bash
# Build a signed apt repository from the .deb files of a published desktop release.
#
#   packaging/apt/build-repo.sh <deb-dir> <out-dir> [pool-path]
#
# A standard dists/ repository, not a flat one. Flat is smaller and was the obvious choice for a
# single package, but it is addressed with a "./" distribution, and every path apt then builds
# contains a "./" segment:
#
#   https://sdods.com/apt/./InRelease
#
# Firebase Hosting answers that with a 302 to an internal origin host that 404s, so apt reports
# "does not have a Release file" while curl on the normalised path returns 200. A dists/ layout
# has no "./" anywhere -- every request is a plain static path -- and it also carries the Suite and
# Components that stop apt warning about a conflicting distribution.
#
# The .deb files are 120-130 MB each, over GitHub's 100 MB per-file limit, so they cannot be
# committed anywhere. They stay on the public release; Packages records them under <pool-path>/ and
# the host redirects that prefix to the release asset. apt verifies every download against the
# SHA-256 recorded here, so a package fetched through the redirect is checked exactly as one served
# directly would be.
#
# SDODS_APT_METADATA_ONLY=1 deletes the .deb files after the metadata is built, which is what makes
# the output small enough to commit. The paths inside Packages are unaffected.
set -euo pipefail

DEB_DIR="${1:?usage: build-repo.sh <deb-dir> <out-dir> [pool-path]}"
OUT_DIR="${2:?usage: build-repo.sh <deb-dir> <out-dir> [pool-path]}"
POOL="${3:-pool}"
SUITE="${SDODS_APT_SUITE:-stable}"
COMPONENT="${SDODS_APT_COMPONENT:-main}"
ARCHES="${SDODS_APT_ARCHES:-amd64 arm64}"
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

# Scanning the pool directory by name, rather than ".", is what keeps `Filename:` free of a leading
# "./" -- the same segment that breaks the flat layout, one level down.
#
# Scanned once and split by architecture rather than with `apt-ftparchive --arch`, which matches
# nothing here and silently writes an empty index: apt then reports the suite as having no packages,
# with no error to explain why.
all_packages=$(mktemp)
apt-ftparchive packages "$POOL" > "$all_packages"
for arch in $ARCHES; do
  dir="dists/$SUITE/$COMPONENT/binary-$arch"
  mkdir -p "$dir"
  awk -v a="$arch" 'BEGIN { RS = ""; ORS = "\n\n" } $0 ~ ("(^|\n)Architecture: " a "(\n|$)") { print }' \
    "$all_packages" > "$dir/Packages"
  gzip -9kf "$dir/Packages"
  # An architecture in the Release file with an empty index is a repository apt reports as broken.
  [ -s "$dir/Packages" ] || echo "⚠ no packages for $arch" >&2
done
rm -f "$all_packages"

apt-ftparchive \
  -o "APT::FTPArchive::Release::Origin=$ORIGIN" \
  -o "APT::FTPArchive::Release::Label=$ORIGIN" \
  -o "APT::FTPArchive::Release::Suite=$SUITE" \
  -o "APT::FTPArchive::Release::Codename=$SUITE" \
  -o "APT::FTPArchive::Release::Components=$COMPONENT" \
  -o "APT::FTPArchive::Release::Architectures=$ARCHES" \
  release "dists/$SUITE" > "dists/$SUITE/Release"

if [ -n "${SDODS_APT_GPG_KEY:-}" ]; then
  export GNUPGHOME
  GNUPGHOME=$(mktemp -d)
  chmod 700 "$GNUPGHOME"
  printf '%s' "$SDODS_APT_GPG_KEY" | gpg --batch --import
  key=$(gpg --list-secret-keys --with-colons | awk -F: '/^sec:/ {print $5; exit}')
  # InRelease (inline signature) is what modern apt reads; Release.gpg is kept for older clients,
  # and costs one extra call.
  gpg --batch --yes --default-key "$key" --clearsign -o "dists/$SUITE/InRelease" "dists/$SUITE/Release"
  gpg --batch --yes --default-key "$key" -abs -o "dists/$SUITE/Release.gpg" "dists/$SUITE/Release"
  # The public key visitors add to /usr/share/keyrings. Dearmoured: apt reads binary keyrings, and
  # an armoured file in that directory fails with a signature error that names the wrong cause.
  gpg --export "$key" > sdods-archive-keyring.gpg
  rm -rf "$GNUPGHOME"
  echo "✔ signed apt repo in $OUT_DIR ($debs package(s), suite $SUITE, arches: $ARCHES)"
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
