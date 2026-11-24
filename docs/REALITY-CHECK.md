# v160.8 现实核对

日期：2026-11-19
目标：验证“官方 Mindustry + 自己的 mod”这条路在真实游戏 jar 上成立，而不是只在 MockGameAdapter 里成立。

## 下载与运行环境

- 版本：官方 `Anuken/Mindustry` v160.8（2026-11-18 发布）
- 产物：`refs/mindustry-v160.8/server-release.jar`（19 MB，仅服务端；不提交）
- Java：OpenJDK 17.0.21
- 启动：`java -jar server-release.jar` 可用；`host` 可加载随机默认地图
- 控制台 `js` 可用，能访问 `Vars`：

```
Map{file='maps/default/caldera.msav'}
worldWidth = 256
defaultTeam = sharded
```

## API 签名核对（javap）

以下和设计假设一致：

- `mindustry.world.Build`
  - `beginPlace(Unit, Block, Team, int x, int y, int rotation, Object config)`
  - `validPlace(Block, Team, int, int, int[, boolean[, boolean]])`
  - `beginBreak(Unit, Team, int, int)`
  - `validBreak(Team, int, int)`
- `mindustry.entities.units.UnitController`
  - `unit(Unit)`、`unit()`、`updateUnit()`、`removed(Unit)` 等，可直接实现自定义控制器。
- `mindustry.gen.Unitc`
  - `isAI()`、`isPlayer()`、`controller()` / `controller(UnitController)`、`resetController()`、`spawnedByCore()` / `spawnedByCore(boolean)`、`playerControllable()`。
- `mindustry.world.blocks.storage.CoreBlock`
  - `allowSpawn`、`unitType`；`CoreBuild.requestSpawn(Player)`。
- `mindustry.input.InputHandler`
  - `unitControl(Player, Unit)`、`requestItem(Player, Building, Item, int)`、`tileConfig(Player, Building, Object)`、`commandUnits(...)`、`buildingControlSelect(Player, Building)`。
- `mindustry.game.Rules$TeamRule`
  - `infiniteResources`、`cheat`、`fillItems`、`buildSpeedMultiplier`、`protectCores`、`checkPlacement`、`extraCoreBuildRadius`、`rtsAi`、`unitHealthMultiplier`、`unitDamageMultiplier`、`unitMineSpeedMultiplier`、`unitBuildSpeedMultiplier`、`unitCostMultiplier` 等字段存在。

## 真实游戏内探测

通过服务端 `js` 命令：

- 从核心队伍创建单位成功：
  - `unit=211 type=alpha team=sharded`
  - `core=320,800`
- 说明：服务端环境下 `Vars.player` 不存在，但可以直接 `UnitType.create(team).add()`；这符合“助手不以玩家身份行动”的设计。

`Build.beginPlace` 的第一次快速探测没有形成有效结论：选点落在核心占用区/地形上，`validPlace=false`，`beginPlace` 没有放置。这说明真实放置必须由场景测试先找合法 tile，并断言 `validPlace`，不能像 mock 一样随意选点。后续由 probe mod + 固定地图场景验证。

## Probe mod 现实测试（2026-11-19）

写了 `probe-mod/`：Java mod + 本地 socket + Node 客户端，服务端 `config/mods` 加载，`host` 后自动从核心生成助手。

已验证：

- mod 能加载（`1 mods loaded`），socket `127.0.0.1:46500` 可用。
- `get_context` 返回真实地图/队伍/核心/资源/助手。
- 自定义 `UnitController` 能控制真实单位移动；`moveAt` 接收的是**期望速度向量**，不是目标点；直接传目标会冲到地图边界。
- `build` 走真实 `BuildPlan` + `BuilderComp` 后可以完成：`query_area` 能从 MCP 侧读回 `conveyor`（health 45），不是只返回 accepted。
- Ground Zero 测试服曾出现 `build` 返回成功但方块不落地：手动 `host` sector 地图没有建立 campaign 科技树，`conveyor.unlockedNowHost()` 为 false；`Build.validPlace` 不检查解锁，`BuilderComp.updateBuildLogic` 会静默丢弃计划。现在 `build` 对 campaign 未解锁返回 `block_locked`，op 只有目标 tile 真正出现方块才 `done`，计划被移除则 `failed/build_dropped`；`scripts/start-ground-zero-server.sh` 作为测试 fixture 显式 unlock 方块。
- 关键发现：`spawnedByCore=true` 的非 `Player` 单位会被 `UnitComp.update()` 每帧 `Call.unitDespawn`。助手身体必须 `spawnedByCore=false`，用自己的 `isHome` 标记；附身时显式 despawn home body。
- 助手身体使用 mod 自定义 `ai-probe-ai-alpha`（参数由核心类型复制，外观基于 alpha），`playerControllable=false`、`isAI=false`、`isPlayer=false`，避免被原版自动控制逻辑选中。

### MCP 真实 adapter 验证

`mcp-server` 新增 `ProbeGameAdapter`，通过环境变量切换：

```bash
MINDUSTRY_AI_ADAPTER=probe PROBE_PORT=46500 npm run harness
```

实测：

- 27 个 MCP 工具列表正常。
- `get_context` 返回真实助手/队伍/核心/资源。
- `move_to` 返回 opId，`get_action_result` 为 `done`。
- `build_plan`（单块）返回 opId，随后 `query_area` 读回真实 `conveyor`。
- `get_capabilities` 来自真实 `UnitType`（buildSpeed/buildRange/mineTier 等）。
- 物流：`withdraw` 从核心取 5 copper，`get_context` 读回助手携带 copper 5；`deposit` 放回成功。
- 配置：在核心附近建 `sorter`，`configure {item:"copper"}` 成功；`query_area` 读回 sorter。
- 指挥：probe 生成同队 dagger；`command_units {command:"move"}` 后其位置变化；`set_stance {stance:"holdPosition"}` 成功。
- `stop` 清理移动/攻击目标。
- `mine`：在可达的 sand tile 上实测完成，assistant 获得 sand 1。
- `possess` / `release`：同队 dagger 附身后 `assistant.id` 变为 dagger，`isHome=false/possessing=true`；原 home body 被 despawn；release 后 dagger 恢复控制器，核心生成新的辅助身体，`isHome=true`。
- `attack` 支持三种目标：`unitId`（单位）、`buildingId`（建筑）和 `x,y`（坐标）；建筑实测 220→0，坐标实测 done/inRange，`unitId` 实测 dagger health `150→141`。4 波后的低血助手不作为 unitId 验收路径。
- `build_plan`：固定场景一次提交 2 个 conveyor `(112,73)`/`(113,73)`，op 完成且 `query_area` 两个 tile 都存在；多块提交路径已验收。
- `respawn`：probe 接受 `coreId`，只在目标核心属于助手队伍且 `allowSpawn` 时生成；MCP 固定场景实测从第二个核心重生，坐标 `968,584`、coreId `228`，home body id 变化。无核心时返回 `no_core`；核心重建后自动生成新 home body（id `247`，坐标 `972,582`）。
- `move_to`：地面单位新增 BFS 路径（solid tile 规避、对角不切角）；Fortress 场景 5 个 container 墙后目标 `(1084,588)`，助手到达 `(1089,588)`，`get_action_result=done`。`follow`/`attack` 的接近移动也走同一 helper；attack 用墙后目标容器验收，接近到 150px 内并 `cancel`。移动完成或取消目标时会清零速度，避免惯性漂移。
- 地面单位 `move_to` 会拒绝 solid tile（`unreachable/Target tile is solid for a ground unit`）；固定场景附身 dagger 后验证该错误，飞行 alpha 不做此限制。
- `mine`：固定场景在助手附近放 `ore-copper`；`timeoutTicks=1` 返回 `failed/timeout`，无超时挖矿 `done` 并获得 1 copper。
- `move_to`/`attack`/`follow`/`deconstruct`/`repair`/`mine` 均可选 `timeoutTicks`（0–1200），超时后 op `failed`、`data.code=timeout`，并清除对应控制器目标。
- 自动防御：**已按默认显式模式移除**；旧的空闲自动索敌/开火实测仅作历史记录，不再代表当前 HEAD。需要攻击时由 agent 发 `attack`。
- 低血撤退：**已按用户要求移除**。当前助手没有低血自动撤退，也没有空闲自动索敌/开火；死亡后从核心自动重生。`docs/REALITY-CHECK.md` 此前的低血/自动防御实测仅作为历史记录，不代表当前 HEAD。
- 供弹防守：固定场景建 `duo` 炮塔 `(113,75)` 和 feeder conveyor，从核心取 5 copper，传送带接收 5，炮塔 `ammoTotal=6`；再建上游 conveyor，deposit 1 copper 后炮塔 `ammoTotal 10→12`，两段链路可用。4 个启用真实 AI 的敌方 dagger 连续进攻，均被命中（150→141），炮塔弹药实际消耗到 0；长距离/多拐弯链路未验证。
- 数据 token 轮换：probe 新增 `rotate_data_token`；旧 token 访问返回 401，新 token 访问 manifest 返回 200。
- 数据面速率限制：`PROBE_DATA_RATE_LIMIT_PER_SEC`（默认 120）；固定场景 limit=10 时 11 个并发请求得到 9 个 200、2 个 429。
- 多客户端写互斥：probe writer lease 实测 `claim_writer` 第二客户端返回 `writer_held`，无 token 的 `move_to` 返回 `writer_required`，带 token 的 `move_to` 可执行，release 后第二客户端可 claim；`PROBE_REQUIRE_WRITER=1` 下 MCP adapter 自动 claim 并完成 `move_to=done`；1s TTL 过期后新客户端可 claim；默认未开启时保持原有行为。
- MCP allowlist：`MCP_ALLOWED_TOOLS=get_context` 时 `listTools` 只剩 `get_context`，`get_context` 成功，`move_to` 返回错误。
- MCP 写速率限制：`MCP_WRITE_RATE_LIMIT=1` 时第一个 `move_to` 成功，第二个返回 `rate_limited`（retryable=true）。
- 失败注入：固定场景验证 `withdraw` 未知物品返回 `not_found/Unknown item`、`possess` 自己返回 `bad_target/Cannot possess the assistant's own body`、`deposit` 不存在建筑返回 `building_not_found/No target building`；越界 `mine`/`build_plan` 返回 `out_of_bounds/Tile is outside the map`，越界 `move_to` 返回 `out_of_bounds/Target is outside the map`；`attack` 同队单位返回 `wrong_team/Refusing to attack a unit`；资源清零后 `build_plan` 返回 `insufficient_resources/Missing copper 0/1`。
- 定向 `cancel`：`move_to` 后 `cancel {opId}` 返回 `cancelled=1`，对应 `get_action_result` 状态为 `cancelled`。
- 幂等：MCP 工具可选 `idempotencyKey`；固定场景两次相同 `move_to` key 返回同一个 `opId`，第二次不创建新动作。
- 借体解控：`release` 后 released dagger 的 `get_unit.controller` 为 `CommandAI`，不是 `ProbeController`；单位未消失。
- `possessionAllowed`：规则关闭时 `possess` 返回 `possession_disabled/Possession is disabled in the current rules`。
- 附身校验：敌方 dagger `possess` 返回 `wrong_team/Target unit is not on the assistant's team`；助手自己身体返回 `bad_target`；临时把 dagger 类型的 `playerControllable` 设为 false 后返回 `not_possessable/Target unit type is not player-controllable`。
- 停机开关：probe `set_writes_enabled(enabled=false)` 后 `move_to` 返回 `writes_disabled/Probe writes are disabled`。
- 动作日志：probe `get_action_log` 返回 op 状态列表；固定场景取消 `move_to` 后能在日志中找到该 `opId` 且 status 为 `cancelled`；ops 上限 256，优先淘汰已结束动作。
- `get_events` 类型过滤：固定场景 `summary=true, types=['unit_destroy','build_damage']` 实测 `byType={unit_destroy:4,build_damage:25}`；`summary=true` 时 events 为空、`hasMore=false`。
- 错误分类：MCP error 增加 `category`（input/rule/resource/world/transport/internal）和 `retryable`；固定场景未知物品返回 `not_found/input/false`。
- 真实 `get_content`：probe 读取 `Vars.content.units()` 70 个类型、blocks/items/liquids；固定场景 `get_content(type=units)` 包含 dagger，并用 `query=dag, limit=5` 返回仅 dagger。
- 真实 survival wave：固定场景连续触发 4 波 `start_wave`，wave 逐波推进，每波生成敌人和 27 个 spawn group；`query_area includeEnemies=true` 找到 wave dagger 并被炮塔打伤；`get_context includeEnemies=true` 的 `threats` 返回同一敌军。4 波后核心仍存活（health `920`）、助手存活（health `20`），但远处敌人未全部解决。
- 核心受击：`spawn_enemy` 新增 `ai=true` 启用引擎默认 AI；助手撤离后先生成 3 个敌方 dagger，核心 health `1100→1082`；再生成 2 个，第二波后核心 health 仍为 `128`，核心存活。默认 `ai=false` 仍为静止测试敌人。
- LLM 超时：`LLM_REQUEST_TIMEOUT_MS=150` 配合延迟 mock endpoint 实测退出码 1，错误为 `LLM request timed out after 150ms`；重试未做。
- LLM 重试：`LLM_MAX_RETRIES=1` + mock endpoint 首次 503，实测第二次成功，`llmRetries=1`；重试耗尽时退出码 1、错误 `LLM request failed: 503 mock transient failure`。
- LLM harness：`harness/llm.ts` 支持 OpenAI-compatible 工具循环；`LLM_MOCK=1` 实测 27 tools、1 次 `get_context`、token/latency 记录。多步 mock 任务（withdraw/deposit）实测 toolCalls=3、`LLM_REQUIRE_TOOLS` 通过。真实本地 `qwen3.5:4b` + `LLM_TOOL_FILTER=get_context,withdraw,deposit` 在真实 probe 上完成 `get_context → withdraw → deposit`，toolCalls=3 并报告成功；未过滤工具的 lfm3/qwen3.5/ornith 容易选错动作。外部供应商 endpoint 未验收。固定移动任务仍由 lfm3 完成：`get_context → move_to(952,584)`，最终 `x=944.95`；自算 `core.x+24` 最终 `x=944.92`。
- `deconstruct`：MCP deconstruct 后建筑从 `query_area` 消失。
- `repair`：probe 侧 conveyor 从 25/45 恢复到 45/45。
- `follow`：MCP follow 后助手位置变化；固定场景实测 ally 移动后助手追到 30.38px 内并 `cancel`；目标被 `remove_unit` 移除后 follow 动作 `done`、`data.reason=target_gone`，控制器 `followTarget` 清空。
- `get_events`：probe 事件环已接，实测能读到 `unit_destroy`、`build_damage`、`block_build_end` 等；`get_context.eventsSince` 为真实序号。
- `get_events` 摘要模式已接：`summary=true` 返回 `byType` 计数 + `ref`，可加 `types` 在游戏侧过滤；原始页仍保留。
- `get_context`：队伍字段改为 `assistant.team`，`radius` 以 tile 为单位过滤 near units；固定场景实测 `radius=4` 无邻近单位，`radius=15` 包含 ally 226。`since` 事件增量摘要实测 `eventsPending=4`/`byType.total=4`，推进到 `eventsSince` 后为 0。`maxUnits`（1–64，默认 20）限制单位列表并返回 `unitsTruncated`；固定场景 `maxUnits=1` 时 nearby units `1→0`。`maxBytes=900` 时上下文裁剪到 895 字节；`bytes` 实测 1167（未裁剪）。
- `get_area`：固定场景半径 2 读回 25 个 tile，`truncated=false`；工具只返回 bounded window，不返回全图。
- `query_area`：building snapshot 增加 `itemList` 和炮塔 `ammoTotal`；固定场景 turret `ammoTotal=6`。
- `get_tile` 返回 `config`；固定场景 sorter `configure {item:"copper"}` 回读 `"copper"`，switch `configure true/false` 分别回读 `"true"`/`"false"`。布尔配置曾因 `asInt()` 抛 `Not a number`，已改为 `asBool()`。
- `get_config_schema`：probe 从真实 `Vars.content.block` 读取；固定场景 sorter `configurable=true` 且 values 含 `copper`，unloader 含 `north`，switch 字段为 `boolean`，message/processor 字段为 `string`。
- 传输层：probe 写 `/tmp/mindustry-ai-probe/bridge-info.json`，`hello` 返回 protocol=1/version=0.1.0；`PROBE_REQUIRE_AUTH=1` 时按 discovery token 校验。动作 socket 只入队，游戏每帧最多处理 50 条。`ping`/heartbeat 与连接重试已接；`PROBE_HEARTBEAT_MS=200` 固定场景通过。固定场景脚本现在默认以 `PROBE_REQUIRE_AUTH=1` 运行，seed、raw probe、MCP adapter 全部通过 token 握手。fake probe 同端口重启后 adapter 自动重连并读到新 map，单测 16/16。
- 状态一致性审计（2026-11-22）：`build`/`deconstruct`/`repair`/`mine` 的 op 只有在游戏状态真正变化后才结束；`build_dropped`、`deconstruct_dropped`、`target_gone`、`assistant_gone` 都会失败而不是假 done。`configure` 在调用后回读 `building.config()`，未应用则 `configure_rejected`。`stop` 会清空移动/攻击/跟随/采矿/建造目标并把 running op 标为 cancelled；`cancel` 对 mine/build/deconstruct/repair 做同样清理。助手死亡或附身换体后，旧 op 以 `assistant_gone` 结束。`mine` 以开始时携带量为基线，不会因为身上已有物品而立即 done。`command_units` 的目标 unit/building 不存在时返回 `target_not_found`。
- HTTP 健壮性（2026-11-22）：畸形 request line、空请求、超大 header、chunked body 均返回 400 并关闭 socket；连接数上限 64；accept 瞬时异常不再停服；`eventSeq`/`mapRevision` 改为 volatile，`/events/wait` 的 gameOver/won 读游戏线程缓存；`dataBaseUrl` 不再回显客户端 `Host`。
- 会话入口收口（2026-11-22）：`/context` 只接受 `detail/radius/since/includeEnemies/maxUnits/maxBytes`；`/mcp` 的 `tools/call` 同样走 34 个工具白名单，`build_plan` 走 session 展开路径。`/context?op=...` 和 `/mcp {name:"set_paused"}` 均实测被拒。
- 会话/数据面审计（2026-11-22）：get_area 改为行优先并返回 coverage.next；context 返回 resourceCapacity/resourcesFull 与 core items；map drop_id 改为 item.id+1 并附 items/dropIds；/content、/capabilities、/cancel、/stop 已接入；get_action_result.waitMs 已轮询；build_plan required 为空；cancel/stop 进入工具表；pruneOps 不再淘汰 running；304 带 ETag/Cache-Control 且 HEAD 无 body；/events/wait 独立 8 连接配额，超限 429；session /actions 支持 idempotencyKey（LRU 256，按 session token 隔离）。
- 命令超时（2026-11-22）：队列 Command 带 `started/cancelled`；HTTP 超时未开始时 503 `not_executed` 且不会执行，已开始则 504 `execution_unknown`。实测游戏线程 stall 6.5s 时返回 503、`moved=0`。
- 失败会返回错误或保持 running，不是假成功。

- 会话能力对齐（2026-11-23）：session `/tools` 27 个，新增 `possess`/`respawn`/`pause`/`resume`/`command_units`；`session-api-smoke` 断言 27 个工具、session `pause`/`resume`、暂停写门控。`possess` 经 session 实测 dagger 借用、`assistant.type=dagger`、`release` 回 home；`respawn` 按 `core-foundation`/`core-nucleus` 分别得到 `ai-probe-ai-beta`/`ai-probe-ai-gamma`。`Rules.pauseDisabled=true` 时 `pause` 返回 `pause_disabled`；MCP `/mcp` tools/list 27 个。

- 玩家能力补齐（2026-11-23）：`get_config_schema {block:"ground-factory"}` 返回 3 个可选方案（0 dagger、1 crawler、2 nova）；`configure {buildingId,value:1}` 回读 `config=1`。`get_tech_tree {content:"duo"}` 返回 parent/children/requirements/objectives/researched/blockedReason。`control_building` 控制 Fortress 同队 `duo`，`context.control.mode=building`、unitType=`block`；`attack` 对敌方 container 返回 done；`release_building` 不删除建筑。payload-capable mega 附身后 `pickup_payload` 同队 dagger、`drop_payload` 清空 payload。session `/tools` 34 个，session smoke 和 `/mcp` smoke 均通过；boost 对无 canBoost 的 body 返回 `cannot_boost`。

限制：

- 之后仍需补 `deconstruct`/`repair`/`cancel`、`follow` 稳定性、`get_events`。
- headless 服务端没有本地 `Player`，所以 `get_context.player.dead=true`；桌面客户端会不同。


- issue #32（2026-11-23）：`/context` 和 `/health` 增加 `captured`，`rules.sector` 增加 `wasCaptured`；campaign 占领不再需要靠 `won` 推断。API 触发的 pause/resume 直接写 `game_pause`/`game_resume` 事件（带 `source=api`），不再被 `detectPauseChange` 去重吞掉。
- issue #33（2026-11-23）：`deconstruct` 增加 `allowPartial`/`skipMissing`；缺失/不可拆目标跳过并写入 `data.skipped`，执行超时的 `data.targets` 给出逐目标 `done/pending`。
- issue #35（2026-11-23）：`build_plan` 失败不再返回空 `opId`，`data.results[]` 每项带 `x/y/block`；文档明确它是逐块 best-effort、不是原子事务。
- issue #36（2026-11-23）：`get_tile` 增加 floor/overlay/liquid/solid、机器运行态字段，传 `block/rotation` 可预检 `canPlace/placeReason`；`get_area` 增加地形字段；build 路径补 buildRange 检查并回报 `replaced/previousBlock`。
- issue #37（2026-11-23）：`get_tile.config` 改为结构化 JSON（Item/Content/Point2[]/byte[]/数组），不再输出 `@hash`；`/context.power` 暴露电力网络 produced/needed/balance/stored/capacity/satisfaction。
- issue #38（2026-11-23）：session prompt 第 0 步可先用 bootstrap 只读读取 `/guide`/`/tools`；`/guide` 末尾不再指向会话内 404 的 docs，改为说明仓库文档。
- 回归（2026-11-23）：`session-api-smoke` 通过 34 工具、bootstrap guide/tools、captured/power 字段、get_tile 预检、build_plan 失败形状、暂停门控、数据面 Range/304/轮换；`probe-mod/build.sh` 成功。

## 科技树 API 信息充分性（2026-11-24）

- 测试方式：新建无上下文 subagent，只给 `/tmp/tech-tier-prompt*.txt` 的 endpoint/bootstrap，不给仓库/网页/预训练知识；只允许 API 查询，要求输出物品层级、阶段路线、缺失字段。
- 首轮（旧 API）：`sufficient=false`，14 次调用、279s。实际阻塞：447 个 block 只有 `outputs`（21 个），没有 `inputs`；22 个 item 只有 `{name,id,meta}`，没有 recipe/tier/research；物品不是 TechTree 节点（按 item 查询 404）；根查询 `count=128, truncated=true` 且没有 depth/cursor；fixture 下 `/content` 的 `researched` 与 TechTree 的 `researched` 语义不一致。
- 已补：block `parameters.inputs`（item/liquid，81 个 block 有）、`liquidOutputs`、`drillTier/drillTimeTicks/hardnessDrillMultiplier/mineableSource`、pump `liquidSource`、`get_tech_tree.depth`、`get_tile/get_area.dropHardness`；配套 `API-DATA-CONTRACT`、`GAME-GUIDE`、`SESSION-API`。
- 第二轮派发（19:09）：因 bootstrap token 一次性，subagent 未能建立 session，149s 中断，不作为测试结果。
- 有效复测（补 inputs/depth 后，19:12）：约 225s，`sufficient=false`，但结论从“完全无法”变为“制成品层级可推导，完整路线不可”：原矿（copper/lead/coal/sand/titanium/thorium）没有方块 outputs，钻机产出依赖 `get_tile.drop`；液体链没有完整 producer/consumer 映射；`researched` fixture 状态干扰；TechTree 根分支需逐节点查询。
- 最终复测（补 `liquidOutputs`/drill/pump/`dropHardness` 后，19:31）：约 289s，`sufficient=true`（有保留）。API 的 block `inputs/outputs/liquidOutputs` 与地图 `drop/dropHardness` 组成闭合图；以 Ground Zero 实测 4 种原料（copper/lead/scrap/water）做 BFS，可达 Serpulo 22 个物品中的 16 个；未达的 6 个是 Erekir 专属（beryllium/tungsten/oxide/carbide/fissile-matter/dormant-cyst）。TechTree 的 `depth/parent/requirements` + sector 节点链（groundZero→frozenForest→crateredBattleground）足以排序研究阶段；drill `drillTier` 与 tile `dropHardness` 可判定矿脉可采性。
- 保留限制：单个区域的 API 只能给出当前地图实际资源，跨区域/跨星球仍需 sector 节点和实际地图采样；液体 producer 索引不完整；fixture 的 `/content.researched` 不能代表真实研究进度，应读 TechTree；根树可能 `truncated`，要沿 `children`/父链查询。
- 测试结论（更新）：**允许地图 `get_tile/get_area` 采样时，API 足以推导高阶物品和完整阶段路线（同一星球/可达区域内）；只靠静态 `/content` 不够。**


- v160.8 上，设计依赖的关键 API 都存在，签名与设计一致；`UnitController` 自定义控制器、`Build.beginPlace`、核心重生、玩家权限入口都可接。
- Probe mod + `ProbeGameAdapter` 已把 `get_context`/`get_capabilities`/`query_area`/`move_to`/单块 `build`/`withdraw`/`deposit`/`configure`/`command_units`/`set_stance`/`stop`/`possess`/`release`/`respawn`/`mine`/`attack` 接到真实游戏；物流、sorter 配置、指挥、stance、附身/释放、死亡重生、sand 挖矿、攻击容器已实测。
- 仍未完成：`deconstruct`/`repair`/`cancel`、`follow` 稳定验收、真实事件日志。
- 版本基线默认 v160.8；BEK/MindustryX 的 v154 代码只作参考，不作为主干。
- 不要直接用服务端 `js` 当生产接口；probe 只是过渡验证。

- 助手身份诊断（2026-11-22）：`get_context.assistantBodies` 只扫描 `ProbeController`；实机观察到的多个 alpha 中，只有当前助手是 ProbeController，其他是玩家身体（Player）或普通 CommandAI。`respawn` while possessing 会先恢复借体控制器再生成新 home；`cleanupStrayAssistantBodies` 会清理遗留的 ProbeController 身体。

- 存档/读档（2026-11-22）：助手 home body 会随 unit 保存；旧实现读档后 `reset()` 清空指针但保留旧单位，再 spawn 新 home，累积 alpha。现在 spawn 时写 `Unit.flag=ASSISTANT_FLAG`，world load 先按 flag 删除旧 home，再生成；`cleanupStrayAssistantBodies` 也识别 flag。

- issue #25/#26（2026-11-22）：会话 `tools` 从 12 扩到 21，补 `get_tile/query_area/get_unit/list_unit_types/deconstruct/repair/set_stance/release/follow`；`context` 增加 `wavetime/waveTimer`。`newOp` 在 256 个活跃 op 时返回 `op_capacity`，session 映射 503，避免 ops 无上限增长。

- issue #27（2026-11-22）：新增鉴权后的 `GET /` 端点索引；`?topic=build` 改为引用 `get_tile`/`configure`，不再出现 `canvas.`/`get_config_schema`；SESSION-API 数据面补充 `drop_id=0 或 item.id+1` 与 `dropIds` 解码说明。

- issue #28（2026-11-22）：context 增加 mission/objectives/tutorial/rules（winWave、waveTimer、建造速度/成本/返还/血量倍率、sector.captureWave）；新增 wave_start/wave_end 事件（wave 变化时发出）。guide 增加 waveTimer=false/tutorial 停手询问规则，并把 sector 规则指向 context.rules。

- issue #29（2026-11-23）：新增 `research` 动作（`content`/`block`/`unit`），按 TechTree 要求扣除核心资源并解锁目标/父节点；`/content` 的 blocks/units 增加 `researched`/`researchCost`，`/context.rules.researched` 暴露研究集合；guide 更新研究路径。
- issue #30（2026-11-23）：`/context.objectives` 返回全部（上限 64），补 `type/progress/parents/flagsAdded/flagsRemoved`，`rules.objectiveFlags`；Ground Zero fixture 实测 17 条。
- issue #31（2026-11-23）：新增直连 `GET /health`；`events/wait.paused` 直接读当前状态；`query_area` 半径上限 256px、units/buildings 各 64 条并返回 `truncated`。实测 session smoke：health 200、query cap 256、context fields 完整。
- 崩溃（2026-11-23）：客户端 `ValidateException: Player attempted to control invalid unit`。日志与 `InputHandler.update` 实现显示：玩家死亡后原版会找 `type == controlledType && playerControllable && !dead` 的最近单位并自动 `unitControl`；助手若用普通 `alpha` 类型会被选中，而 `ProbeController` 不是 AI controller，服务端校验失败。
  修复：助手改为 mod 内的 `ai-probe-ai-alpha` 类型（从 alpha 复制外观/武器/采矿/建造参数，`playerControllable=false`、`useUnitCap=false`、hidden），因此不会被原版自动复活逻辑选中；同时保留 player/justSwitch 保护和 `playerTransitioning` 清理门控。
