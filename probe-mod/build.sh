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
mkdir -p "$ROOT/build/classes/ai/probe"
mkdir -p "$ROOT/build/classes/ai/probe/docs"
cp "$ROOT/../docs/GAME-GUIDE.md" "$ROOT/build/classes/ai/probe/game-guide.md"
for doc in SESSION-API.md API-DATA-CONTRACT.md MCP-PROTOCOL.md REALITY-CHECK.md LOGIC-PROCESSOR-GUIDE.md; do
  if [[ -f "$ROOT/../docs/$doc" ]]; then
    cp "$ROOT/../docs/$doc" "$ROOT/build/classes/ai/probe/docs/$doc"
  fi
done
jar --create --file "$ROOT/build/mindustry-agent.jar" -C "$ROOT/build/classes" .

echo "built: $ROOT/build/mindustry-agent.jar"
