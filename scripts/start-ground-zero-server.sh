#!/usr/bin/env bash
# Start the official Mindustry server on the campaign first sector (Ground Zero)
# with probe-mod, and leave it running for an MCP host.
#
# The dedicated server has no native "campaign" command. We load the embedded
# sector map, host it as survival, then attach the Ground Zero sector rules so
# the campaign win wave (9) is active.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$ROOT/refs/mindustry-v160.8"
JAR="$SERVER_DIR/server-release.jar"
PROBE_JAR="$ROOT/probe-mod/build/ai-probe.jar"
LOG="$ROOT/artifacts/ground-zero-server.log"
DISCOVERY="/tmp/mindustry-ai-probe/bridge-info.json"

mkdir -p "$ROOT/artifacts" "$SERVER_DIR/config/mods"
if [[ ! -f "$JAR" || ! -f "$PROBE_JAR" ]]; then
  printf 'missing server-release.jar or probe-mod/build/ai-probe.jar\n' >&2
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
  printf 'js let m=Vars.maps.loadInternalMap("serpulo/groundZero"); m.tags.put("name","groundZero"); Vars.maps.all().add(m); "groundZero map loaded"\n'
  sleep 2
  printf 'host groundZero survival\n'
  sleep 2
  printf 'js Vars.state.rules.sector = SectorPresets.groundZero.sector; Vars.state.rules.winWave = SectorPresets.groundZero.captureWave; Vars.state.rules.waveTimer = true; Vars.state.rules.waveSpacing = 30; Vars.state.rules.initialWaveSpacing = 10; let core = Vars.state.teams.get(Team.sharded).core(); if (core != null) { core.items.add(Items.copper, 150); core.items.add(Items.lead, 50); } let bs = Vars.content.blocks(); for (let i = 0; i < bs.size; i++) { bs.get(i).unlock(); } "groundZero campaign rules, blocks unlocked for fixture"\n'
  sleep 86400
) | PROBE_REQUIRE_AUTH=1 PROBE_EXPOSE_SESSION=1 PROBE_ENABLE_DEBUG_OPS="${PROBE_ENABLE_DEBUG_OPS:-1}" PROBE_DATA_RATE_LIMIT_PER_SEC=120 \
  setsid java -jar server-release.jar > "$LOG" 2>&1 &
SERVER_PID=$!
disown "$SERVER_PID" 2>/dev/null || true
printf '%s\n' "$SERVER_PID" > "$ROOT/artifacts/ground-zero-server.pid"

for _ in $(seq 1 40); do
  if [[ -f "$DISCOVERY" ]]; then
    printf 'server ready: pid=%s sector=GroundZero log=%s\n' "$SERVER_PID" "$LOG"
    exit 0
  fi
  sleep 1
done

printf 'probe discovery did not appear; server log:\n' >&2
tail -80 "$LOG" >&2 || true
exit 1
