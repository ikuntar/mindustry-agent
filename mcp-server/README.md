# Mindustry AI MCP server

MCP tool interface for the in-game AI assistant. Current implementation uses
`MockGameAdapter`; the real Mindustry mod adapter is the next milestone.

## Run

```bash
npm install
npm run build
npm test
npm run harness
```

## Real game adapter (probe)

`ProbeGameAdapter` connects to `probe-mod` over localhost and maps the subset of
game actions that probe implements. Start the Mindustry server with the probe
mod, then:

```bash
MINDUSTRY_AI_ADAPTER=probe PROBE_PORT=46500 npm run harness
```

Implemented: `get_context`, `get_capabilities`, `get_content` (static registry),
`query_area`, `move_to`, `build_plan` (single placement). Everything else returns
`not_implemented` — do not treat tool presence as real-game support.

`get_events` is an empty page for probe; event logging is a Milestone 1 task.

## Tools

25 tools: 8 read + 17 action. See `../docs/MCP-PROTOCOL.md` for the contract.

Read:
`get_context`, `get_capabilities`, `get_content`, `get_map_summary`, `get_events`, `query_area`,
`get_config_schema`, `get_action_result`

Action:
`move_to`, `attack`, `follow`, `mine`, `stop`, `build_plan`, `deconstruct`,
`repair`, `withdraw`, `deposit`, `configure`, `command_units`, `set_stance`,
`possess`, `release`, `respawn`, `cancel`

## Layout

```
src/
  types.ts                 shared protocol/adapter types
  server.ts                MCP tool registration
  index.ts                 stdio entry
  adapters/
    MockGameAdapter.ts     deterministic in-memory game for protocol tests
test/
  mock.test.ts             adapter state machine tests
  mcp.test.ts              MCP in-memory transport tests
harness/
  smoke.ts                 stdio client smoke test
```

## Design constraints

- The assistant acts as its own unit/team; never as `Vars.player`.
- Action tools are asynchronous: return `{opId, status}`, poll with
  `get_action_result`.
- `build_plan` pays resources and builds over time; no god-hand
  `constructFinish`.
- No chat UI in this phase; tool-only interface for a harness/MCP host.
- Real adapter must keep the same contract; see `docs/MCP-PROTOCOL.md` §8.
