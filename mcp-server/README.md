# Mindustry Agent MCP server

MCP tool interface for the in-game co-op assistant. The MCP host owns goals and
the agent loop; this server exposes a stateless game tool surface.

`MockGameAdapter` is for protocol tests. `ProbeGameAdapter` is the real
Mindustry v160.8 + probe-mod path.

## Run

```bash
npm install
npm run build
npm test
npm run harness       # mock by default
```

For a real game, use the repository wrapper so the adapter is not mock:

```bash
/ABS/PATH/mindustry-agent/scripts/mindustry-mcp --check
# In an MCP host, command is:
/ABS/PATH/mindustry-agent/scripts/mindustry-mcp
```

The wrapper defaults to `MINDUSTRY_AI_ADAPTER=probe`; it never runs `npm build`
so MCP stdout stays clean. See `../docs/HARNESS-INTEGRATION.md` for Claude Code,
Claude Desktop, Codex, OpenCode and Hermes config examples.

## Real game adapter (probe)

```bash
MINDUSTRY_AI_ADAPTER=probe PROBE_PORT=46500 npm run harness
../scripts/run-fixed-scenario.sh
# OpenAI-compatible tool loop; LLM_MOCK=1 needs no credentials
LLM_MOCK=1 MINDUSTRY_AI_ADAPTER=mock npm run llm-harness
# local HTTP mock endpoint
node harness/mock-openai-server.mjs
MINDUSTRY_AI_ADAPTER=mock LLM_BASE_URL=http://127.0.0.1:18080/v1 npm run llm-harness
```

Implemented by probe: context, capabilities, content, map summary, events,
bounded area queries, config schema, action log, movement, attack, follow,
mine, stop, build, deconstruct, repair, withdraw/deposit, configure,
command/stance, possess/release/respawn and cancel. `get_config_schema` and
`get_tile.config` read real game content/config.

## Tools

27 tools: 10 read + 17 action. See `../docs/MCP-PROTOCOL.md` for the contract.

Read:
`get_context`, `get_capabilities`, `get_content`, `get_map_summary`, `get_events`,
`get_area`, `query_area`, `get_config_schema`, `get_action_result`,
`get_action_log`

Action:
`move_to`, `attack`, `follow`, `mine`, `stop`, `build_plan`, `deconstruct`,
`repair`, `withdraw`, `deposit`, `configure`, `command_units`, `set_stance`,
`possess`, `release`, `respawn`, `cancel`

## Layout

```
src/
  types.ts                 shared protocol/adapter types
  server.ts                MCP tool registration and server instructions
  index.ts                 stdio entry
  adapters/
    MockGameAdapter.ts     deterministic in-memory game for protocol tests
    ProbeGameAdapter.ts    real game socket/discovery adapter
test/                      adapter + MCP tests
harness/
  smoke.ts                full stdio smoke against mock/probe
  host-smoke.ts           generic MCP host launch through scripts/mindustry-mcp
  llm.ts                  OpenAI-compatible tool loop
  scenario.ts             fixed Fortress scenario
```

## Design constraints

- The assistant acts as its own unit/team; never as `Vars.player`.
- Action tools are asynchronous: return `{opId, status}`, poll with
  `get_action_result`.
- `build_plan` pays resources and builds over time; no god-hand
  `constructFinish`.
- No chat UI; tool-only interface for a harness/MCP host.
- The MCP server has no long-term goal/planner; that belongs to the host.
