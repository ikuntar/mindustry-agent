# Contributing

[English](CONTRIBUTING.md) | [简体中文](CONTRIBUTING.zh-CN.md)

This is an experimental Mindustry mod and harness project. Small, verifiable
changes are preferred over broad refactors.

## Before opening a PR

1. Run `mcp-server` tests:
   ```bash
   cd mcp-server
   npm ci
   npm test
   ```
2. Build the mod:
   ```bash
   cd ..
   scripts/fetch-mindustry.sh
   probe-mod/build.sh
   ```
3. For gameplay/API changes, run the relevant real-game smoke:
   ```bash
   scripts/start-game-server.sh
   node scripts/session-api-smoke.mjs
   scripts/stop-game-server.sh
   ```
   The one-time bootstrap is consumed by the first session; restart the server
   before running a second smoke.
4. Keep documentation and `/tools` schema in sync with new actions. Add a
   regression check for a new read/write path where possible.

## Scope

- Do not add autonomous goals or long-running planners to the MCP server; the
  harness owns the goal loop.
- Do not add default low-health retreat, idle auto-targeting, or auto-fire. A
  unit moves/attacks only from an explicit action.
- Keep debug/test operations behind `PROBE_ENABLE_DEBUG_OPS=1`.
- Do not commit tokens, server credentials, `.env` files, `refs/`, `artifacts/`,
  or built jars.

## License

By contributing, you agree that your contribution is licensed under
GPL-3.0-only. See `LICENSE`.
