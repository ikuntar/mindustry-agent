# API 数据契约（实体结构、字段与枚举）

状态：2026-11-26，Mindustry v160.8 / Mindustry Agent 0.4.3。

用途：给 harness 和 LLM 一个**字段级**参考；实际字段随版本可能增加，客户端按字段名读取，
不要把 JSON 顺序、数组长度或未列出的字段当成稳定契约。

## 1. 通用约定

- 坐标：**所有公开 JSON 坐标和半径统一为 tile 单位**。允许小数表示 tile 内部位置
  （例如 `129.5` 是 tile 129 的中心）；内部引擎的 8 px/tile 换算不暴露给客户端。
  - `get_tile`、`build_plan`、`deconstruct`、`configure`、`mine` 使用整数 tile 坐标。
  - `get_area`、`query_area`、`move_to`、`attack` 的 `x/y` 和 `radius` 也都是 tile。
  - `get_area.coverage.next` 是 tile 坐标，并带 `unit:"tile"`；把它作为
    `get_area.cursor:{x,y}` 传回可从下一格继续 row-major 扫描。
- `get_context.wavetime` 单位是 **tick**；秒数为 `wavetime/60`。
- `/actions` 的字段是顶层字段，不要包成 `args`；嵌套写法会被 `bad_request` 拒绝。
  `get_area`/`query_area` 必须提供数字 `x/y`，不会静默用 0,0 代替。
- `team` 字段是数字 id，不是名字；需要可读名字时用 `teamName` 或团队表。
- 空字符串 `""` 表示“无该属性/无内容”，不要把它当作名字为空的实体。
- `hidden=true` 表示当前受迷雾限制，`discovered=false` 表示连静态地形都未发现；
  不能从隐藏对象读取 block/team/items/config。
- 大结果不要塞进模型上下文；地图/事件走 `/data`，工具结果只保留摘要和 `next` 游标。

## 2. 队伍枚举

`Team` 的基础 id/name：

| id | name | 说明 |
|---:|---|---|
| 0 | derelict | 中立/废弃 |
| 1 | sharded | Serpulo 玩家默认队伍 |
| 2 | crux | Serpulo 敌方 |
| 3 | malis | 战役/编辑器队伍 |
| 4 | green | 编辑器队伍 |
| 5 | blue | 编辑器队伍 |
| 6 | neoplastic | 特殊队伍 |
| 7+ | team#N | 游戏注册的占位队伍 |

客户端必须按 `id` 或 `name` 读取，不要硬编码“敌人一定是 2”；战役/PvP 可能改变默认队伍。

## 3. `get_context` 顶层结构

```text
{
  version, tick, timeMs, time, second, minute, server, client,
  map, worldWidth, worldHeight,
  wave, wavetime, waveSeconds, waveTimer, enemies,
  contentCounts{blocks,units,items,liquids},
  logic{time,tick,second,minute,waveNumber,waveTime,mapw,maph,server,client},
  team, teamName, paused, gameOver, won, captured, campaign, sector, winWave,
  mission, objectives[], tutorial, rules{},
  power[], eventsSince, eventsPending, eventSummary{total,byType},
  assistant{}, control{}, assistantBodies[],
  resources{}, resourceCapacity{}, resourcesFull[],
  cores[], units[], unitsTruncated, unitCount, threats[], threatsTruncated, bytes
}
```

`detail` 参数目前是兼容参数；服务端始终返回这个有界结构，实际大小由 `maxBytes`/`maxUnits`
和本地半径限制控制。

`time` 是游戏内时间毫秒（`tick / 60 * 1000`，对应逻辑 `@time`）；`timeMs` 是 wall clock，
不能混用。`second/minute` 是游戏内秒/分；`waveSeconds` 是 `wavetime / 60`（对应逻辑
`@waveTime`）；`contentCounts` 是已加载内容类型数量，不是地图上的实体数量。
`logic` 是把常用 `GlobalVars` 用逻辑处理器名字再投影一次，方便从 logic 迁移；例如
`logic.waveNumber`、`logic.waveTime`、`logic.mapw/maph`。

### 3.1 `assistant`

```text
id, type, team, x, y, health, maxHealth, dead,
isAI, isPlayer, spawnedByCore, isHome, possessing, homeBodyId,
item, itemAmount, boosting, payloads[], payloadUsed
```

`isHome=true` 表示当前是 home body；`possessing=true` 表示控制的是借体。
`item` 是当前携带物品名，`itemAmount` 是数量。

本地反射：当前版本默认**没有**低血自动撤退，也没有空闲自动索敌/开火；助手空闲时停止移动，
死亡后由核心自动重生。移动/攻击/跟随必须由显式动作产生；不要把空闲位移误认为自动行为。

### 3.2 `control`

```text
{ mode: "unit" }
```

控制建筑时：

```text
{ mode:"building", buildingId, block, x, y,
  unitId?, unitType?, aimX?, aimY? }
```

`mode` 只有 `unit` / `building`；`unitId/unitType` 是建筑对应的伪单位（若存在）。

### 3.3 `assistantBodies[]`

```text
{ id, type, team, x, y, health, dead, isHome, controller }
```

数组只列由 `ProbeController` 控制的助手身体；普通单位不会是助手。
`controller` 是控制器类名（如 `ProbeController`、`Player`、`CommandAI`）。

### 3.4 `units[]` / `threats[]`

```text
{ id, type, team, x, y, health, maxHealth, dead,
  item?, itemAmount?, isAI? }
```

`units` 默认只返回助手队伍本单位；`threats` 需要 `includeEnemies=true`，且受
`radius`/`maxBytes` 和迷雾限制。`type` 是内容名（如 `dagger`），`team` 是数字 id。

### 3.5 `cores[]`

```text
{ id, block, x, y, health, maxHealth, itemCapacity, unitType, items{} }
```

`items` 是 `{物品名: 数量}`；`unitType` 是该核心重生产出的单位类型名。

### 3.6 `resources` / `resourceCapacity`

```text
resources:        { copper: 350, lead: 120, ... }
resourceCapacity: { copper: 4000, ... }
resourcesFull:    [ "copper", ... ]
```

`resources` 是队伍共享库存；`resourceCapacity` 是所有核心容量之和；
`resourcesFull` 表示该物品已达到容量，继续生产会反压。

### 3.7 `objectives[]`

```text
{ index, type, text, details, completed, hidden, parents[],
  flagsAdded[], flagsRemoved[], progress? }
```

`type` 是游戏目标类型名（`CoreItem`、`Item`、`UnitCount`、`Timer`、`Flag`、
`DestroyBlocks` 等）；`parents` 是目标索引；`progress` 随类型变化：

```text
CoreItem/Item: { current, target, item }
UnitCount:     { current, target, unit }
Timer:         { current:-1, target, unit:"seconds", display, progressAvailable:false, note }
Flag:          { current:0|1, target:1, flag }
DestroyBlocks: { current, target, unit:"blocks" }
BuildCount:    { current, target, unit:"blocks" }
Produce:       { current, target, unit:"items"/... }
```

Timer 的精确 elapsed 是 protected 游戏字段，不通过反射读取；用 `display` 的倒计时文本。

### 3.8 `power[]`

```text
{ team, id, produced, needed, balance, stored, freeCapacity, capacity, satisfaction }
```

`stored` 是电池当前电量；`freeCapacity` 是还能充入的电量；`capacity = stored +
freeCapacity` 是总容量。旧版本把 `getBatteryCapacity()` 的“剩余可充电量”直接叫
`capacity`，会出现 `stored>0, capacity=0` 的假矛盾（电池已满）。`satisfaction` 是 0..1，
读取失败为 `-1`。

### 3.9 `rules`

```text
{ modeName, fog, staticFog, mission, waveTimer, waveSending, waves, winWave,
  buildSpeedMultiplier, deconstructRefundMultiplier, buildCostMultiplier,
  blockHealthMultiplier, unitBuildSpeedMultiplier,
  dropZoneRadius, enemyCoreBuildRadius, polygonCoreProtection,
  objectives[], objectiveFlags[], researched[],
  sector?: { id, name, preset, captureWave, wasCaptured } }
```

`fog/staticFog` 是只读规则；`wasCaptured` 是战役区域状态。
`dropZoneRadius` 是出生/空投区半径，`enemyCoreBuildRadius` 是敌方核心禁止建造半径；
`polygonCoreProtection=true` 时实际约束可能是最近核心保护，需用 `get_tile` 预检。
campaign 占领不一定置 `won=true`，优先看 `captured` / `sector.wasCaptured`。

## 4. tile 结构

`get_tile`：

```text
{ x, y, discovered, hidden,
  floor, overlay, liquid, drop, dropHardness, drillable, block, team,
  solid, breakable, replaceable,
  canPlace?, placeReason?,
  spawnZone?: { known, radius, inside, distance, nearestSpawn?, note? },
  health?, maxHealth?, rotation?, efficiency?, progress?, warmup?, enabled?,
  items?, liquidItems?: [{liquid,amount,capacity}], ammoTotal?, powerNetId?, config?
}
```

`get_area` 的 `tiles[]` 使用相同字段（不含 `canPlace` 预览，除非单独调用 `get_tile`）。
`spawnZone` 来自最近的固定出生点；`inside=true` 表示在敌人出生/空投区，波次开始时
该区域内的建筑会被清除，不要在这里规划永久建筑。`known=false` 表示迷雾/无出生点，
不能据此判断安全。
隐藏态只保证 `x/y/discovered/hidden`，其余字段不可用于决策。

- `block`：内容名，空气为 `air`，隐藏为 `hidden`；
- `blockType`：`building`、`breakable_prop`、`replaceable_terrain` 或 `terrain`；
  `blockBreakable`/`destructible`/`alwaysReplace` 是原始 Block 标志；
- `team`：数字 id，`-1` 表示未知/隐藏；
- `rotation`：`0=east, 1=south, 2=west, 3=north`；有建筑时 `outputTile` 是当前朝向的下一格，
  多格建筑 `entity.x/y` 是中心，`tileX/tileY` 是原点；动作目标接受任意覆盖格，`build_plan` 的 placement 用原点；
  可用于检查传送带/管道是否对着空气、墙或自己；
- `drop`：该 tile 的**地板矿 overlay**，与 `block` 占用无关；`""` 表示无矿；
  `dropHardness` 是该矿硬度（无矿为 -1）。可钻位置需要同时满足 `drillable=true`
  （`block==air && drop!=""`）和钻机 tier ≥ hardness；`get_area` 也有该字段；
- `solid`：tile 是否阻挡通行（含 floor solid / building checkSolid）；装饰物可能为 true；
- `drillable`：`block==air && drop!=""` 的地板矿 overlay；还要满足钻机 tier ≥ `dropHardness`；
- `breakable`：当前队伍能否用 `Build.validBreak` 拆除；`replaceable`：原地覆盖是否允许；
- `efficiency`：0..1；`progress/warmup` 是 0..1；`enabled` 是逻辑/开关状态；
- `items`：`[{item,amount}]`，不是对象；`liquidItems` 是建筑液体库存，`capacity` 是该建筑液体总容量；
- `powerNetId`：有电力网络的建筑返回网络 id，可与 `/context.power[].id` 对照；
- `ammoTotal`：炮塔当前弹药总量，单位是折算后的**发数**，不是 item 数量；
  `ammoPerItem` 见 `/content` 的炮塔参数。`itemCapacity` 是物品格数，两者不能直接互换。

### 4.0 `entity` / `unit` / `building` 传感器

`get_unit` 现在返回：

```text
{ ...legacy fields, entity:{...}, unit:{...} }
```

`get_tile` 在有建筑时返回：

```text
{ ...legacy fields, entity:{...}, building:{...} }
```

`query_area` 的每行有 `entity`；只有 `detail:"full"` 才额外返回 `unit`/`building`。

```text
entity: {
  kind: "unit"|"building",
  id, type, name, team, x, y, health, maxHealth, dead,
  rotation, size, rangeTiles, solid
}

unit: {
  health, maxHealth, x, y, velocityX, velocityY,
  shootX, shootY, shooting, boosting, mining, mineX, mineY,
  buildX, buildY, speed, ammo, ammoCapacity, armor, shield,
  flag, controlled, payloadCount, totalPayload, payloadCapacity,
  building?, breaking?, payloadType?, controller?, firstItem?,
  selectedBlock?, selectedRotation
}

building: {
  totalItems, firstItem?, totalLiquids, totalPower,
  itemCapacity, liquidCapacity, powerCapacity,
  powerNetIn, powerNetOut, powerNetStored, powerNetCapacity,
  ammo, ammoCapacity, currentAmmoType, memoryCapacity,
  heat, shield, armor, efficiency, progress, timescale, enabled,
  controlled, payloadCount, totalPayload, payloadCapacity,
  maxUnits, buildX, buildY, config?, payloadType?
}
```

这些值直接来自 `Senseable.sense(LAccess)` / `senseObject(LAccess)`；不支持该字段的对象会省略字段，而不是返回 0。`unit.x/y`、`mineX/Y`、`buildX/Y`、`shootX/Y` 和 `entity.x/y` 在本 API 中统一为 tile 坐标。`get_tile` 的 legacy `rotation` 是度数，`unit.shooting/boosting/mining/solid/dead` 等是逻辑风格 0/1 数值。
不暴露 `@client*`、`@links`、`@ipt` 或任意 settable 字段；所有读取仍受 team/fog 过滤。

### 4.0.1 `get_spawns`（固定波次出生点）

`POST /actions {"kind":"get_spawns"}`，无参数；只读。

返回：

```text
{
  spawns: [{
    x, y,                    // tile 坐标
    team, teamName,          // 通常是 waveTeam
    overlay,                 // 通常为 "spawn"
    discovered, visible,
    hidden
  }],
  count, returned, total, hidden,
  showSpawns, hideSpawns,
  fog,
  waveTeam, waveTeamName,
  dropZoneRadius,           // tile
  enemyCoreBuildRadius,     // tile
  polygonCoreProtection,
  unit: "tile",
  source: "WaveSpawner.getSpawns"
}
```

数据来源是 `WaveSpawner.getSpawns()` 中 `overlay == Blocks.spawn` 的固定地图出生点，
不是当前敌人位置，也不是随机刷怪点。

建造保护字段：

- `dropZoneRadius`：出生点/空投区半径（tile）；用于判断单位和出生点附近的行为。
- `enemyCoreBuildRadius`：敌方核心的禁止建造半径（tile）；`Build.validPlace`
  在敌方核心保护圈内会拒绝放置。
- `polygonCoreProtection`：地图是否使用多边形/最近核心保护模式；此时限制可能不是
  简单的圆形半径，仍需用 `get_tile` 的 `canPlace/placeReason` 验证。

`get_tile` 传 `block/rotation` 做预检时，若放置因敌方核心保护圈失败，`placeReason`
会返回 `enemy_core_build_radius`；其他地形/占用原因仍优先返回 `liquid/solid/occupied`。

可见性：

- fog 关闭：返回全部固定出生点；`showSpawns`/`hideSpawns` 只反映 minimap 规则。
- fog 开启：默认只返回 `visible=true` 的点；若规则没有隐藏 minimap 出生点
  （`hideSpawns=false`），则这些点对玩家可见，仍可返回并带 `visible` 标记。
- `hidden` 是被省略的不可见点数；不返回其坐标。
- 出生点被敌人核心替换/地图编辑变化时以当前 `WaveSpawner` 内容为准。

`get_spawns` 的 `x/y`、`dropZoneRadius` 和 `enemyCoreBuildRadius` 都是 tile；
直接传给 `query_area`/`get_area` 即可，不需要再乘 8。

### 4.1 `config` 形状

`get_tile.config` 是只读视图：

| 游戏类型 | JSON |
|---|---|
| `Item` / `UnlockableContent` | 内容名字符串 |
| `Point2` | `{x,y}` |
| `Point2[]`（电力节点连线） | `[{x,y}, ...]` |
| `byte[]`（处理器代码） | 小写 hex 字符串 |
| `Number` | number |
| `Boolean` | boolean |
| `String` | string |
| `Object[]` | 递归数组 |
| 未知类型 | `{type:"完整类名", value:"摘要"}` |

`drillSpeeds[].itemsPerSecond` 是**满覆盖**速率：`60 / (drillTime + hardnessDrillMultiplier * hardness) * coverageTiles`；
实际矿格数为 `covered` 时约为 `itemsPerSecond * covered / coverageTiles`，液体 booster 再乘
`boostMultiplier`。`coverageTiles` 默认 `size*size`。

`get_config_schema` 返回：

```text
{ block, configurable, configReadable, fields[], plans[], note }
```

字段类型：`item`、`string`、`boolean`、`integer`、`array`。`unloader` 的 `value`
是 `item`，写入用 `{"item":"coal"}` 或裸名字；`sorter` 也用 item。`power-node` 的 `links`
是只读 `[{x,y}]`；`UnitFactory` 的 `plans[]` 是:

```text
{ index, unit, requirements[{item,amount}], time, available }
```

`Reconstructor` 的 `plans[]` 是 `{base,upgrade,available}`；它不是可选择的生产方案。
`UnitAssembler` 的 plans 包含 `unit/requirements/payloadRequirements/liquids/time`。

`configure` 的写入形状与读回形状不同：

```text
item     -> {"item":"copper"}   （sorter 也接受裸字符串 "copper"）
liquid   -> {"liquid":"water"}
block    -> {"block":"conveyor"}
unit     -> {"unit":"dagger"}
point    -> {"x":12,"y":34}
boolean/number/string -> 原类型
```

`get_tile.config` 读回的是名字字符串；不要不经包装直接把读回值回写到
`configure.value`。未知的 item/liquid/block/unit 返回 `not_found`，不是
`internal_error`。

## 4.1 `get_content`（核心数据库的只读镜像）

`GET /content?type=blocks|units|items|liquids&query=&limit=` 返回内容列表。v0.3.0 起
`blocks[]`/`units[]`/`items[]`/`liquids[]` 的每一项都带 `id` 和 `meta`，来自游戏
`UnlockableContent` / 核心数据库使用的同一套字段：

```text
id, name, meta: {
  localizedName, description, details, detailsLocked,
  databaseCategory, databaseTag,
  unlocked, unlockedNowHost, alwaysUnlocked,
  banned, hidden, hideDatabase, credit
}
```

`id` 是内容注册表的稳定数字键；`name` 不保证唯一，尤其是 mod 单位
`mindustry-agent-ai-alpha/beta/gamma` 可能以同一 name 出现多个注册项。
`/content` 会按 id 去重 units；需要跨接口引用时优先使用 `(type,id)`。
`type` 必须是 `all|blocks|units|items|liquids`，未知 type 返回 400 `bad_request`。

响应还带：

```text
counts:    {blocks,units,items,liquids}   // 过滤后、截断前的总数
returned:  {blocks,units,items,liquids}
truncated: {blocks,units,items,liquids}   // limit>0 且 counts>returned
```

省略 `limit` 返回全量；`limit` 只是采样上限（最大 500），不是分页 cursor。

- `unlocked`：本地/客户端已解锁；`unlockedNowHost`：当前对局实际可用（战役按
  `unlockedHost`，非战役通常为 true）；
- `banned`：当前规则是否禁用该方块/单位（核心数据库显示红叉）；
- `hidden/hideDatabase`：是否从数据库/UI 隐藏；
- `detailsLocked`：`details` 因未解锁而被隐藏；
- 核心数据库 UI 的“参数”还包括 `Stats` 显示值（攻击、生产、电力等），
  这些是 UI 渲染值；`/content` 现在只把**有直接公开字段**的稳定子集放进
  `parameters`，不返回任意 `StatValue` 的完整结构；需要精确运行态时，优先读
  `get_tile`、`/capabilities` 和 `get_content.parameters`。

`blocks[]` 额外有 `size,health,requirements,researched,researchCost`；
`units[]` 额外有 `health,flying,playerControllable,researched,researchCost`。

`items[]` 额外有 `parameters`：

```text
parameters: {
  hardness, explosiveness, flammability, radioactivity, charge,
  cost, healthScaling, lowPriority
}
```

`liquids[]` 额外有 `parameters`：

```text
parameters: {
  gas, flammability, temperature, heatCapacity, viscosity,
  explosiveness, blockReactive, coolant, moveThroughBlocks,
  incinerable, boilPoint, hidden, effect
}
```

### 4.2 `parameters`（核心数据库参数的常用子集）

每个 block/unit 还有 `parameters`，只把最常用的数值做成稳定字段；缺省字段表示该
方块/单位类型没有这项能力，不是 `0` 的同义词。

方块：

```text
parameters: {
  role: "drill|pump|turret|core|unit-factory|factory|power|conveyor|wall|logic|block",
  functional: { hasItems, hasLiquids, hasPower, consumesPower, outputsPower,
                requiresOre, requiresLiquidFloor, configurable },
  buildTimeTicks, itemCapacity, coverageTiles?, boostMultiplier?,
  inputs?: [{item?,liquid?,amount,amountPerSecond?,optional,booster}], // item amount=配方用量, liquid amount=每 tick 用量
  outputs?: [{item,amount,chance?,weight?}], // chance/weight 目前用于 Separator 类随机产出
  liquidOutputs?: [{liquid,amount,perSecond}],
  drillTier?: number, drillTimeTicks?: number, hardnessDrillMultiplier?: number,
  blockedItems?: string[],
  drillSpeeds?: [{floor,item,hardness,drillTier,drillTimeTicks,speedMultiplier,
                  secondsPerItem,itemsPerSecond,coverageTiles,boostMultiplier,presentInWorld}],
  pumpAmountPerTick?: number, liquidPerSecond?: number, liquidSource?: string,
  turret?: { maxAmmo, ammoPerShot, reloadTicks, range, minRange, targetAir, targetGround,
             ammoTypes?: [{item?,liquid?,ammoMultiplier,ammoPerItem,reloadMultiplier,rangeChange,
                           damage,splashDamage,lifetime,speed,collidesAir,collidesGround,bullet}] },
  beltSpeed?, itemsPerSecond?; // conveyor 带速
  power?: { usagePerTick, usePerSecond, capacity, buffered },
  powerProductionPerSecond?,
  craftTimeTicks?, craftsPerSecond?,
  drillTimeTicks?, hardnessDrillMultiplier?,
  beamRangeTiles?,
  laserRangeTiles?,
  pumpAmountPerTick?, liquidPerSecond?
}
```

- `power.usePerSecond` 是 `consPower.usage * 60`；`usagePerTick` 是每 tick 消耗。
- `powerProductionPerSecond` 是 `PowerGenerator.powerProduction * 60`。
- `craftTimeTicks` 是游戏 tick；`craftsPerSecond = 60 / craftTimeTicks`。
- `outputs` 是 `[{item,amount}]`；`drillTimeTicks` 不等于实际秒数，实际钻孔速度还受
  `hardnessDrillMultiplier`、矿物硬度、覆盖格数、液体/加速影响。
- `pumpAmountPerTick` / `liquidPerSecond` 只对泵类方块出现。

单位：

```text
parameters: {
  speed, buildSpeed, mineSpeed, mineTier, mineRange,
  itemCapacity, payloadCapacity, canBoost, armor, health, weapons[].damage,
  weapons: [{
    name, reloadTicks, display, controllable, rotate, inaccuracy, shootCone,
    range, shotsPerSecond, dpsEstimate,
    bullet: { type, damage, splashDamage, splashDamageRadius,
              speed, lifetimeTicks, range, hitSize, pierce, pierceCap }
  }]
}
```

**“单位武器”是什么**：Mindustry 的 `UnitType.weapons` 是一个 `Weapon` 列表，一个单位
可以有 0..N 个武器挂点。每个 `Weapon` 代表一套武器，不是一个抽象伤害值：
`bullet` 决定弹种/直接伤害/溅射/速度/射程，`reloadTicks` 决定射速，`shotsPerSecond`
和 `dpsEstimate` 是游戏公式的估算值；`mirror`/`alternate` 还可能导致镜像双武器。
`dpsEstimate` 不含目标护甲、命中率、buff、地形和单位速度，只能用于横向比较。

这些都是 `v0.3.0` 的常用参数；核心数据库 UI 还会显示更多 `StatValue`（例如状态效果、
液体消耗、建造范围等），那些尚未全部 JSON 化。精确运行态优先用 `get_tile`、
`get_capabilities`、`/context.power`。

### 4.3 `get_tech_tree`（全量/分支）

```text
POST /actions {"op":"get_tech_tree","flat":true,"offset":0,"limit":500}
```

响应：

```text
{ nodes[], count, returned, total, offset, nextOffset, truncated }
```

每个 node：

```text
{ content, name, depth, planet, sector, parent, children[],
  requirements[], objectives[], requiresUnlock, researched, unlocked, blockedReason }
```

- `flat=true` 用 `TechTree.all` 返回全量节点，可按 `offset/nextOffset` 分页；
  `limit` 上限 500；普通根查询仍按树分支递归。
- `depth` 是 TechTree 节点深度，不是物品 tier；同一物品可能有多个不同深度的 producer。
- `planet`/`sector` 来自 TechTree 节点和 `SectorPreset`；根节点用根名（如 `serpulo`）
  作为 planet 回退。
- 物品本身不是 TechTree 节点；用 producer block 的 `depth` 和 `inputs/outputs` 推导。
- `researched` 在测试 fixture 下可能全为 false、`unlocked=true`，真实战役进度要结合
  `rules.researched` 解读。

## 5. `query_area`

```text
{ x, y, requestedRadius, radius,
  truncated:{radius,units,buildings},
  units[], buildings[] }
```

`buildings[]`：

```text
{ id, block, team, x, y, tileX, tileY, health, maxHealth, rotation,
  itemList?, ammoTotal? }
```

`itemList` 是 `[{item,amount}]`。`includeUnits/includeBuildings` 默认 true；
`includeEnemies` 默认 false；`radius` 上限 32 tile，单位/建筑上限各 64 条。
`x/y`、`radius`、`units[].x/y`、`buildings[].x/y` 都是 tile；`tileX/tileY` 是
便于对照的整数 tile。

## 6. action / op 结构

动作立即返回：

```text
{ opId, status, progress, data, paused }
```

`status` 枚举：`queued`、`running`、`done`、`failed`、`cancelled`。
`get_action_result` 的 `data.code` 常见值：

```text
timeout, assistant_gone, target_gone, build_dropped,
insufficient_resources, invalid_placement, out_of_range, success
```

`build_plan` 返回 `{status, data:{results[]}, paused, allowPartial, opId?}`；
逐块结果可能是 `{ok, x, y, block, data, warnings?}` 或
`{ok:false,error:{code,message}}`。目标格已有同种方块会返回
`{ok:true,built:true,alreadyPresent:true}`，这是幂等成功，不是重复建造失败。
`ItemBridge`（bridge-conveyor）可用 `length`（tile）生成跨格配置；回读 `get_tile.config`。传送带成功项可能有 `warnings[]`，例如
`output_blocked`、`output_faces_air`、`output_faces_back`、`output_out_of_bounds`；
warnings 不是失败，但通常意味着带线不会按预期运输。
`deconstruct` 的 `data` 是 `{targets[], skipped[], requested}`；`targets` 中的
`{x,y,status}` 只有 `done|pending`，`skipped` 是 `{x,y,reason}`，不是目标状态。
允许拆除的地形道具由 `Build.validBreak` 和 `allowEnvironmentDeconstruct` 决定。
多格建筑的动作目标接受 origin、中心或任意覆盖格；`query_area`/`entity` 的 `x/y`
是中心（可能是小数 tile），`tileX/tileY` 是原点；`build_plan` placement 用原点。

## 7. 事件

公共事件信封：

```text
{ id, type, tick, timeMs, data{} }
```

`type` 及 `data`：

| type | data |
|---|---|
| `unit_create` | `unitId,type,team,x,y` |
| `unit_destroy` | `unitId,type,team,x,y` |
| `unit_damage` | `unitId,health,x,y` |
| `block_destroy` | `x,y,block,team` |
| `block_build_end` | `x,y,block,team,breaking` |
| `build_damage` | `buildingId,x,y,health` |
| `game_pause` / `game_resume` | `paused,tick,source?` |
| `wave_start` | `wave,enemies,winWave,tick` |
| `wave_end` | `wave,next,tick` |
| `test` | 调试发送的任意对象 |

有迷雾时，实体事件在入队时按助手队伍可见性过滤；`wave_*`/暂停事件仍可能全局出现。
事件日志有 FIFO 上限；使用 `since`/`types`/`next`，不要假设一次全量。
`wave_start.data.enemies` 是事件时刻 `waveTeam` 的敌军单位数，不是刷怪前的
`state.enemies`。

## 8. 错误码与门控

HTTP 层：

```text
400 bad_request | invalid query | invalid_placement | ...
401 unauthorized
403 forbidden (session action 不在白名单)
404 not_found | unit_not_found | building_not_found
409? 不保证；以 code 为准
410 ref_expired (data token / map revision)
413 request too large
429 rate_limited
503 no_world | op_capacity | execution_unknown/not_executed
504 execution_unknown
```

写动作在暂停时返回 `game_paused`；本局已结束时写动作返回 `game_over`，
客户端应停止重试并等待玩家重新加载世界；`pause` 被规则禁止时返回 `pause_disabled`；
能力不足返回 `cannot_build`/`cannot_repair`/`not_configurable`/`block_locked`；`repair` 只在 `UnitType.canHeal` 身体上可用，Alpha/Beta/Gamma builder body 返回 `cannot_repair`；距离错误为 `out_of_range`。
`withdraw` 细分为 `target_not_found`/`item_not_found`/`hand_busy`/`hand_full`/`out_of_range`；
`deposit` 细分为 `target_not_found`/`item_not_carried`/`receiver_rejects`/`out_of_range`。
错误 JSON 形状是 `{code,message}`，但 HTTP 层的 401/403/413 可能是纯文本。

## 9. 枚举速查

- rotation：`0 east / 1 south / 2 west / 3 north`
- control.mode：`unit | building`
- payload.type：`unit | block | payload`
- action.status：`queued | running | done | failed | cancelled`
- `includeEnemies`：boolean，默认 false（只影响 `query_area`/`get_context`）
- stance：`stop | holdFire | pursueTarget | patrol | ram | boost | holdPosition | mineAuto`
- command：`move | stop | attack | repair | rebuild | assist | mine | enterPayload |
  loadUnits | loadBlocks | unloadPayload | loopPayload`
- build target：`{x,y}`（tile）或 `{target:{buildingId|x,y}}`（动作接口）

## 10. 迷雾契约（v0.3.0）

当 `rules.fog=true` 时：

- `get_tile`/`get_area` 对未发现 tile 返回 `discovered:false, hidden:true`；
  对已发现但当前不可见的 tile 返回地形/矿，但 `block:"hidden", team:-1`，不返回建筑库存/config。
- `query_area`、`get_context.threats`、`get_unit` 过滤当前不可见的敌方单位/建筑。
- `get_map_manifest` 的地图快照在迷雾下只写入已发现的地形，未发现/不可见的 block/team/solid 为 0；
  manifest 带 `fog` 和 `visibility:"assistant-team"`。
- `manifest.schema.blocks` 是 `{blockName: blockId}` 映射，和 `items`/`dropIds` 一样用于解码
  `block_id`；`/content?type=blocks` 的每项也有同一个 `id`。不要用数组下标推断 block id。
- `power` 只汇总助手队伍；事件按可见性入队。
- `get_context.rules.fog/staticFog` 可读；不要假设所有模式都有迷雾。

注意：助手队伍如果是游戏认为的 AI 队伍，Mindustry 的 `FogControl` 可能把该队伍视为
不需要迷雾；这是游戏规则，不是 API 绕过。实际对局以 `rules.fog` 和返回的 `hidden` 为准。
