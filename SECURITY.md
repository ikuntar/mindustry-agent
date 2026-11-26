# Security

[English](SECURITY.md) | [简体中文](SECURITY.zh-CN.md)

`mindustry-agent` exposes a local game-control API. Treat the session token and
the raw probe token as credentials for controlling a running game.

## Supported versions

Security fixes are applied to the latest `0.3.x` mod version. Older jars and
unreleased snapshots are not supported.

## Reporting

Do not open a public issue with a token, password, private server address, or an
exploit that is not already publicly known. Use GitHub's private security
advisory for the repository, or contact the maintainer through the repository
profile. Please include:

- affected version (`/session` and `/context` return `version`)
- platform (desktop/server/Android; Mindustry 160.x)
- reproduction steps with secrets removed
- whether the probe/session port was loopback-only or LAN-exposed

## Threat model

- The session API can read game state, move/possess units, and change buildings.
  It is not a read-only telemetry endpoint.
- The raw probe socket is an internal/test transport. It can access debug
  operations when `PROBE_ENABLE_DEBUG_OPS=1`; do not expose it.
- The session server binds to `127.0.0.1` by default. Setting
  `PROBE_SESSION_BIND=0.0.0.0` exposes it to the network and is an explicit
  opt-in with your own firewall/trust boundary.
- Tokens are generated per game process. Do not paste them into issues, logs,
  screenshots, or public chat.
- The mod has no license to bypass server rules, anti-cheat, or other players'
  consent. Use it only in single-player or on servers where automation is
  allowed.

## Debug operations

`give`, `spawn_enemy`, `set_floor`, `kill_assistant`, `set_paused`, and related
fixture helpers are disabled unless `PROBE_ENABLE_DEBUG_OPS=1` is set. Test
fixture scripts set it explicitly. Do not use that flag for a server that is
reachable by untrusted clients.
