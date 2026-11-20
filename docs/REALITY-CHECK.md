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
- 关键发现：`spawnedByCore=true` 的非 `Player` 单位会被 `UnitComp.update()` 每帧 `Call.unitDespawn`。助手身体必须 `spawnedByCore=false`，用自己的 `isHome` 标记；附身时显式 despawn home body。
- 助手身体从核心类型生成（例如 `gamma`/`alpha`），`isAI=false`、`isPlayer=false`，因此不可被原版 `unitControl` 附身，符合设计。

### MCP 真实 adapter 验证

`mcp-server` 新增 `ProbeGameAdapter`，通过环境变量切换：

```bash
MINDUSTRY_AI_ADAPTER=probe PROBE_PORT=46500 npm run harness
```

实测：

- 25 个 MCP 工具列表正常。
- `get_context` 返回真实助手/队伍/核心/资源。
- `move_to` 返回 opId，`get_action_result` 为 `done`。
- `build_plan`（单块）返回 opId，随后 `query_area` 读回真实 `conveyor`。
- `get_capabilities` 来自真实 `UnitType`（buildSpeed/buildRange/mineTier 等）。
- 物流：`withdraw` 从核心取 5 copper，`get_context` 读回助手携带 copper 5；`deposit` 放回成功。
- 配置：在核心附近建 `sorter`，`configure {item:"copper"}` 成功；`query_area` 读回 sorter。
- 指挥：probe 生成同队 dagger；`command_units {command:"move"}` 后其位置变化；`set_stance {stance:"holdPosition"}` 成功。
- `stop` 清理移动/攻击目标。
- `mine`：在可达的 sand tile 上实测完成，assistant 获得 sand 1。
- `possess` / `release`：同队 dagger 附身后 `assistant.id` 变为 dagger，`isHome=false/possessing=true`；原 home body 被 despawn；release 后 dagger 恢复控制器，核心生成新 alpha，`isHome=true`。
- `attack` 支持三种目标：`unitId`（单位）、`buildingId`（建筑）和 `x,y`（坐标）；建筑实测 220→0，坐标实测 done/inRange。单位目标入口已接，但独立伤害验收受测试单位消失影响。
- `build_plan`：固定场景一次提交 2 个 conveyor `(112,73)`/`(113,73)`，op 完成且 `query_area` 两个 tile 都存在；多块提交路径已验收。
- `respawn`：probe 接受 `coreId`，只在目标核心属于助手队伍且 `allowSpawn` 时生成；MCP 固定场景实测从第二个核心重生，坐标 `968,584`、coreId `228`，home body id 变化。无核心时返回 `no_core`；核心重建后自动生成新 home body（id `247`，坐标 `972,582`）。
- `move_to`：地面单位新增 BFS 路径（solid tile 规避、对角不切角）；Fortress 场景 5 个 container 墙后目标 `(1084,588)`，助手到达 `(1089,588)`，`get_action_result=done`。`follow`/`attack` 的接近移动也走同一 helper；attack 用墙后目标容器验收，接近到 150px 内并 `cancel`。
- 自动防御：空闲时每 10 tick 扫描武器射程内最近敌军，设置 `aimX/aimY/isShooting`；固定场景 spawn dagger 后 health `150→123`。
- 低血撤退：health < 30% 且空闲时优先退到远离敌人的同队核心，否则向远离最近敌军方向移动；固定场景核心距离 `209→62`、敌方距离 `63→84`。
- 供弹防守：固定场景建 `duo` 炮塔 `(113,75)`，核心取 5 copper 存入炮塔，spawn 敌人后 1.2s 内敌方 health `150→123`。
- LLM harness：`harness/llm.ts` 支持 OpenAI-compatible 工具循环；`LLM_MOCK=1` 实测 25 tools、1 次 `get_context`、token/latency 记录。`harness/mock-openai-server.mjs` 已真实验证 HTTP 路径（`mock=false`、24/12 tokens）；真实供应商 endpoint 未验收。
- `deconstruct`：MCP deconstruct 后建筑从 `query_area` 消失。
- `repair`：probe 侧 conveyor 从 25/45 恢复到 45/45。
- `follow`：MCP follow 后助手位置变化；固定场景实测 ally 移动后助手追到 30.38px 内并 `cancel`；目标死亡/复杂避障仍简化。
- `get_events`：probe 事件环已接，实测能读到 `unit_destroy`、`build_damage`、`block_build_end` 等；`get_context.eventsSince` 为真实序号。
- `get_events` 摘要模式已接：`summary=true` 返回 `byType` 计数 + `ref`，可加 `types` 在游戏侧过滤；原始页仍保留。
- `get_context`：队伍字段改为 `assistant.team`，`radius` 以 tile 为单位过滤 near units；固定场景实测 `radius=4` 无邻近单位，`radius=15` 包含 ally 226。`since` 事件增量摘要实测 `eventsPending=4`/`byType.total=4`，推进到 `eventsSince` 后为 0。
- 传输层：probe 写 `/tmp/mindustry-ai-probe/bridge-info.json`，`hello` 返回 protocol=1/version=0.1.0；`PROBE_REQUIRE_AUTH=1` 时按 discovery token 校验。动作 socket 只入队，游戏每帧最多处理 50 条。
- 失败会返回错误或保持 running，不是假成功。

限制：

- 之后仍需补 `deconstruct`/`repair`/`cancel`、`follow` 稳定性、`get_events`。
- headless 服务端没有本地 `Player`，所以 `get_context.player.dead=true`；桌面客户端会不同。


## 结论

- v160.8 上，设计依赖的关键 API 都存在，签名与设计一致；`UnitController` 自定义控制器、`Build.beginPlace`、核心重生、玩家权限入口都可接。
- Probe mod + `ProbeGameAdapter` 已把 `get_context`/`get_capabilities`/`query_area`/`move_to`/单块 `build`/`withdraw`/`deposit`/`configure`/`command_units`/`set_stance`/`stop`/`possess`/`release`/`respawn`/`mine`/`attack` 接到真实游戏；物流、sorter 配置、指挥、stance、附身/释放、死亡重生、sand 挖矿、攻击容器已实测。
- 仍未完成：`deconstruct`/`repair`/`cancel`、`follow` 稳定验收、真实事件日志。
- 版本基线默认 v160.8；BEK/MindustryX 的 v154 代码只作参考，不作为主干。
- 不要直接用服务端 `js` 当生产接口；probe 只是过渡验证。
