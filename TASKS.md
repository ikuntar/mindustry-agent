# TASKS

状态：MCP 工具面 / 真实 probe adapter / 固定场景已可用；剩余项见未完成条目
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
- [x] 设计 `docs/SESSION-API.md`：单 mod + 每局 session prompt + 一次性 bootstrap token + LAN HTTP API + 可选 MCP（Phase 2 MVP 已实现）
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
- [x] 选定基线：官方 Mindustry v160.8 + mod；不用 BEK 作为主干（见 `docs/REALITY-CHECK.md`）
- [x] 游戏 mod 暴露本地 socket + 发现文件 + token + 版本握手：`/tmp/mindustry-agent-probe/bridge-info.json`，`hello` 返回 protocol/version，`PROBE_REQUIRE_AUTH=1` 时校验 token
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
- [x] `follow` 的目标消失语义：目标 unit 被移除/失效时 follow 动作 `done` 且 `data.reason=target_gone`，同时清除 `followTarget`；固定场景用 `remove_unit` 验证。持续追远距离上限仍未单独验收。
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
- [ ] `AssistantController`：本地执行层（寻路/建造推进/卡住重试；不默认索敌或撤退）
- [x] `move_to` 基础 BFS 寻路：地面单位绕过 solid tile；Fortress 场景用 5 个 container 做墙，助手到达墙后目标（`1089,588` vs `1084,588`）；follow/attack 的接近移动共用该路径，attack 绕障接近已在固定场景验证
- [x] 基础自动索敌/开火：已移除默认自动索敌；`attack` 是显式动作。旧的自动瞄准实测仅作历史记录。
- [x] 低血撤退：已移除；助手默认无低血自动撤退/空闲自动索敌，显式动作才移动/攻击/跟随；死亡后从核心自动重生（与玩家一致）。
- [x] `attack.unitId` 独立伤害：固定场景在核心附近生成 idle dagger 后按 `unitId` 攻击，health `150→141`（4 波后的低血助手路径不作为验收）
- [x] 动作超时：`move_to`/`attack`/`follow`/`deconstruct`/`repair`/`mine` 支持 `timeoutTicks`（0–1200），超时后 op `failed`、`data.code=timeout`，控制器目标清空；固定场景分别实测
- [x] `mine` 超时与正常完成：固定场景在助手附近放 `ore-copper`，`timeoutTicks=1` 返回 `failed/timeout`；无超时挖矿 `done` 并获得 1 copper
- [x] 主流 harness 接入：`scripts/mindustry-mcp` 包装器（默认 probe）+ `harness/host-smoke.ts` + `scripts/start-game-server.sh`；真实 probe 下 host-smoke `{"ok":true,"tools":27,"adapter":"probe","moveStatus":"done"}`，`docs/HARNESS-INTEGRATION.md` 覆盖 Claude Code/Desktop、Codex、OpenCode、omp、Hermes
- [x] omp 游戏会话与代码会话隔离：launcher `scripts/omp-mindustry` 把 `.omp/mcp.json` 放在 `~/.mindustry-omp`，仓库 `.omp/` 不提交；真实 probe 冒烟通过
- [x] omp 对话验收：真实 Fortress 中 `omp -p` 读取 27 工具、`get_context` 与 `move_to→done`，助手 `(928,584)→(942.2,584)`
- [x] Ground Zero campaign-like 实测：专用服载入内嵌 sector 地图、设置 sector/winWave/资源；omp 连续观察 35 次到 `wave=10`，核心存活，但 `won=false`，专用服自动切图
- [ ] 真正的战役第一关正式结算（需要客户端 host campaign 或 probe mod 补 objectives/sector 结算）
- [ ] 在真实 Claude Code/Codex/OpenCode host UI 中连真实游戏做人工双 client 验收（omp 已实测）
- [ ] 本地执行层：建造推进、卡住重试、显式撤退动作的回归
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

- [x] `get_context` 摘要 + 局部窗口（radius，tile）+ 团队取 assistant.team + `since` 事件增量摘要 + `includeEnemies` 的 `threats`（最多 16 个）+ `maxUnits`（1–64，默认 20，返回 `unitsTruncated`）+ `maxBytes`（有界裁剪，返回 `bytesTruncated`）+ 粗略 `bytes` + `won/campaign/sector/winWave`
- [ ] token 预算、detail/radius/since 的完整分页/resource
- [x] `configure` 端到端：固定场景建 sorter 并配置 `copper`，`get_tile.config="copper"`；建 switch 并配置 `true/false`，回读 `"true"/"false"`；同时覆盖 sorter/unloader/switch/message/processor schema
- [ ] 可指挥单位 + stance + 命令队列
- [ ] 玩家上下文：当前选择/镜头/当前工具（如果后续做对话/指令）
- [ ] 事件合并与 dropped 检测

## M3：Harness / LLM 测试

- [x] 固定地图场景：`Fortress` 启动、seed 场景、场景断言通过（上下文/事件增量/移动/多块建造/事件摘要/附身/释放/指定核心重生/无核心恢复）
- [x] harness：MCP stdio 客户端，跑固定动作序列并断言（`scripts/run-fixed-scenario.sh`）
- [x] harness：4 个启用真实 AI 的敌方 dagger 连续进攻，炮塔均命中（150→141），炮塔弹药实际消耗到 0；敌人会还击
- [x] harness：4 波 survival 后核心存活（health `920`）、助手存活（health `20`），说明波次真实伤害到核心且防守未崩溃；仍有远处敌人未解决
- [x] harness：核心连续受击：3+2 个启用真实 AI 的敌方 dagger 两波进攻，核心 health `1100→1082→128` 仍存活
- [x] harness：4 波官方 survival 连续触发：核心存活（health `920`）、助手存活；远处敌人未全部清理，作为已知限制
- [x] harness：两段 conveyor 链路：上游 `(111,75)` 指向 feeder，deposit 1 copper 后炮塔 `ammoTotal 10→12`；长距离/多拐弯仍未验证
- [ ] harness：完整清理 survival 敌人、长距离/多拐弯传送带
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

- [x] 本地 socket 鉴权、localhost only、token（probe 绑定 127.0.0.1；`PROBE_REQUIRE_AUTH=1` 时校验 discovery token；固定场景已在该模式下全链路通过）
- [x] 动作 allowlist：`MCP_ALLOWED_TOOLS`/`MCP_DENIED_TOOLS` 在注册阶段过滤工具；`MCP_ALLOWED_TOOLS=get_context` 实测只暴露 1 个工具，`move_to` 调用被拒绝
- [x] 写动作速率限制：`MCP_WRITE_RATE_LIMIT`（每秒）；limit=1 时首个写成功，第二个返回 `rate_limited`（retryable=true）
- [ ] API key 只在伴生进程；日志脱敏
- [x] mod 内 HTTP session API MVP：`/session` 一次性 bootstrap、`/context`、`/actions`、`/actions/{opId}`、`/guide`、LAN 绑定、Bearer session token
- [x] session API 冒烟脚本 `scripts/session-api-smoke.mjs`
- [x] `/events/wait` 长轮询：立即返回已有事件、超时返回 `timedOut=true`，事件到达唤醒
- [x] `game_pause` / `game_resume` 事件；`context.paused` 常驻
- [x] session prompt/guide 暂停规则：除 `resume` 外 paused 时写动作失败；`pause`/`resume` 受 `Rules.pauseDisabled` 约束
- [x] 弹窗 session prompt 代码（`WorldLoadEvent` + `BaseDialog` + 剪贴板；编译通过，客户端 UI 未实测）
- [x] 桌面客户端 v160.8 加载 mod 并启动 `/session`、`/data`、`/mcp`（WSLg 下 GL 窗口截图不可用；Xvfb 可截主菜单但 XTest 点击未进入地图）
- [x] 弹窗 UI 视觉实测：Xvfb 自动加载 Fortress，截图显示 endpoint/token/6 步说明和 Copy/Close 按钮
- [ ] `Copy session prompt` 剪贴板内容断言
- [ ] 桌面客户端/真机人工点击验收
- [x] 35 个核心工具的显式 schema/错误码表：`GET /tools` 返回 JSON Schema；所有公开坐标/半径统一为 tile
- [x] 0.4.0 坐标契约：`move_to`/`attack`/`query_area`/`get_area`/`get_spawns`/context/entity 全部 tile；smoke 和 MCP HTTP smoke 通过
- [x] issue #25：guide 引用的 `get_tile/query_area/deconstruct/repair/set_stance/release/follow` 已纳入 session `/tools`；`wavetime/waveTimer` 已加入 context
- [x] issue #26：活跃 op 达到 `MAX_OPS=256` 时返回 `op_capacity`（HTTP 503），不再无上限增长
- [x] issue #27：`GET /` 端点索引；build topic 修正；SESSION-API 补 drop_id 编码
- [x] issue #28：context 暴露 mission/objectives/tutorial/rules；新增 wave_start/wave_end；guide 补教学阶段处理
- [x] issue #29：research 动作 + content 研究成本/状态 + rules.researched
- [x] issue #30：objectives 全量/type/progress/parents/flags + objectiveFlags
- [x] issue #31：/health、events paused 直读、query_area 上限/截断
- [x] issue #32：campaign 占领语义 `captured`/`sector.wasCaptured`；API pause/resume 事件
- [x] issue #33：deconstruct `allowPartial`/`skipMissing` 与逐目标结果
- [x] issue #35：build_plan 失败 `opId`/坐标/逐块 best-effort 语义
- [x] issue #36：get_tile/get_area 地形与 canPlace；buildRange/覆盖回报
- [x] issue #37：config 结构化；context.power；机器运行态字段
- [x] issue #38：bootstrap 只读 guide/tools；prompt/guide 顺序与 docs 404
- [x] 数据访问审计：见 `docs/DATA-ACCESS-AUDIT.md`；移除 TimerObjective 反射，power 按队伍过滤，guide 增加 bytes/hash；全图可见性、raw debug 面留待拍板
- [x] 迷雾读取限制：`get_tile/get_area/query_area/get_unit/threats/map/events` 按助手队伍过滤；Fortress fog 实测通过
- [x] API 数据契约：`docs/API-DATA-CONTRACT.md` + `/guide` 第 16 节（实体结构/枚举/config/错误码）
- [x] 冷启动规划测试（2026-11-24）：无限流派 600s 超时（45 次调用，过度解析地图二进制）；收窄流 83.7s 完成，判定 `/guide` 足够但只到“够用”级，记录 wavetime/objective/供弹/建造时间/电力连线等缺口
- [x] 默认动作策略：移除低血自动撤退和空闲自动索敌/开火；显式动作才移动/攻击/跟随；死亡后自动从核心重生，与玩家一致
- [ ] 按冷启动反馈补 guide：wavetime 单位已补、actions 顶层字段已补；objective 本地化失败 fallback、炮塔供弹动作示例继续补
- [x] 长周期科技树测试（2026-11-24）：无上下文 agent 仅用 API，先判定 insufficient（缺 block inputs/配方、物品无 tech node、钻机/泵无产出映射、液体链缺失）；已补 `parameters.inputs`（含液体）、`liquidOutputs`、drill/pump 元数据、`get_tech_tree.depth`、`get_tile.dropHardness`。最终复测（289s）判定 sufficient=true（有保留）：地图采样下可从 4 种原矿 BFS 到 Serpulo 22 个物品中的 16 个，Erekir 6 个不可达；sector 链 groundZero→frozenForest→crateredBattleground 可排序研究阶段。
- [x] 核心数据库投影：items `hardness/flammability/radioactivity/charge/explosiveness`、liquids `heatCapacity/viscosity/...`、turret `ammoTypes/targetAir/targetGround`、block `role/functional`、Separator `chance/weight`、`get_tech_tree` flat/offset/nextOffset/planet/sector；`session-api-smoke` 断言已补
- [x] Issue #34/#37/#38：get_area cursor、wave_start enemies、withdraw/deposit 文档、query_area 默认说明；power `freeCapacity`/总 capacity；`/docs/{name}` 路由；smoke 通过
- [ ] 科技树跨区域/液体索引：为 planner 补跨 sector 资源可达性提示和 liquid producer 索引；跨区物流（launch-pad cargo）按用户决定暂缓；最终复测已能覆盖同一区域，多输出概率/item hardness 已补
- [x] 科技树数据补充：ore 方块通过 `drillSpeeds[]` 暴露 floor→item/hardness/速度；item hardness 与 Separator chance/weight 已补；`drillSpeeds.presentInWorld` 区分当前地图是否出现
- [ ] 放置/运行时关系：ore/liquid floor 的静态 drop 映射、电力/传送带拓扑、payload 接受关系仍是运行时或未结构化字段
- [x] Logic sensor 对齐（实体层）：`get_unit` 返回 `entity+unit`、`get_tile` 返回 `entity+building`、`query_area detail:"full"`；字段走 `Senseable.sense/LAccess`，unsupported 省略，不暴露 `@client*`/links/ipt/settable
- [x] Logic 全局量（常用）：context 增加 `time/second/minute/waveSeconds/server/client/contentCounts` 和 `logic{...}` 别名；剩余 `@thisx/@thisy/@links/@ipt` 仅在控制逻辑处理器时需要
- [x] Logic processor 指南：`docs/LOGIC-PROCESSOR-GUIDE.md`，含全局变量/sensor/control/radar/ucontrol/memory/display/特权指令/API 名字映射；打包到 `/docs/LOGIC-PROCESSOR-GUIDE.md`
- [x] 敌方固定出生点：`get_spawns` 读取 `WaveSpawner.getSpawns()`，返回 tile/world 坐标、waveTeam、`dropZoneRadius`/`dropZoneRadiusTiles`、`enemyCoreBuildRadius`、`polygonCoreProtection`、show/hideSpawns 与 fog 可见性；`get_tile.spawnZone.inside` 标记出生/空投区；session smoke 验证字段
- [x] Release prep（0.3.0）：默认 session bind 改为 loopback；测试辅助 op 默认关闭；增加 GPL-3.0、SECURITY、CI、`fetch-mindustry.sh`、`release.sh`、README 重写与发布校验
- [x] 游戏内设置：Settings -> Mindustry Agent / session 弹窗 Settings；端口+LAN 实时 rebind、刷新 bootstrap token、编辑/重置/复制 session prompt
- [ ] 彻底去反射：UnitType 构造期 public 字段克隆是否改为显式复制
- [x] 正式构建默认关闭 raw debug op（give/spawn_enemy/set_floor 等）；`PROBE_ENABLE_DEBUG_OPS=1` 仅用于测试
- [x] issue #34 余项：get_area cursor、wave_start enemies、withdraw/deposit 文档、query_area 默认说明已完成
- [x] Gitea #39/#40：pause get_area、configure item 形状与未知内容 not_found 已修复并回归
- [x] Gitea #41-#47：content id/计数/未知 type、manifest block 映射、guide HEAD/ETag/topic、build_plan 文档、文档一致性 CI 已处理
- [x] session prompt 先给出 `GET /tools`，再给动作示例
- [x] `get_action_result` 带 `paused`；超时失败 `data.code=timeout` 在当前 HEAD 复验通过
- [x] `/data` `If-None-Match` 返回 304；dataToken TTL/轮换写入 prompt
- [x] session/context 带 `version`，用于识别旧 jar
- [x] 暂停硬门控：`/actions` 写 op 返回 `game_paused`，只读 op 放行；暂停期间不自动重生
- [x] session `/actions` 按 35 个 `/tools` 名字白名单；内部 debug op 只能走本地 probe token，`get_capabilities` 实测 403
- [x] session `build_plan` 展开为 `build`/`deconstruct`，不再返回 Unknown op
- [x] world reload：保留 sessionToken；bootstrap 每次 world load 无条件轮换，旧 bootstrap 失效；新 token 写入 discovery/游戏内 prompt；启动时在端口解析后重写 discovery
- [x] build/build_plan 不再把“已入队”当“已落地”：campaign 未解锁返回 `block_locked`，build op 运行到目标 tile 出现；计划被引擎丢弃 `build_dropped`；Ground Zero fixture 显式 unlock
- [x] 动作状态一致性审计：`deconstruct`/`repair`/`mine` 不再假成功；`configure` 回读；`stop`/`cancel` 清理全部目标；助手换体/死亡旧 op 失败 `assistant_gone`；`command_units` 目标不存在失败
- [x] HTTP 会话入口加固：`/context` query 白名单、`/mcp` tools/call 白名单、`build_plan` MCP 路径；畸形请求 400、socket 关闭、accept 异常继续、连接上限/header 上限、chunked 拒绝
- [x] 命令超时取消：未取到命令 503 `not_executed` 且不执行；已开始 504 `execution_unknown`；`eventSeq`/`mapRevision` volatile，Host 不回显
- [x] 自定义 `ai.probe.http` ServerSocket HTTP server：移除 `com.sun.net.httpserver`；桌面 `/session`、`/data`、`/mcp` 回归通过
- [x] Android 决策：默认 PC host + 手机 client；已生成 JVM+dex 通用 mod jar
- [x] 通用 mod jar：`probe-mod/build-universal.sh` 生成同时含 `classes/` 与 `classes.dex` 的 jar；桌面回归通过
- [ ] 真机 Android 安装/phone-hosted 验收：需要 Android 设备或模拟器确认 mod 加载、session token、LAN 访问
- [x] session server `/data`：地图 raw/chunk/Range、manifest、事件 NDJSON；data token 可读，session token 不越权；旧 `46501` 数据面保留
- [x] `/data` data token 轮换：`POST /session/data-token`，旧 token 立即 401
- [ ] `/data` Parquet 事件
- [x] 可选 MCP Streamable HTTP `/mcp` 最小子集：initialize/tools/list/tools/call/ping；35 个核心工具
- [x] MCP SDK 冒烟：`mcp-server/harness/mcp-http-smoke.ts`，官方 client connect/list/call/resources/prompts 通过
- [x] MCP `resources/list` / `resources/read`：`mindustry://guide`
- [x] `/guide` 改为完整游戏知识指南
- [x] 助手唯一性：context 暴露 assistantBodies；respawn while possessing 恢复借体；清理遗留 ProbeController 身体
- [x] save/load 助手去重：spawn 写持久 Unit.flag；world load 先删除同 flag 旧 home，避免每次读档多 alpha
- [x] `docs/GAME-GUIDE.md` 打进 jar（约 6K 字符）：规则/资源/生产/电力/防御/单位/战役/AI 边界；MCP resource 与 session `/guide` 共用；session prompt 要求先读 `/guide`
- [x] MCP `prompts/list` / `prompts/get`：`play-session`、`defend-core`、`mine-and-deposit`
- [ ] MCP GET SSE、完整兼容性矩阵
- [ ] 存档/读档记忆处理
- [ ] 跨区块/跨地图重生
- [ ] 本地主机/专用服/其他玩家可见性
- [x] 重连、版本握手
- [x] 动作幂等：MCP 与 session `/actions` 都接受可选 `idempotencyKey`；按 session token 隔离，LRU 256，重复 key 返回同一结果/opId

- [x] 会话补全：`/content`、`/capabilities`、`/cancel`、`/stop`；`get_action_result.waitMs` 轮询；`build_plan` required 为空，支持 deconstruct-only；cancel/stop 进入工具表
- [x] 数据面可读性：`get_area` 行优先 + `coverage.next`；context 带 `resourceCapacity/resourcesFull` 和 core items；map `drop_id=item.id+1` 并附 `items/dropIds`
- [x] 资源/事件/HTTP：`pruneOps` 不再淘汰 running；304 带 ETag/Cache-Control，304 reason 和 HEAD 无 body；`/events/wait` 独立 8 连接配额，超限 429

## 玩家能力对齐（本轮已完成）

- [x] 显式 `respawn(coreId)` 进入 session 工具面；按核心类型（alpha/beta/gamma）生成对应的非 playerControllable 助手类型（实测 beta 克隆）
- [x] 建筑控制：`ControlBlock`/`BlockUnitc` 独立动作；`control_building`/`release_building`，Fortress `duo` 实测
- [x] 单位附身 `possess` 与 `release` 进入正常 session 工具面；借体继续由助手动作控制
- [x] `command_units`：命令、目标、队列、stance 进入 session；按队友式 last-writer-wins，不做硬锁
- [x] 工厂方案读取/配置（不是队列）；`get_config_schema` 返回 `currentPlan` 可选索引，`configure` 回读
- [x] 特殊单位 abilities / boost / payload 拾取投放；passive abilities 由单位类型驱动，payload 由 `Payloadc` 能力驱动
- [x] 科技树图与规则：`get_tech_tree` parent/children/成本/objectives/researched/blockedReason；`research` 检查父节点/目标
- [x] 主动 `pause`/`resume` 进入 session 工具面，受 `Rules.pauseDisabled` 约束；`resume` 是暂停时唯一放行的写动作
- [x] 游戏速度/存档读档：确认不做世界动作；不新增 God 接口
- [x] 液体只走建筑/网络，未新增 withdraw_liquid/deposit_liquid
- [x] 地面掉落物概念已移除；蓝图 UI/跨区域发射保持不做

## 未决项

见 `docs/OPEN-QUESTIONS.md`。未落 TASKS 的设计项视为未收尾。

- [x] 自定义 `mindustry-agent-ai-alpha`/`ai-beta`/`ai-gamma` 类型：按核心等级复制能力，`playerControllable=false`，避免玩家死亡时原版自动选中助手导致 ValidateException
