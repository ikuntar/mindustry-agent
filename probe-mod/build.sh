#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JAR="${MINDUSTRY_JAR:-$ROOT/../refs/mindustry-v160.8/server-release.jar}"

if [[ ! -f "$JAR" ]]; then
  echo "Mindustry jar not found: $JAR" >&2
  echo "Set MINDUSTRY_JAR or download server-release.jar into refs/mindustry-v160.8/." >&2
  exit 1
fi

rm -rf "$ROOT/build"
mkdir -p "$ROOT/build/classes"
find "$ROOT/src" -name '*.java' -print0 | xargs -0 javac -source 17 -target 17 -cp "$JAR" -d "$ROOT/build/classes"
cp "$ROOT/mod.json" "$ROOT/build/classes/"
jar --create --file "$ROOT/build/ai-probe.jar" -C "$ROOT/build/classes" .

echo "built: $ROOT/build/ai-probe.jar"
