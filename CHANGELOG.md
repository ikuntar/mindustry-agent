# Changelog

[English](CHANGELOG.md) | [简体中文](CHANGELOG.zh-CN.md)

## Unreleased

- Include `get_area` in the paused read-only operation whitelist.
- Accept item-name strings for sorter `configure` values, return `not_found` for unknown
  content references, and document the config write shape.

## 0.3.0

- Rename the project, mod id, display name, discovery directory, and release
  artifact from `mindustry-ai`/`ai-probe` to `mindustry-agent`/`Mindustry Agent`.
- Old saves using the previous mod id are not migrated; this is an intentional
  breaking rename for a project that is still pre-1.0.
- Add the in-game settings panel for session port/LAN binding, bootstrap-token
  refresh, and editable/copyable session prompt.
- Shorten the generated session prompt to state what the API is and the minimum
  handshake/usage steps; detailed rules remain in `/guide`.
- Rewrite discovery after the session port/bind are resolved; previously the
  first discovery write advertised the default port until a world load.
- Make world-load bootstrap rotation unconditional; the old bootstrap is always
  invalid after a map load, while a live sessionToken survives.
- Expose `dropZoneRadius`, `enemyCoreBuildRadius`, and `polygonCoreProtection` in
  rules/spawn data; `get_tile` preflight now reports `enemy_core_build_radius`.
- Add an explicit action-policy line to the initial and MCP task prompts so a
  harness does not infer default movement, targeting, or auto-fire.
- Keep the Java package `ai.probe` and repository folder `probe-mod` for now;
  neither is part of the user-facing mod identity.

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
