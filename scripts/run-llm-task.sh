#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$ROOT/refs/mindustry-v160.8"
SERVER_LOG="$ROOT/artifacts/llm-task-server.log"
SEED_JSON="$ROOT/artifacts/llm-task-seed.json"
LLM_LOG="$ROOT/artifacts/llm-task.json"
DISCOVERY="/tmp/mindustry-ai-probe/bridge-info.json"

mkdir -p "$ROOT/artifacts"

cleanup() {
  pkill -f '^java -jar server-release.jar' 2>/dev/null || true
}
trap cleanup EXIT

cleanup
rm -f "$DISCOVERY" "$SEED_JSON" "$LLM_LOG"
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

LLM_BASE_URL="${LLM_BASE_URL:-http://127.0.0.1:11434/v1}" \
MINDUSTRY_AI_ADAPTER=probe \
PROBE_PORT=46500 \
LLM_MODEL="${LLM_MODEL:-lfm3:latest}" \
LLM_MAX_STEPS="${LLM_MAX_STEPS:-8}" \
LLM_FINAL_CONTEXT=1 \
LLM_REQUIRE_TOOLS="withdraw,deposit" \
LLM_TOOL_CHOICE="${LLM_TOOL_CHOICE:-required}" \
LLM_TASK="${LLM_TASK:-Use get_context once. Then withdraw 5 copper from the assistant core into your body with the withdraw tool, using the core id from context. Then deposit the 5 copper back into the same core with the deposit tool. You must call withdraw and deposit; do not call any other action tool.}" \
npm run llm-harness 2>&1 | tee "$LLM_LOG"

echo "LLM task report: $LLM_LOG"
