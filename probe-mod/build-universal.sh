#!/usr/bin/env bash
# Build a universal Mindustry mod jar:
#   - desktop: normal JVM classes in the jar
#   - Android: classes.dex at the jar root
#
# Requirements:
#   - JAVA_HOME / javac (17+) for the desktop compile
#   - Android SDK build-tools d8
#   - ANDROID_HOME or ANDROID_SDK_ROOT, or set ANDROID_D8 + ANDROID_JAR
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/toolchains/android-sdk}}"
D8="${ANDROID_D8:-$(find "$SDK/build-tools" -type f -name d8 2>/dev/null | sort -V | tail -1)}"
ANDROID_JAR="${ANDROID_JAR:-$(find "$SDK/platforms" -type f -name android.jar 2>/dev/null | sort -V | tail -1)}"
MIN_API="${MINDUSTRY_ANDROID_MIN_API:-21}"

if [[ -z "$D8" || ! -x "$D8" ]]; then
  printf 'd8 not found; set ANDROID_D8 or ANDROID_HOME\n' >&2
  exit 1
fi
if [[ -z "$ANDROID_JAR" || ! -f "$ANDROID_JAR" ]]; then
  printf 'android.jar not found; set ANDROID_JAR or ANDROID_HOME\n' >&2
  exit 1
fi

"$ROOT/build.sh"
cp "$ROOT/build/mindustry-agent.jar" "$ROOT/build/mindustry-agent-desktop.jar"
rm -rf "$ROOT/build/dex"
mkdir -p "$ROOT/build/dex"

# d8 consumes the desktop jar and emits classes.dex. Mindustry itself is a
# classpath dependency, not packaged into the mod.
"$D8" --release --min-api "$MIN_API" \
  --output "$ROOT/build/dex" \
  --classpath "$ROOT/../refs/mindustry-v160.8/server-release.jar" \
  --lib "$ANDROID_JAR" \
  "$ROOT/build/mindustry-agent-desktop.jar"

if [[ ! -f "$ROOT/build/dex/classes.dex" ]]; then
  printf 'd8 did not produce classes.dex\n' >&2
  exit 1
fi

cp "$ROOT/build/mindustry-agent-desktop.jar" "$ROOT/build/mindustry-agent.jar"
jar --update --file "$ROOT/build/mindustry-agent.jar" -C "$ROOT/build/dex" classes.dex

printf 'built universal: %s\n' "$ROOT/build/mindustry-agent.jar"
jar tf "$ROOT/build/mindustry-agent.jar" | grep -E '^(mod.json|classes.dex|ai/probe/ProbeMod.class)$' || true
