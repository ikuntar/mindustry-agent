#!/usr/bin/env bash
# Stop the server started by scripts/start-game-server.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pkill -f '^java -jar server-release.jar' 2>/dev/null || true
rm -f "$ROOT/artifacts/host-server.pid"
printf 'mindustry host server stopped\n'
