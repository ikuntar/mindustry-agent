# TASKS

状态：M0 完成 / M1 设计阶段
更新：2026-11-18

## M0：MCP 工具接口 + Mock Adapter

- [x] `mcp-server/` 工程骨架（package.json、tsconfig）
- [x] 共享类型：上下文、能力、内容、事件、动作结果、BuildPlan、Command
- [x] `MockGameAdapter`：模拟世界、动作队列、事件、建造/取物/配置/指挥/附身/释放/重生
- [x] `server.ts`：注册全部读/写 MCP 工具
- [x] `index.ts`：stdio 入口、SIGINT 清理
- [x] `test/mock.test.ts`：动作与状态机测试
- [x] `test/mcp.test.ts`：InMemoryTransport MCP 工具测试
- [x] `harness/smoke.ts`：stdio 连接、列工具、读上下文、最小动作序列
- [x] `docs/ASSISTANT-DESIGN.md`
- [x] `docs/MCP-PROTOCOL.md`
- [x] `docs/REMOTE-DATA-PLANE.md`（方案 A：远程只读数据面 + 客户端代码）
- [x] `README.md` 更新目录与运行方式
- [x] `mcp-server/README.md`

## M1：真实 Mindustry mod adapter

- [x] Probe mod：v160.8 服务端加载、`get_context`/`get_tile`/`get_capabilities`/`query_area`/`move_to`/`build` 验证
- [x] Probe mod 发现：`spawnedByCore=true` 的非 Player 会被每帧 despawn；助手用 `isHome`
- [x] Probe 建造完成：`BuildPlan` + `BuilderComp`，MCP `query_area` 读回 conveyor
- [x] `ProbeGameAdapter`：MCP 的 `get_context`/`get_capabilities`/`query_area`/`move_to`/`build`/`attack`/`mine`/`follow`/`withdraw`/`deposit`/`configure`/`command_units`/`set_stance`/`stop`/`possess`/`release`/`respawn`/`deconstruct`/`repair`/`cancel` 接真实游戏
- [x] 真实物流/配置/指挥验证：核心取放 5 copper、sorter 配置、dagger `move` 命令、`holdPosition` stance、`stop`
- [x] `query_area` 建筑读取改为按世界 tile 扫描；`Groups.build.getByID` 在服务端不可用
- [x] attack：支持 `unitId` / `buildingId` / `x,y` 三种目标；敌方 container 实测 `targetHealth 220→0`，position 目标实测 done/inRange=true；unit 目标的独立伤害验收仍受测试单位消失影响
- [x] mine：probe op + adapter 已接；在挖矿可达的 sand tile 上实测 `get_action_result` done，助手获得 sand 1
- [x] possess / release：同队 dagger 附身、原 home body despawn、release 后在核心生成新 alpha；`isHome/possessing` 读回正确
- [x] respawn：kill 后 `assistant.dead=true`，`respawn` 在核心生成新 alpha（id 变化、health 150）
- [x] Probe/真实 adapter 动作：deconstruct/repair/cancel/follow 均有入口和实测；follow 语义仍简化
- [x] 真实 adapter 事件日志：事件环已接，见 `get_events`
- [ ] 选定基线：官方 Mindustry v160.8 + mod；不用 BEK 作为主干（见 `docs/REALITY-CHECK.md`）
- [x] 游戏 mod 暴露本地 socket + 发现文件 + token + 版本握手：`/tmp/mindustry-ai-probe/bridge-info.json`，`hello` 返回 protocol/version，`PROBE_REQUIRE_AUTH=1` 时校验 token
- [x] 游戏线程动作队列 + 每帧预算：socket 只入队，游戏 `update` 每帧最多处理 50 条；LLM 调用不在游戏线程
- [x] 心跳与连接重试：probe `ping`；adapter 每 `PROBE_HEARTBEAT_MS`（默认 15s）发心跳，连接失败重试 3 次；`PROBE_HEARTBEAT_MS=200` 固定场景通过
- [x] 运行中服务器重启重连：`ProbeGameAdapter` 在 fake probe 崩溃并同端口重启后自动重连并读到新 `map`；单测 16/16
- [x] 多客户端写互斥：probe writer lease（`claim_writer`/`renew_writer`/`release_writer`），`PROBE_REQUIRE_WRITER=1` 时写操作必须带有效 `writerToken`；第二客户端 claim 返回 `writer_held`，无 token 写入返回 `writer_required`；adapter 握手后自动 claim，heartbeat 续期，`writer-harness` 在强制模式下 `move_to=done`；1s TTL 过期后可重新 claim
- [x] token 轮换：数据面 `rotate_data_token`；旧 token 401、新 token 200
- [x] `get_context` / `get_capabilities` / `get_content` / `query_area` 真实数据；`get_content` 从 probe 读取 70 units 及真实 blocks/items/liquids，并支持 `query` 名称过滤和 `limit`（最大 500）
- [x] `build_plan`：单块和多块 placement 均已实测；Fortress 场景一次提交 2 个 conveyor，query_area 两个 tile 都出现
- [x] `deconstruct` / `repair`：probe 已实现；deconstruct 在 MCP 侧实测建筑消失，repair 在 probe 侧实测 25→45
- [x] `withdraw` / `deposit`：核心取放 5 copper 已验证
- [x] `configure`：sorter 配置已验证
- [x] `command_units` / `set_stance`：dagger move 与 holdPosition 已验证
- [x] `possess` / `release` / `respawn`：基本状态机已验证
- [x] `follow`：MCP follow 后助手位置变化；固定场景实测 ally 移动后助手追到 30.38px 内并 `cancel`；目标死亡语义仍简化
- [ ] `follow` 的目标消失/复杂避障语义、持续追远距离上限
- [x] 定向 `cancel`：固定场景 `move_to` 后按 opId 取消，返回 `cancelled=1`，`get_action_result` 状态变为 `cancelled`
- [x] `get_events`：probe 事件环（unit_destroy / unit_create / block_destroy / block_build_end / build_damage / unit_damage），`since/limit/next/dropped`、`summary` 和 `types` 已接；MCP 实测 `byType` 摘要
- [ ] 事件类型过滤压测、核心事件细分、更多语义事件
- [x] 远程数据面：probe 内存 map revision、`/data/manifest/current`、GET/HEAD + token、raw-v1 地图二进制、地图 chunk、Range、事件分页；事件为 NDJSON
- [x] 数据 token TTL：discovery 发布 `dataTokenExpires`，过期返回 410；事件分页带 `X-Next-Cursor`/`X-Has-More`
- [x] 数据 token 轮换：probe `rotate_data_token` 更新 discovery；固定场景旧 token 401、新 token 200
- [x] 客户端 SDK：`mindustry_data.open_dataset(ref)`、本地 token 解析、raw-v1 解码、事件读取；`mindustry_data/demo.py` 可运行
- [x] `get_map_summary`：MCP 返回 `DatasetRef`/schema，不返回 tile；MCP harness 实测
- [ ] Parquet 事件、revision/TTL 压测、远端 baseUrl 配置
- [x] 无代码 host 的 `get_area` 有界查询 fallback：半径上限 24 tiles、maxTiles 512；固定场景读回 25 个 tile，并验证 `maxTiles=10` 时 `truncated=true`
- [x] `get_events` 分页：非 summary `limit=1` 返回 1 条，`next` 从 1 推进到 2；`summary=true` 时只聚合、不返回 events
- [x] `get_events` 类型过滤：固定场景 `summary=true, types=['unit_destroy','build_damage']` 返回 `byType` 仅含这两类
- [x] 数据面速率限制：`PROBE_DATA_RATE_LIMIT_PER_SEC`（默认 120），超限返回 429 + `Retry-After: 1`；固定场景用 limit=10，实测 9 个 200、2 个 429
- [x] 数据面鉴权/TTL/路径白名单：token、410 过期、GET/HEAD only
- [x] `get_context.eventsSince` 返回真实事件序号
- [ ] `AssistantController`：本地反射层（寻路/索敌/开火/建造推进/撤退）
- [x] `move_to` 基础 BFS 寻路：地面单位绕过 solid tile；Fortress 场景用 5 个 container 做墙，助手到达墙后目标（`1089,588` vs `1084,588`）；follow/attack 的接近移动共用该路径，attack 绕障接近已在固定场景验证
- [x] 基础自动索敌/开火：空闲时扫描武器射程内最近敌军，设置 aim/isShooting；固定场景 `spawn_enemy ai=true` 后轮询 2s 内 health `150→141`，敌人也会还击
- [x] 低血撤退：health < 30% 且无当前动作时优先退到远离敌人的同队核心，否则向远离最近敌军 120px 的方向移动；固定场景 core 距离 `209→62`，敌方距离 `63→84`
- [x] `attack.unitId` 独立伤害：固定场景在核心附近生成 idle dagger 后按 `unitId` 攻击，health `150→141`（4 波后的低血助手路径不作为验收）
- [x] 动作超时：`move_to` 支持 `timeoutTicks`（0–1200），超时后 op `failed`、`data.code=timeout`，控制器目标清空；固定场景 `timeoutTicks=1` 实测
- [ ] 本地反射控制器：建造推进、卡住重试、撤退完成后的回归
- [x] 助手身体从核心生成；`spawnedByCore=false` + `isHome` 跟踪（v160.8 非 Player 会 despawn）
- [x] 死亡/重生：`Player.deathDelay`、任意核心的显式 `respawn {coreId}`、无核心失败与核心恢复后自动重生均已实测；核心被拆/重建路径已覆盖
- [x] 多核心 fixture：probe 调试 op `spawn_ally_core` 创建同队核心；Fortress 场景已验证从第二个核心重生（home body id 变化、坐标在第二个核心附近）
- [x] 借体解控基本验证：`release` 后目标 dagger 控制器恢复为 `CommandAI`（非 ProbeController），单位未消失
- [ ] 借体解控后的命令恢复/复杂 AI 状态
- [ ] 人口绕过只限重生/默认身体
- [ ] 团队规则：全程 `assistant.team`；`team.rules()` / `state.rules`
- [x] 附身基本校验：同队（敌方单位 `wrong_team`）、非助手自己身体（`bad_target`）、非 `playerControllable`（`not_possessable`）；玩家身体仍待补
- [x] `possessionAllowed` 规则：规则关闭时 `possess` 返回 `possession_disabled`
- [x] 助手身体不可附身：非 `AIController` 控制器 + 显式拒绝
- [x] 停机开关：probe `set_writes_enabled(enabled=false)` 时 `move_to` 返回 `writes_disabled/Probe writes are disabled`，读操作仍可用
- [x] 动作日志：probe `get_action_log` 返回活跃/历史 op 的 `opId`、kind、status、progress、data、createdTick；ops 上限 256，优先淘汰已结束动作
- [x] 结构化失败原因：MCP error 带 `category`（input/rule/resource/world/transport/internal）和 `retryable`；未知物品、越界、资源不足、同队攻击等已分类

## M2：观测与上下文

- [x] `get_context` 摘要 + 局部窗口（radius，tile）+ 团队取 assistant.team + `since` 事件增量摘要 + `includeEnemies` 的 `threats`（最多 16 个）+ `maxUnits`（1–64，默认 20，返回 `unitsTruncated`）+ `maxBytes`（有界裁剪，返回 `bytesTruncated`）+ 粗略 `bytes`
- [ ] token 预算、detail/radius/since 的完整分页/resource
- [ ] 可配置方块 schema（sorter/unloader/processor/message/switch/turret 等）
- [ ] 可指挥单位 + stance + 命令队列
- [ ] 玩家上下文：当前选择/镜头/当前工具（如果后续做对话/指令）
- [ ] 事件合并与 dropped 检测

## M3：Harness / LLM 测试

- [x] 固定地图场景：`Fortress` 启动、seed 场景、场景断言通过（上下文/事件增量/移动/多块建造/事件摘要/附身/释放/指定核心重生/无核心恢复）
- [x] harness：MCP stdio 客户端，跑固定动作序列并断言（`scripts/run-fixed-scenario.sh`）
- [x] harness：4 个启用真实 AI 的敌方 dagger 连续进攻，炮塔均命中（150→141），炮塔弹药实际消耗到 0；敌人会还击
- [x] harness：4 波 survival 后核心存活（health `920`）、助手存活（health `20`），说明波次真实伤害到核心且防守未崩溃；仍有远处敌人未解决
- [x] harness：核心连续受击：3+2 个启用真实 AI 的敌方 dagger 两波进攻，核心 health `1100→1082→128` 仍存活
- [ ] harness：完整 survival 多波防守、长线铺带
- [x] LLM harness：OpenAI-compatible `/chat/completions` 工具循环 + `LLM_MOCK=1` 本地 planner；mock 运行 `get_context` 成功，记录 toolCalls/token/latency
- [x] LLM harness 多步 mock：`LLM_TASK` 含 withdraw/deposit 时 mock planner 依次调用 context/withdraw/deposit；`LLM_REQUIRE_TOOLS` 验收通过
- [x] LLM harness 真实多步任务：`qwen3.5:4b` + `LLM_TOOL_FILTER=get_context,withdraw,deposit` 完成 `get_context → withdraw → deposit`，toolCalls=3，最终报告成功
- [x] LLM harness HTTP 路径：`harness/mock-openai-server.mjs` 本地 mock endpoint 实测 `mock=false`、27 tools、1 次工具调用、24/12 tokens
- [x] LLM harness 真实本地模型：Ollama `lfm3:latest` 经 `/v1` 在 mock adapter 和真实 Fortress probe 上都调用 `get_context`；真实 probe 27 tools、6237/426 tokens、2.4s
- [x] LLM 固定动作任务：真实 Fortress 上 `get_context` → `move_to(952,584)` → `get_action_result` 返回 done，最终 assistant `x=944.95`；toolLog 记录参数
- [x] LLM 自算目标 + 验收：模型从 context 计算 `core.x + 24` 并移动；`LLM_EXPECT_NEAR_X/Y` 检查最终位置 `944.92,584` 通过（模型未主动调用 `get_action_result`，验收直接用最终 context）
- [ ] LLM harness：接外部供应商 endpoint 并跑固定动作任务
- [ ] 指标：任务成功率、动作失败率、响应延迟、token/分钟、误伤玩家资产、助手死亡（harness 已记录基础计数）
- [x] 失败注入：固定场景验证未知物品 `withdraw`、附身自己 `possess`、不存在建筑 `deposit`、越界 `mine`/`move_to`/`build_plan`、攻击同队单位都返回明确错误
- [x] 失败注入：LLM 超时返回明确 `LLM request timed out after Nms` 并以非零退出
- [x] LLM 重试：503 首次失败后重试成功（`llmRetries=1`）；重试耗尽时以 `LLM request failed: 503 ...` 退出 1
- [x] 失败注入：资源不足 `build_plan` 返回 `insufficient_resources` 和缺失物品数量
- [ ] 多步 LLM 任务、完整 N 波防守、长线铺带

## M4：运行时/安全/多人

- [ ] 本地 socket 鉴权、localhost only、token
- [x] 动作 allowlist：`MCP_ALLOWED_TOOLS`/`MCP_DENIED_TOOLS` 在注册阶段过滤工具；`MCP_ALLOWED_TOOLS=get_context` 实测只暴露 1 个工具，`move_to` 调用被拒绝
- [x] 写动作速率限制：`MCP_WRITE_RATE_LIMIT`（每秒）；limit=1 时首个写成功，第二个返回 `rate_limited`（retryable=true）
- [ ] API key 只在伴生进程；日志脱敏
- [ ] 存档/读档记忆处理
- [ ] 跨区块/跨地图重生
- [ ] 本地主机/专用服/其他玩家可见性
- [ ] 重连、版本握手
- [x] 动作幂等：MCP 工具接受可选 `idempotencyKey`；成功结果在进程内缓存（最多 256 个），重复 key 返回同一 `opId`，固定场景实测两次 `move_to` 返回同一动作

## 未决项

见 `docs/OPEN-QUESTIONS.md`。未落 TASKS 的设计项视为未收尾。
