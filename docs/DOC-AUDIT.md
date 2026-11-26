# 文档一致性审计

审计日期：2026-11-25
审计对象：仓库内供人阅读的 Markdown 文档（README、CONTRIBUTING、SECURITY、CHANGELOG、`docs/`、`mcp-server/README.md`、`probe-mod/README.md`、issue 模板）
审计基线：`mindustry-agent` 0.3.0，session API 35 个工具，Node MCP 27 个工具。

## 结论

文档整体与当前实现一致，但审计发现并修正了以下偏差：

| 文档 | 问题 | 处理 |
|---|---|---|
| `SECURITY.md` | 支持版本仍写 `0.2.x` | 改为 `0.3.x` |
| `docs/MCP-PROTOCOL.md` | 仍称真实 adapter“尚未实现”，discovery 路径是旧 `mindustryx-ai-bridge`，并称握手是 `hello/welcome`；实际为 `ProbeGameAdapter` + `mindustry-agent-probe/bridge-info.json` + `hello/claim_writer` | 更新状态、拓扑、发现文件、握手、幂等和 Probe 状态章节 |
| `docs/ASSISTANT-DESIGN.md` | 写“真实 adapter 尚未实现” | 更新为已实现，并注明 Node MCP 27 / session 35 |
| `docs/DATA-ACCESS-AUDIT.md` | issue #34 的 `get_area` cursor 仍标未完成 | 更新为已实现并由 smoke 验证 |
| `docs/REALITY-CHECK.md` | 历史记录中的 27/34 工具数容易与当前 35 混淆 | 页首增加历史快照说明，指向当前权威文档 |
| `docs/REMOTE-DATA-PLANE.md` | 只写 27 个工具，未区分 Node MCP 和 session API | 明确 27 / 35 两个工具面 |
| `CONTRIBUTING.md` | 在 `cd mcp-server` 后直接调用根目录 `scripts/` | 补 `cd ..` |
| `docs/SESSION-API.md` | `get_spawns` 未列出新增的 `dropZoneRadiusTiles`、`enemyCoreBuildRadius`、`polygonCoreProtection` 和 `get_tile.spawnZone` | 补字段和预检语义，状态更新到 0.3.0 |

## 工具面口径

必须区分：

```text
mod session API:  35 tools（/tools 与 /mcp）
Node MCP server:  27 tools（mcp-server/）
```

`README.md`、`docs/SESSION-API.md`、`docs/PLAYER-PARITY.md` 使用 35；
`mcp-server/README.md`、`docs/HARNESS-INTEGRATION.md`、`docs/MCP-PROTOCOL.md`
使用 27。历史文档中的旧数字不删除，但必须标明是快照。

## 中文版本

本次新增：

- `README.zh-CN.md`
- `CHANGELOG.zh-CN.md`
- `CONTRIBUTING.zh-CN.md`
- `SECURITY.zh-CN.md`
- `docs/RELEASING.zh-CN.md`
- `mcp-server/README.zh-CN.md`
- `.github/ISSUE_TEMPLATE/bug_report.zh-CN.md`

以下文档原本就是中文，不需要重复翻译：

- `docs/GAME-GUIDE.md`
- `docs/SESSION-API.md`
- `docs/API-DATA-CONTRACT.md`
- `docs/LOGIC-PROCESSOR-GUIDE.md`
- `docs/MCP-PROTOCOL.md`
- `docs/HARNESS-INTEGRATION.md`
- `docs/PLAYER-PARITY.md`
- `docs/REALITY-CHECK.md`
- `docs/DATA-ACCESS-AUDIT.md`
- `docs/ASSISTANT-DESIGN.md`
- `docs/OPEN-QUESTIONS.md`
- `docs/REMOTE-DATA-PLANE.md`
- `docs/bek-mindustryx-ai-bridge.md`
- `probe-mod/README.md`
- `TASKS.md`

## 验证

- 扫描 30 个 Markdown 文件：相对链接 0 个缺失。
- 扫描当前跟踪文档：无 `mindustryx-ai-bridge`、旧 adapter 未实现、`0.2.x` 等残留。
- 英文文档均有对应中文版本，且顶部提供语言切换；中文 README 反向链接英文版本。
- 文档中的版本号与 `probe-mod/mod.json`、`ProbeMod.VERSION` 一致（0.3.0）。
- 文档中的构建、启动、冒烟和发布命令均指向仓库现有脚本。

## 保留的边界

- `docs/REALITY-CHECK.md`、`docs/ASSISTANT-DESIGN.md`、`docs/DATA-ACCESS-AUDIT.md` 保留原始日期和历史结论；当前行为以 `docs/SESSION-API.md`、`docs/PLAYER-PARITY.md` 和 `docs/API-DATA-CONTRACT.md` 为准。
- `TASKS.md`、`docs/OPEN-QUESTIONS.md` 是内部工作记录，不对外承诺 API。
- `LICENSE`、`NOTICE` 保持英文法律文本，不翻译。
