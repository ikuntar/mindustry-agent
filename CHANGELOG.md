# Changelog

## 0.2.0

- Add `get_spawns` for fixed wave spawn points (`WaveSpawner.getSpawns()`), with
  tile and pixel coordinates, visibility, wave team, drop-zone radius, and fog
  filtering.
- Add shared `entity`/`unit`/`building` sensor objects backed by
  `Senseable.sense(LAccess)`; `query_area detail:"full"` exposes the same
  fields.
- Add `context.logic` aliases and `get_context.time/second/minute/waveSeconds/
  server/client/contentCounts`.
- Add `LOGIC-PROCESSOR-GUIDE.md` and bundle it in the mod jar at
  `/docs/LOGIC-PROCESSOR-GUIDE.md`.
- Change the default session bind to loopback (`127.0.0.1`); LAN access now
  requires `PROBE_SESSION_BIND=0.0.0.0`.
- Disable test/debug operations unless `PROBE_ENABLE_DEBUG_OPS=1`; fixture
  scripts opt in explicitly.
- Add an in-game settings panel for session port/LAN binding, bootstrap-token
  refresh, and editable/copyable session prompt.
- Add GPL-3.0 license, security policy, CI, reproducible Mindustry fetch, and
  local release/checksum scripts.
