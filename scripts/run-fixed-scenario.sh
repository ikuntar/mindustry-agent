#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$ROOT/refs/mindustry-v160.8"
SERVER_LOG="$ROOT/artifacts/fixed-map-server.log"
SEED_JSON="$ROOT/artifacts/fixed-map-seed.json"
SCENARIO_LOG="$ROOT/artifacts/fixed-map-scenario.log"
DISCOVERY="/tmp/mindustry-ai-probe/bridge-info.json"

mkdir -p "$ROOT/artifacts"

cleanup() {
  pkill -f '^java -jar server-release.jar' 2>/dev/null || true
}
trap cleanup EXIT

cleanup
rm -f "$DISCOVERY" "$SEED_JSON" "$SCENARIO_LOG"
cd "$SERVER_DIR"
(
  printf 'host fortress\n'
  sleep 150
) | timeout 160 java -jar server-release.jar > "$SERVER_LOG" 2>&1 &
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
timeout 45s node probe-mod/client/seed.mjs > "$SEED_JSON"
cd "$ROOT/mcp-server"
npm run build
MINDUSTRY_AI_ADAPTER=probe \
PROBE_SEED="$SEED_JSON" \
PROBE_EXPECT_MAP=Fortress \
npm run scenario 2>&1 | tee "$SCENARIO_LOG"

echo "scenario report: $SCENARIO_LOG"
