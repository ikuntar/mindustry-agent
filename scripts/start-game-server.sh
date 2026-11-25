#!/usr/bin/env bash
# Start the official Mindustry server with probe-mod and leave it running for
# an MCP host. Stop with scripts/stop-game-server.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$ROOT/refs/mindustry-v160.8"
JAR="$SERVER_DIR/server-release.jar"
PROBE_JAR="$ROOT/probe-mod/build/ai-probe.jar"
LOG="$ROOT/artifacts/host-server.log"
DISCOVERY="/tmp/mindustry-ai-probe/bridge-info.json"

mkdir -p "$ROOT/artifacts" "$SERVER_DIR/config/mods"

if [[ ! -f "$JAR" ]]; then
  printf 'missing %s\n' "$JAR" >&2
  exit 1
fi
if [[ ! -f "$PROBE_JAR" ]]; then
  printf 'missing %s; build probe-mod first\n' "$PROBE_JAR" >&2
  exit 1
fi

if pgrep -f '^java -jar server-release.jar' >/dev/null; then
  printf 'server already running; run scripts/stop-game-server.sh first\n' >&2
  exit 1
fi

cp "$PROBE_JAR" "$SERVER_DIR/config/mods/ai-probe.jar"
rm -f "$DISCOVERY" "$LOG"
cd "$SERVER_DIR"
(
  printf 'host fortress\n'
  sleep 86400
) | PROBE_REQUIRE_AUTH=1 PROBE_EXPOSE_SESSION=1 PROBE_ENABLE_DEBUG_OPS="${PROBE_ENABLE_DEBUG_OPS:-1}" PROBE_DATA_RATE_LIMIT_PER_SEC=120 \
  setsid java -jar server-release.jar > "$LOG" 2>&1 &
SERVER_PID=$!
disown "$SERVER_PID" 2>/dev/null || true
printf '%s\n' "$SERVER_PID" > "$ROOT/artifacts/host-server.pid"

for _ in $(seq 1 40); do
  if [[ -f "$DISCOVERY" ]]; then
    printf 'server ready: pid=%s map=Fortress log=%s\n' "$SERVER_PID" "$LOG"
    exit 0
  fi
  sleep 1
done

printf 'probe discovery did not appear; server log:\n' >&2
tail -80 "$LOG" >&2 || true
exit 1
