# 主流 MCP Harness 接入

目标：让 Claude Code / Claude Desktop / Codex / OpenCode / Hermes 这类已经有
agent loop 的 host 直接调用本项目的 MCP server，而不是在本项目里再实现长期目标。

## 职责边界

- **Host/harness 负责**：目标、长期计划、重试策略、上下文管理、模型选择。
- **MCP server 负责**：暴露 27 个游戏工具、把调用映射到真实游戏、返回有界观测。
- MCP server 不内置 planner、不自动玩游戏、不保存跨会话目标。
- 推荐 host 每一轮只做一个动作或一个短动作序列，然后重新读 `get_context`。

## 前置条件

1. 已构建 MCP server：
   ```bash
   cd mcp-server
   npm install
   npm run build
   ```
2. 已启动带 probe mod 的 Mindustry 服务端：
   ```bash
   /ABS/PATH/mindustry-ai/scripts/start-game-server.sh
   /ABS/PATH/mindustry-ai/scripts/mindustry-mcp --check
   ```
   `start-game-server.sh` 需要先有 `probe-mod/build/ai-probe.jar`；停止用
   `scripts/stop-game-server.sh`。`run-fixed-scenario.sh` 是一次性验收，不要
   和长期 host 共用。
3. Harness 启动的 command 必须是 **`scripts/mindustry-mcp`**，不要直接
   `node dist/src/index.js`；直接启动默认是 mock adapter，会得到假游戏。

`scripts/mindustry-mcp` 默认 `MINDUSTRY_AI_ADAPTER=probe`，不会在启动时
`npm build`（避免污染 MCP 的 stdout）；构建失败会明确报缺失入口。

## 各 host 配置

把 `/ABS/PATH` 换成实际仓库路径。

### Claude Code

```bash
claude mcp add -s user mindustry -- /ABS/PATH/mindustry-ai/scripts/mindustry-mcp
claude mcp list
```

项目级：

```bash
claude mcp add -s project mindustry -- /ABS/PATH/mindustry-ai/scripts/mindustry-mcp
```

### Claude Desktop

`claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "mindustry": {
      "command": "/ABS/PATH/mindustry-ai/scripts/mindustry-mcp",
      "args": []
    }
  }
}
```

### Codex

```bash
codex mcp add mindustry -- /ABS/PATH/mindustry-ai/scripts/mindustry-mcp
```

或 `~/.codex/config.toml`：

```toml
[mcp_servers.mindustry]
command = "/ABS/PATH/mindustry-ai/scripts/mindustry-mcp"
args = []
startup_timeout_sec = 20
tool_timeout_sec = 120
```

### OpenCode

```bash
opencode mcp add mindustry -- /ABS/PATH/mindustry-ai/scripts/mindustry-mcp
```

或 `opencode.json(c)`（当前 schema 用 `mcp.servers`）：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "mindustry": {
        "type": "local",
        "command": ["/ABS/PATH/mindustry-ai/scripts/mindustry-mcp"],
        "timeout": 120000
      }
    }
  }
}
```

### omp (oh-my-pi)

不要把 Mindustry MCP 配置放进代码仓库的 `.omp/mcp.json`：omp 会在该仓库的
每次会话都加载 27 个游戏工具，写代码时也会被污染。使用独立游戏目录的
launcher：

```bash
cd /ABS/PATH/mindustry-ai
scripts/omp-mindustry
```

launcher 会把配置写到 `~/.mindustry-omp/.omp/mcp.json`（可用
`MINDUSTRY_OMP_WORKDIR` 改路径），然后在该目录启动 omp；MCP command 使用
仓库的绝对路径。这样：

- 在仓库里直接运行 `omp` 不会加载游戏 MCP
- 游戏会话的配置独立于代码会话
- omp 退出后 stdio MCP 子进程一起退出；没有常驻 MCP daemon
- 不会安装或加载 mindustry skill（本项目没有给 omp 装 skill）

等价的配置：

```json
{
  "mcpServers": {
    "mindustry": {
      "type": "stdio",
      "command": "/ABS/PATH/mindustry-ai/scripts/mindustry-mcp",
      "env": { "MINDUSTRY_AI_ADAPTER": "probe" }
    }
  }
}
```

已验证（真实 `Fortress` + probe）：

```bash
scripts/omp-mindustry -p --no-session --max-time 120 \
  'Use the mindustry MCP server. get_context summary, move_to core.x+24, poll get_action_result, report final position.'
```

实际结果：`op-1 done`，助手从 `(928,584)` 移动到 `(942.2,584)`，在 arriveRadius 内。

### Hermes

`~/.hermes/config.yaml`：

```yaml
mcp_servers:
  mindustry:
    command: "/ABS/PATH/mindustry-ai/scripts/mindustry-mcp"
    args: []
    timeout: 120
```

Hermes 会把工具注册为 `mcp_mindustry_*`，重启后生效。

## 推荐的 host system prompt

```text
You are operating a Mindustry co-op assistant through MCP tools.
The game server and probe are already running. The MCP server is stateless:
you own the current goal and the loop.

Loop:
1. Call get_context with detail="summary".
2. Choose one action that advances the goal.
3. Write tools are asynchronous: poll get_action_result until done/failed.
4. Re-read get_context; if the action failed, read the structured error before retrying.
5. Do not use mock state. Do not invent units, buildings, or map tiles.
6. Use get_area for local tile detail; use get_map_summary/get_events summaries
   rather than dumping the whole map into context.

You are the assistant unit, not the human player. Use possess/release and
respawn only through their tools. This server does not plan long-term goals.
```

## 工具使用约定

- 先 `get_context({detail:"summary"})`，需要细节再用 `get_area` 或
  `get_map_summary` + 只读数据面。
- 写工具返回 `{accepted, opId}`；必须 `get_action_result({opId})` 轮询，不要
  在动作未完成时连续发新动作。
- `move_to`/`attack`/`follow`/`mine`/`deconstruct`/`repair` 支持
  `timeoutTicks`；超时返回 `failed` + `data.code=timeout`。
- 多步资源操作可用 `idempotencyKey` 防止 host 重试造成重复动作。
- 不确定错误时先看 `error.code/category/retryable`，不要盲目重试。
- 目标较长时由 host 自己拆成子目标；mcp server 不保存计划。

## 模型选择（测试与长流程）

- 长流程/真正多步任务：优先用 `deepseek-v4.1-flash`（通过 OpenAI-compatible
  端点）；它更适合多轮工具调用。
- 本地测试：优先 `lfm3`，再试 `qwen3.5:4b`；两者都要限制工具集做冒烟。
- 显存：本地只常驻一个模型；先确认 `nvidia-smi` 显存余量，跑完卸载再换模型。
  不要并行加载多个 4B/7B 模型。
- 仓库不写 API key；通过 host/provider 的环境变量注入。
- 已有 `LLM_TOOL_FILTER`/`LLM_TOOL_CHOICE` 只用于本项目 LLM harness 冒烟，
  主流 host 应使用自己的工具选择和审批机制。

## 战役模式（Ground Zero）实测

专用服务端没有原生 `campaign` 命令，只有 `host <map> [mode]`。仓库通过
`scripts/start-ground-zero-server.sh` 做了 campaign-like fixture：

- 从 jar 载入内嵌 `maps/serpulo/groundZero.msav`
- `host groundZero survival`
- 设置 `rules.sector = SectorPresets.groundZero.sector`
- `rules.winWave = captureWave`（本版本为 10）
- 给队伍 150 copper / 50 lead，`waveSpacing=30`

启动：

```bash
scripts/start-ground-zero-server.sh
scripts/mindustry-mcp --check
```

`get_context` 会返回 `campaign/sector/won/gameOver/winWave`，host 可据此判断
是否停止。omp 实测到达 `wave=10`、核心存活、`winWave=10`，但 `won=false`；
专用服随后自动切到下一张地图，且没有客户端战役的 objectives/存档归属。
因此：

- 能验证“omp 通过 MCP 在 Ground Zero 地图上持续观察/行动到终点波次”
- **不能**声称完成了原版战役第一关的正式结算
- 真正战役胜利需要客户端 host campaign，或在 probe mod 里补战役目标/结算支持

## omp 上手速度（2026-11-21，本机）

命令形态：

```bash
omp -p --no-session --max-time 90 --cwd /home/kuutar/project/mindustry-ai \
  'Use mindustry MCP get_context detail="full" ...'
```

实测：

- 冷启动 + 首次真实 `get_context`：约 **13.0s**
- 已热启动 + 首次真实 `get_context`：约 **8.7s**
- Ground Zero 连续观察：35 次 `get_context`，约 254s，约 **7.3s/次**（包含
  模型推理、MCP 调用和工具结果回传，不只是游戏 RPC）
- 完整 Ground Zero 到 `wave=10` 的服务器时间约 4.5 分钟；omp 的 420s
  播放会话仍可能先到 max-time，host 必须用 `won/gameOver` 做明确停止条件。

这些数字用于判断“host 上手是否可用”，不是游戏服务器性能基准。

## 验收

```bash
# 1) wrapper 的通用 MCP host 启动路径（mock，不需要游戏）
cd mcp-server && npm run host-smoke
# 期望：{"ok":true,"tools":27,"adapter":"mock","moveStatus":"done"}

# 2) 真实游戏（先启动 probe 服务端）
/ABS/PATH/mindustry-ai/scripts/start-game-server.sh
/ABS/PATH/mindustry-ai/scripts/mindustry-mcp --check
cd mcp-server && MINDUSTRY_AI_ADAPTER=probe npm run harness
# wrapper + 真实 probe 的通用 host 冒烟（本机已通过：27 tools, move done）
cd mcp-server && MINDUSTRY_AI_ADAPTER=probe npm run host-smoke
/ABS/PATH/mindustry-ai/scripts/stop-game-server.sh

# 3) 固定地图回归
/ABS/PATH/mindustry-ai/scripts/run-fixed-scenario.sh
```

真实 host 上应能看到 27 个工具；调用 `get_context` 返回真实 `Fortress` 地图和
助手单位，而不是 mock 的 `20,20`。若看到 mock 数据，检查 host 的 command
是否指向了 `dist/src/index.js` 而没有设置 `MINDUSTRY_AI_ADAPTER=probe`。

## 故障排查

- `discovery missing`：游戏服务端没启动或 probe mod 没加载。
- `probe_not_running` / connection refused：先启动游戏，再重试工具。
- host 只显示部分工具：检查 `MCP_ALLOWED_TOOLS`/`MCP_DENIED_TOOLS` 是否在
  wrapper 的环境中设置了。
- 写动作被拒绝：检查 `PROBE_REQUIRE_WRITER=1` 时 adapter 是否已 claim，
  以及 `MCP_WRITE_RATE_LIMIT`。
- 工具卡住：写动作用 `timeoutTicks` 或 `cancel`；host 侧也应有自己的超时。
- stdout 出现构建日志：不要让 host 执行 `npm run build`；先手动构建，
  wrapper 只运行 `node dist/src/index.js`。
