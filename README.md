# mindustry-ai

目标：做一个 Mindustry × AI 的版本。当前阶段：MCP 工具面可用，正在补主流 harness 接入。

## 目录

```
mindustry-ai/
├── README.md
├── TASKS.md                          ← 实施清单（M0-M4）
├── docs/
│   ├── bek-mindustryx-ai-bridge.md   ← BEK-Group/MindustryX 的 AI 通道拆解（参考实现）
│   ├── ASSISTANT-DESIGN.md           ← 助手总体设计：身体/附身/权限/团队/验收
│   ├── MCP-PROTOCOL.md               ← MCP 工具、动作生命周期、事件、权限矩阵
│   ├── HARNESS-INTEGRATION.md        ← Claude Code/Desktop、Codex、OpenCode、Hermes 接入
│   ├── REMOTE-DATA-PLANE.md          ← 远程只读数据面：DatasetRef、HTTP range、客户端代码分析
│   ├── OPEN-QUESTIONS.md             ← 待拍板项与默认建议
│   └── REALITY-CHECK.md              ← v160.8 真实 jar 的 API/启动核对
├── mcp-server/                       ← MCP 工具接口（当前 MockGameAdapter）
├── mindustry_data/                   ← 只读数据面客户端 SDK + smoke tests
├── probe-mod/                        ← 最小真实游戏探针（Java mod + socket + client）
└── refs/
    └── MindustryX-Ai/                ← 参考实现，浅克隆 main @89e3d71 (2026-05-23)
```

## 参考实现速览

`BEK-Group/MindustryX` = MindustryX（承接 Anuken/Mindustry 的 patch 层分支）+ 本地 AI 桥。

- 桥：`src/mindustryX/features/ai/`，7 个文件 ~1762 行，TCP 127.0.0.1:46491，TLV 帧
- 能力：6 个读操作 + 9 个写操作 + mmap 事件环 + 无渲染构建
- 对接：`DeterMination-Wind/Mindustry-MCP`（TypeScript MCP server，把桥包成 LLM 工具）
- 详情见 `docs/bek-mindustryx-ai-bridge.md`

## 状态

- [x] 拉取参考实现（不初始化 submodule 也能读 AI 代码；要编译才需要 `work/` `Arc/`）
- [x] 路线定为：局内 co-op 助手（mod + 本地执行层），不是独立 AI 客户端
- [x] 设计落档：`docs/ASSISTANT-DESIGN.md`、`docs/MCP-PROTOCOL.md`、`docs/REMOTE-DATA-PLANE.md`、`TASKS.md`
- [x] MCP 接口脚手架 + MockGameAdapter（`mcp-server/`）
- [x] MCP server 27 个工具、stdio 入口、Mock/MCP 测试、stdio harness（`npm test` 16/16）
- [x] Probe mod：真实 v160.8 服务端加载、get_context/move_to/build/get_tile 跑通
- [x] ProbeGameAdapter：MCP 27 工具中的 context/capabilities/content/map_summary/get_area/query_area/move/build/attack/mine/follow/withdraw/deposit/configure/command_units/set_stance/stop/possess/release/respawn/deconstruct/repair/cancel/get_action_log 接真实游戏
- [x] 真实动作验证：核心取放、sorter 配置、指挥 dagger、holdPosition stance、附身/释放、sand 挖矿、死亡重生、攻击容器、deconstruct、repair
- [x] `get_events`：真实事件环已接，MCP 能读到 unit/build/damage 事件
- [x] `get_events` 摘要模式：`summary=true` 返回 `byType` 计数 + `ref`，高频事件不占页
- [x] probe 传输层：发现文件、token、`hello` 版本握手；`PROBE_REQUIRE_AUTH=1` 可启用鉴权；`PROBE_REQUIRE_WRITER=1` 启用 writer lease
- [x] 远程只读数据面：probe raw-v1 地图/NDJSON 事件、地图 chunk + Range、事件分页、token TTL、`rotate_data_token`、`mindustry_data` SDK、`get_map_summary`
- [ ] Parquet 事件、revision 淘汰压测、远端 baseUrl 配置
- [ ] 真实 Mindustry mod adapter 生产化（多客户端写互斥已实现 lease，token 轮换已做；重连已做）
- [ ] follow 持续语义、cancel opId 定向取消、事件过滤/合并
- [ ] 助手本地反射控制器（寻路/索敌/建造/撤退）
- [x] 固定地图端到端验收：`Fortress` + `scripts/run-fixed-scenario.sh`，校验上下文/事件增量/移动/多块建造/事件摘要/跟随/附身/释放/指定核心重生/无核心恢复/绕障移动与攻击接近/自动防御/低血撤退/炮塔+传送带供弹防守；真实本地 LLM 固定移动任务已跑通
- [x] 主流 MCP host 接入：`scripts/mindustry-mcp` 包装器 + `scripts/start-game-server.sh` + `docs/HARNESS-INTEGRATION.md`（Claude Code/Desktop、Codex、OpenCode、omp、Hermes）；真实 probe 下 host-smoke 通过（27 tools、move done）
- [x] omp 对话验收：真实 Fortress 中 `omp -p` 读取 27 工具、`get_context` 与 `move_to→done`，助手 `(928,584)→(942.2,584)`
- [ ] 在真实 Claude Code/Codex/OpenCode host UI 中做人工双 client 验收

## MCP 快速开始

```bash
cd mcp-server
npm install
npm run build
npm test        # MockGameAdapter + MCP 工具测试
npm run host-smoke # 通过 scripts/mindustry-mcp 启动的通用 MCP host 冒烟（mock）
npm run harness # stdio harness（构建后运行）
../scripts/run-fixed-scenario.sh # 启动 Fortress 固定地图 + 场景断言
LLM_MOCK=1 MINDUSTRY_AI_ADAPTER=mock npm run llm-harness # 无凭证工具循环 dry run
node harness/mock-openai-server.mjs # 另一个终端：本地 mock OpenAI endpoint
MINDUSTRY_AI_ADAPTER=mock LLM_BASE_URL=http://127.0.0.1:18080/v1 npm run llm-harness
# 真实游戏 MCP host 启动（服务端和 probe 已运行）
../scripts/start-game-server.sh
../scripts/mindustry-mcp --check
MINDUSTRY_AI_ADAPTER=probe npm run host-smoke  # 通过 wrapper 走真实 probe
# omp 对话（仓库自带 .omp/mcp.json）
omp -p --no-session --max-time 120 'Use the mindustry MCP server. get_context summary, move_to core.x+24, poll get_action_result, report final position.'
../scripts/stop-game-server.sh
# 主流 host 配置（Claude Code/Desktop、Codex、OpenCode、Hermes）
cat docs/HARNESS-INTEGRATION.md
```

## 备注

- `refs/MindustryX-Ai/` 是本地参考克隆，已加入 `.gitignore`，不随本项目提交。
- 本机 git 全局配置把 github.com 重写到 gh-proxy.com 且挂了 127.0.0.1:7897 代理，
  直连可用。拉 GitHub 时用：
  `git -c http.proxy= -c https.proxy= -c url.https://github.com/.insteadOf= clone ...`
- GitHub PAT 曾以明文出现在会话中，跑完这轮应吊销重发。
