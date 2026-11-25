#!/usr/bin/env bash
# Build a local release artifact and checksum. This does not upload anything.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -p "require('$ROOT/probe-mod/mod.json').version")"
OUT="$ROOT/release"
JAR="$ROOT/probe-mod/build/ai-probe.jar"

mkdir -p "$OUT"
"$ROOT/probe-mod/build-universal.sh"
cp "$JAR" "$OUT/ai-probe-$VERSION.jar"
(
  cd "$OUT"
  sha256sum "ai-probe-$VERSION.jar" > SHA256SUMS
)
printf 'release artifact: %s\n' "$OUT/ai-probe-$VERSION.jar"
cat "$OUT/SHA256SUMS"
