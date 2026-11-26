# mindustry-agent

[English](README.md) | [简体中文](README.zh-CN.md)

An experimental co-op AI assistant for [Mindustry](https://github.com/Anuken/Mindustry), exposed as a mod, a local session API, and MCP tools.

The assistant is a normal in-game body: it can be possessed, respawn from cores, build, mine, fight, and follow explicit instructions. The harness owns the goal loop; this project does not ship an autonomous long-running planner.

> Status: technical preview. The API and mod are usable for experiments, but this is not a finished consumer mod. Read [Security](#security) before exposing it to a network.

Current public release: `0.3.1` ([GitHub Release](https://github.com/ikuntar/mindustry-agent/releases/tag/v0.3.1)).

## What is included

- `probe-mod/` — Mindustry Java mod and the in-game session/data API
- `mcp-server/` — MCP server implementation and a mock adapter for protocol tests
- `mindustry_data/` — read-only map/event data-plane client
- `docs/` — game guide, API contract, logic-processor guide, harness integration, and design notes
- `scripts/` — local build, server, smoke-test, and release helpers

There are two related tool surfaces:

```text
session API: 35 tools exposed by the mod at /tools and /mcp
Node MCP:    the separate mcp-server package (mock/stdio development surface)
```

The session API is the product path used by the in-game assistant. The Node MCP package is useful for protocol testing and host integration.

## Requirements

- Mindustry 160.x. The build and tests are pinned to v160.8.
- Java 17+ for building the mod.
- Node.js 20+ for the MCP server and smoke tests.
- Android universal builds additionally need Android SDK build-tools (`d8`) and `android.jar`.
- A desktop client or dedicated server; the dedicated server has no campaign UI, so campaign fixtures are loaded explicitly.

## Install the mod

Download `mindustry-agent-<version>.jar` from the [GitHub Releases page](https://github.com/ikuntar/mindustry-agent/releases) and place it in the game's mods directory:

```text
Linux:   ~/.local/share/Mindustry/mods/
Windows: %APPDATA%/Mindustry/mods/
macOS:   ~/Library/Application Support/Mindustry/mods/
```

On Android, use the game's importer instead of copying into `Android/data`:

```text
Mods -> Import Mod -> Import File -> choose the jar/zip
```

The universal jar contains both JVM classes and `classes.dex`; desktop and Android use different parts of the same archive.

If you are upgrading from the old `AI Probe` name, remove the old `ai-probe.jar` before installing `mindustry-agent.jar`. Do not keep both mod jars loaded: they use different mod ids and both would spawn an assistant. Old saves using the previous mod id are not migrated.

The jar is intentionally a probe/assistant mod, not a standalone client. Start Mindustry, load a map, then use the session prompt shown by the mod to connect a harness.

## Run from source

Fetch the pinned upstream server jar, then build:

```bash
scripts/fetch-mindustry.sh
probe-mod/build.sh
```

For the universal desktop + Android jar:

```bash
probe-mod/build-universal.sh
```

Start a local dedicated server with the probe installed:

```bash
scripts/start-game-server.sh
node scripts/session-api-smoke.mjs   # consumes one bootstrap token
scripts/stop-game-server.sh
```

Use `scripts/start-ground-zero-server.sh` for the campaign-like fixture.

> Restart the test server after a smoke test. The bootstrap token is one-time; a second session without a restart returns 401 by design.

## Session API

The mod starts an authenticated HTTP control plane:

```text
POST /session       one-time bootstrap -> sessionToken
GET  /context       bounded game context
GET  /guide         game knowledge guide
GET  /tools         35 tool schemas
POST /actions       {kind: ...} -> opId
GET  /actions/{id}  poll action status
GET  /events/wait   bounded long-poll
GET  /data/...      read-only map/event data plane
```

The bootstrap token is sent in the request header:

```http
Authorization: Bearer <bootstrap>
```

By default the session server binds to `127.0.0.1:47600`. LAN access is an explicit opt-in:

```bash
PROBE_SESSION_BIND=0.0.0.0 scripts/start-game-server.sh
```

The session token is separate from the raw probe token and the read-only data token. Do not put any token in a public issue, screenshot, or chat message.

Read [docs/SESSION-API.md](docs/SESSION-API.md) for endpoints and [docs/API-DATA-CONTRACT.md](docs/API-DATA-CONTRACT.md) for returned fields.

### In-game settings

Open `Settings -> Mindustry Agent`, or use the `Settings` button in the session dialog:

- change the session port (1024–65535) and rebind the HTTP server immediately
- opt into LAN binding with the `0.0.0.0` checkbox
- refresh the one-time bootstrap token
- edit, copy, and reset the session prompt text

The port and LAN choice are persisted in Mindustry's settings. `PROBE_SESSION_PORT` and `PROBE_SESSION_BIND` still override the saved values on process start. Rebinding does not change the existing session token or game state; clients must reconnect to the new endpoint. Edits to the prompt text affect only the copied text, not the API behavior.

## MCP

The Node package provides the MCP/stdio development surface:

```bash
cd mcp-server
npm ci
npm run build
npm test
```

Launch the wrapper after a game/probe server is running:

```bash
scripts/mindustry-mcp --check
MINDUSTRY_AI_ADAPTER=probe npm run host-smoke
```

The default adapter is the mock. Set `MINDUSTRY_AI_ADAPTER=probe` to connect to a real game through the probe discovery file.

See [docs/HARNESS-INTEGRATION.md](docs/HARNESS-INTEGRATION.md) for Claude Code/Desktop, Codex, OpenCode, omp, and Hermes configuration.

## Security

This project exposes game control, not just telemetry.

- The session API defaults to loopback. Exposing it to a LAN is your responsibility; use a firewall and a trusted network.
- Debug/test operations (`give`, `spawn_enemy`, `set_floor`, `kill_assistant`, and related helpers) are disabled by default. Set `PROBE_ENABLE_DEBUG_OPS=1` only for local fixtures. The repository's `scripts/start-*.sh` test fixtures opt in explicitly; the release jar does not.
- Do not expose the raw probe socket or the session API to the public internet.
- Use the assistant only in single-player or on servers where automation is permitted. It is not a license to bypass server rules or anti-cheat.
- See [SECURITY.md](SECURITY.md) for the threat model and reporting process.

## Development

```bash
# Node tests (mock adapter + MCP protocol)
cd mcp-server && npm ci && npm test

# Java compile
scripts/fetch-mindustry.sh
probe-mod/build.sh

# Release artifact + checksum (local; no upload)
scripts/release.sh
```

Fixed-map and real-game tests are documented in [docs/REALITY-CHECK.md](docs/REALITY-CHECK.md). The one-time bootstrap means tests that create a session must restart the server between runs.

## Documentation

- [GAME-GUIDE.md](docs/GAME-GUIDE.md) — game primer for an AI harness
- [SESSION-API.md](docs/SESSION-API.md) — mod HTTP/MCP surface
- [API-DATA-CONTRACT.md](docs/API-DATA-CONTRACT.md) — field-level response contract
- [LOGIC-PROCESSOR-GUIDE.md](docs/LOGIC-PROCESSOR-GUIDE.md) — in-game logic processor usage and API name mapping
- [MCP-PROTOCOL.md](docs/MCP-PROTOCOL.md) — MCP tools and action lifecycle
- [HARNESS-INTEGRATION.md](docs/HARNESS-INTEGRATION.md) — host configuration
- [PLAYER-PARITY.md](docs/PLAYER-PARITY.md) — implemented player abilities and remaining gaps
- [REALITY-CHECK.md](docs/REALITY-CHECK.md) — real-game verification notes
- [DOC-AUDIT.md](docs/DOC-AUDIT.md) — documentation consistency audit and Chinese-version map
- [RELEASING.md](docs/RELEASING.md) — build, tag, and attach the release artifact

## Known limitations

- The project is a technical preview; APIs may change before 1.0.
- The dedicated server does not have campaign UI; campaign-like fixtures load sector rules explicitly.
- Phone-hosted game sessions and full real-device Android validation are not complete.
- Some long-running/campaign scenarios and cross-sector logistics are outside the current scope.
- The Java mod is a large single source file and is being kept deliberately small enough to audit before the API stabilizes.

## License

GPL-3.0-only. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

Mindustry is a separate GPLv3 project by Anuken and contributors. This repository does not distribute the Mindustry jar; `scripts/fetch-mindustry.sh` downloads the pinned upstream release.
