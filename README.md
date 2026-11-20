# mindustry-ai

目标：做一个 Mindustry × AI 的版本。当前阶段：调研/参考实现拆解。

## 目录

```
mindustry-ai/
├── README.md
├── TASKS.md                          ← 实施清单（M0-M4）
├── docs/
│   ├── bek-mindustryx-ai-bridge.md   ← BEK-Group/MindustryX 的 AI 通道拆解（参考实现）
│   ├── ASSISTANT-DESIGN.md           ← 助手总体设计：身体/附身/权限/团队/验收
│   ├── MCP-PROTOCOL.md               ← MCP 工具、动作生命周期、事件、权限矩阵
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

## MCP 快速开始

```bash
cd mcp-server
npm install
npm run build
npm test        # MockGameAdapter + MCP 工具测试
npm run harness # stdio harness（构建后运行）
../scripts/run-fixed-scenario.sh # 启动 Fortress 固定地图 + 场景断言
LLM_MOCK=1 MINDUSTRY_AI_ADAPTER=mock npm run llm-harness # 无凭证工具循环 dry run
node harness/mock-openai-server.mjs # 另一个终端：本地 mock OpenAI endpoint
MINDUSTRY_AI_ADAPTER=mock LLM_BASE_URL=http://127.0.0.1:18080/v1 npm run llm-harness
# local Ollama OpenAI-compatible endpoint
MINDUSTRY_AI_ADAPTER=probe LLM_BASE_URL=http://127.0.0.1:11434/v1 LLM_MODEL=lfm3:latest npm run llm-harness
# 真实本地模型 + 最终位置验收（需要已启动 Fortress 服务端和 probe）
MINDUSTRY_AI_ADAPTER=probe LLM_BASE_URL=http://127.0.0.1:11434/v1 LLM_MODEL=lfm3:latest LLM_FINAL_CONTEXT=1 LLM_EXPECT_NEAR_X=952 LLM_EXPECT_NEAR_Y=584 LLM_TASK='Call get_context, move to core.x+24 and report.' npm run llm-harness
# 超时验证：本地延迟 mock endpoint + 150ms 超时
MOCK_LLM_PORT=18081 MOCK_LLM_DELAY_MS=1000 node harness/mock-openai-server.mjs &
MINDUSTRY_AI_ADAPTER=mock LLM_BASE_URL=http://127.0.0.1:18081/v1 LLM_REQUEST_TIMEOUT_MS=150 npm run llm-harness
# 重试验证：首次 503，第二次成功
MOCK_LLM_PORT=18082 MOCK_LLM_FAIL_TIMES=1 node harness/mock-openai-server.mjs &
MINDUSTRY_AI_ADAPTER=mock LLM_BASE_URL=http://127.0.0.1:18082/v1 LLM_MAX_RETRIES=1 LLM_RETRY_BACKOFF_MS=10 npm run llm-harness
```

## 备注

- `refs/MindustryX-Ai/` 是本地参考克隆，已加入 `.gitignore`，不随本项目提交。
- 本机 git 全局配置把 github.com 重写到 gh-proxy.com 且挂了 127.0.0.1:7897 代理，
  直连可用。拉 GitHub 时用：
  `git -c http.proxy= -c https.proxy= -c url.https://github.com/.insteadOf= clone ...`
- GitHub PAT 曾以明文出现在会话中，跑完这轮应吊销重发。
