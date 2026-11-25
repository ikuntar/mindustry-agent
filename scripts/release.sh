#!/usr/bin/env bash
# Build a local release artifact and checksum. This does not upload anything.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -p "require('$ROOT/probe-mod/mod.json').version")"
OUT="$ROOT/release"
JAR="$ROOT/probe-mod/build/mindustry-agent.jar"

mkdir -p "$OUT"
"$ROOT/probe-mod/build-universal.sh"
cp "$JAR" "$OUT/mindustry-agent-$VERSION.jar"
(
  cd "$OUT"
  sha256sum "mindustry-agent-$VERSION.jar" > SHA256SUMS
)
printf 'release artifact: %s\n' "$OUT/mindustry-agent-$VERSION.jar"
cat "$OUT/SHA256SUMS"
