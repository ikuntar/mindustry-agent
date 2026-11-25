#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$ROOT/refs/mindustry-v160.8"
SERVER_LOG="$ROOT/artifacts/writer-lock-server.log"
DISCOVERY="/tmp/mindustry-ai-probe/bridge-info.json"

mkdir -p "$ROOT/artifacts"
cleanup() {
  pkill -f '^java -jar server-release.jar' 2>/dev/null || true
}
trap cleanup EXIT

cleanup
rm -f "$DISCOVERY"
cd "$SERVER_DIR"
(
  printf 'host fortress\n'
  sleep 60
) | PROBE_ENABLE_DEBUG_OPS=1 timeout 70 java -jar server-release.jar > "$SERVER_LOG" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 30); do
  if [[ -f "$DISCOVERY" ]]; then
    break
  fi
  sleep 1
done

if [[ ! -f "$DISCOVERY" ]]; then
  echo "probe discovery did not appear; server log:" >&2
  tail -80 "$SERVER_LOG" >&2 || true
  exit 1
fi

cd "$ROOT"
timeout 30s node probe-mod/client/writer-test.mjs
cd "$ROOT/mcp-server"
MINDUSTRY_AI_ADAPTER=probe PROBE_PORT=46500 timeout 45s npm run writer-harness
