# Mindustry Agent MCP server

[English](README.md) | [简体中文](README.zh-CN.md)

游戏内合作助手的 MCP 工具接口。MCP host 负责目标和 agent loop；这个 server 暴露无状态的游戏工具面。

`MockGameAdapter` 用于协议测试。`ProbeGameAdapter` 是真实的 Mindustry v160.8 + probe-mod 路径。

## 运行

```bash
npm install
npm run build
npm test
npm run harness       # 默认 mock
```

连接真实游戏时使用仓库 wrapper，确保 adapter 不是 mock：

```bash
/ABS/PATH/mindustry-agent/scripts/mindustry-mcp --check
# 在 MCP host 中，command 为：
/ABS/PATH/mindustry-agent/scripts/mindustry-mcp
```

wrapper 默认 `MINDUSTRY_AI_ADAPTER=probe`；它不会在启动时跑 `npm build`，以保持 MCP stdout 干净。Claude Code、Claude Desktop、Codex、OpenCode 和 Hermes 的配置示例见 `../docs/HARNESS-INTEGRATION.md`。

## 真实游戏 adapter（probe）

```bash
MINDUSTRY_AI_ADAPTER=probe PROBE_PORT=46500 npm run harness
../scripts/run-fixed-scenario.sh
# OpenAI-compatible 工具循环；LLM_MOCK=1 不需要凭据
LLM_MOCK=1 MINDUSTRY_AI_ADAPTER=mock npm run llm-harness
# 本地 HTTP mock endpoint
node harness/mock-openai-server.mjs
MINDUSTRY_AI_ADAPTER=mock LLM_BASE_URL=http://127.0.0.1:18080/v1 npm run llm-harness
```

probe 已实现：context、capabilities、content、map summary、events、有界区域查询、config schema、action log、移动、攻击、跟随、采矿、停止、建造、拆除、修理、withdraw/deposit、configure、command/stance、possess/release/respawn 和 cancel。`get_config_schema` 与 `get_tile.config` 读取真实游戏内容和配置。

## 工具

27 个工具：10 个读 + 17 个动作。契约见 `../docs/MCP-PROTOCOL.md`。

读：

`get_context`, `get_capabilities`, `get_content`, `get_map_summary`, `get_events`,
`get_area`, `query_area`, `get_config_schema`, `get_action_result`,
`get_action_log`

动作：

`move_to`, `attack`, `follow`, `mine`, `stop`, `build_plan`, `deconstruct`,
`repair`, `withdraw`, `deposit`, `configure`, `command_units`, `set_stance`,
`possess`, `release`, `respawn`, `cancel`

## 目录结构

```text
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

## 设计约束

- 助手是独立的单位/队伍，绝不冒充 `Vars.player`。
- 动作工具是异步的：返回 `{opId, status}`，用 `get_action_result` 轮询。
- `build_plan` 会扣除资源并随时间建造；没有 god-hand `constructFinish`。
- 没有聊天 UI；只提供 harness/MCP host 的工具接口。
- MCP server 不包含长期目标/规划器；那属于 host。
