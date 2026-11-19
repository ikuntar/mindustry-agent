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
- `Build.validPlace` + `Build.beginPlace(assistant, ...)` 能生成 `build1`（ConstructBlock），但不会自动完成：真实建造进度要由本地控制器/建造 AI 调 `ConstructBlock.construct` 推进；这是本地反射层的职责。
- 关键发现：`spawnedByCore=true` 的非 `Player` 单位会被 `UnitComp.update()` 每帧 `Call.unitDespawn`。助手身体必须 `spawnedByCore=false`，用自己的 `isHome` 标记；附身时显式 despawn home body。
- 助手身体从核心类型生成（例如 `gamma`/`alpha`），`isAI=false`、`isPlayer=false`，因此不可被原版 `unitControl` 附身，符合设计。

限制：

- probe 只实现 `get_context`/`get_tile`/`move_to`/`build`/`get_action_result`；没有 MCP adapter，也没有本地建造/战斗反射。
- `build1` 未完成是预期结果：当前 probe 控制器只移动，不推进施工。


## 结论

- v160.8 上，设计依赖的关键 API 都存在，签名与设计一致；`UnitController` 自定义控制器、`Build.beginPlace`、核心重生、玩家权限入口都可接。
- 现实测试还缺一层：游戏内 mod adapter。当前 MCP server 仍只连 `MockGameAdapter`。
- 版本基线默认改为 v160.8；BEK/MindustryX 的 v154 代码只作参考，不作为主干。
- 下一步：写一个最小 probe mod（本地 socket + `get_context` + `move_to` + 单块 `build` + 读回），再用同一个 MCP 契约跑真实 adapter；不要直接用服务端 `js` 当生产接口。
