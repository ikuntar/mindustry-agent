# Changelog

[English](CHANGELOG.md) | [简体中文](CHANGELOG.zh-CN.md)

## 0.4.2

- Put the mod's port, LAN and session-prompt controls directly in the
  `Settings -> Mindustry Agent` category instead of an extra "Open settings" button/dialog.
- Size settings and session-dialog content from `Core.graphics` with `growX` and
  scroll-safe widths so narrow/mobile windows do not overflow.

## 0.4.1

- Fix `repair`: it no longer grants direct building healing to Alpha/Beta/Gamma
  builder bodies. The action now requires `UnitType.canHeal` and returns
  `cannot_repair` for ordinary Serpulo builders; `get_capabilities` exposes `canHeal`.

## 0.4.0

- **Breaking:** all public coordinates and radii now use tile units; `move_to`,
  `get_area`, `query_area`, attack positions, entity positions, spawn points, and
  rule radii no longer return world pixels. Fractional tile values are allowed for
  continuous positions.
- Allow `deconstruct` to target static props that the game permits breaking, and expose
  `blockType`/`blockBreakable`/`destructible`/`alwaysReplace` on `get_tile`.
- Add `build_plan` conveyor warnings for blocked/air/back-facing outputs.
- Retain a `lastSnapshot` of wave/resources/cores when `gameOver` is reached.

## 0.3.1

- Include `get_area` in the paused read-only operation whitelist.
- Accept item-name strings for sorter `configure` values, return `not_found` for unknown
  content references, and document the config write shape.
- Add `id` to `/content` blocks/units, deduplicate unit ids, reject unknown content
  types, and expose `counts`/`returned`/`truncated`.
- Add `manifest.schema.blocks` so `/data` `block_id` can be decoded offline.
- Add `/guide` and `/tools` HEAD/ETag/304 support; remove the false
  `Accept-Ranges` claim from the control plane.
- Bump the guide format version and expose `guideTopics`; reject unknown `/guide` topics.
- Clarify `build_plan` initial `data.results[]` versus the last child `opId`, and add
  a guide table of contents plus a docs consistency CI check.
- Add `error.placeReason` to failed builds and `untilAmount`/`untilFull`/`until` to `mine`.
- Return `game_over` for write actions after core destruction and expose `sessionEnded`.
- Add `query_area.radiusTiles`, `get_tile.breakable/replaceable/outputTile`, and compact
  enemy fields (`enemyCount`, `nearestThreat`, `nearestThreatDistance`).

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
