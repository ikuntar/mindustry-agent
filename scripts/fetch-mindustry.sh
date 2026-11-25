#!/usr/bin/env bash
# Fetch and verify the pinned Mindustry dedicated-server jar used to compile
# probe-mod. The upstream asset and checksum are pinned to v160.8.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST_DIR="$ROOT/refs/mindustry-v160.8"
DEST="$DEST_DIR/server-release.jar"
URL="https://github.com/Anuken/Mindustry/releases/download/v160.8/server-release.jar"
SHA256="faeaf247a8b622de940181a96cb21cb20692d3c3da4e8ac3f79cb4af5059aa6c"
TMP="$DEST.download"

mkdir -p "$DEST_DIR"

if [[ -f "$DEST" ]]; then
  printf '%s  %s\n' "$SHA256" "$DEST" | sha256sum -c -
  exit 0
fi

command -v curl >/dev/null 2>&1 || {
  printf 'curl is required to fetch %s\n' "$URL" >&2
  exit 1
}

printf 'downloading %s\n' "$URL"
curl --fail --location --retry 3 --output "$TMP" "$URL"
printf '%s  %s\n' "$SHA256" "$TMP" | sha256sum -c -
mv "$TMP" "$DEST"
printf 'ready: %s\n' "$DEST"
