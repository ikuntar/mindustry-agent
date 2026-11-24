# API 数据契约（实体结构、字段与枚举）

状态：2026-11-24，Mindustry v160.8 / AI Probe 0.1.1。  
用途：给 harness 和 LLM 一个**字段级**参考；实际字段随版本可能增加，客户端按字段名读取，
不要把 JSON 顺序、数组长度或未列出的字段当成稳定契约。

## 1. 通用约定

- 坐标：
  - `get_tile`、`build_plan`、`deconstruct`、`configure`、`mine` 使用 **tile** 坐标。
  - `get_area`、`query_area`、`move_to`、`attack` 的 `x/y` 使用 **世界像素**（默认 8 px/tile）。
  - `get_area.coverage.next` 是 tile 坐标，并带 `unit:"tile"`。
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
  version, tick, timeMs, map, worldWidth, worldHeight,
  wave, wavetime, waveTimer, enemies,
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

### 3.1 `assistant`

```text
id, type, team, x, y, health, maxHealth, dead,
isAI, isPlayer, spawnedByCore, isHome, possessing, homeBodyId,
item, itemAmount, boosting, payloads[], payloadUsed
```

`isHome=true` 表示当前是 home body；`possessing=true` 表示控制的是借体。
`item` 是当前携带物品名，`itemAmount` 是数量。

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
{ team, id, produced, needed, balance, stored, capacity, satisfaction }
```

只汇总助手当前队伍的电力网络；`satisfaction` 是 0..1，读取失败为 `-1`。

### 3.9 `rules`

```text
{ modeName, fog, staticFog, mission, waveTimer, waveSending, waves, winWave,
  buildSpeedMultiplier, deconstructRefundMultiplier, buildCostMultiplier,
  blockHealthMultiplier, unitBuildSpeedMultiplier,
  objectives[], objectiveFlags[], researched[],
  sector?: { id, name, preset, captureWave, wasCaptured } }
```

`fog/staticFog` 是只读规则；`wasCaptured` 是战役区域状态。
campaign 占领不一定置 `won=true`，优先看 `captured` / `sector.wasCaptured`。

## 4. tile 结构

`get_tile`：

```text
{ x, y, discovered, hidden,
  floor, overlay, liquid, drop, block, team, solid,
  canPlace?, placeReason?,
  health?, maxHealth?, rotation?, efficiency?, progress?, warmup?, enabled?,
  items?, ammoTotal?, config?
}
```

`get_area` 的 `tiles[]` 使用相同字段（不含 `canPlace` 预览，除非单独调用 `get_tile`）。
隐藏态只保证 `x/y/discovered/hidden`，其余字段不可用于决策。

- `block`：内容名，空气为 `air`，隐藏为 `hidden`；
- `team`：数字 id，`-1` 表示未知/隐藏；
- `rotation`：`0=east, 1=south, 2=west, 3=north`；
- `drop`：该 tile 的矿物名，`""` 表示无矿；
- `solid`：块是否阻挡地面单位；
- `efficiency`：0..1；`progress/warmup` 是 0..1；`enabled` 是逻辑/开关状态；
- `items`：`[{item,amount}]`，不是对象；
- `ammoTotal`：炮塔当前弹药总量。

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

`get_config_schema` 返回：

```text
{ block, configurable, configReadable, fields[], plans[], note }
```

字段类型：`item`、`string`、`boolean`、`integer`、`array`。`power-node` 的 `links`
是只读 `[{x,y}]`；`UnitFactory` 的 `plans[]` 是:

```text
{ index, unit, requirements[{item,amount}], time, available }
```

`Reconstructor` 的 `plans[]` 是 `{base,upgrade,available}`；它不是可选择的生产方案。
`UnitAssembler` 的 plans 包含 `unit/requirements/payloadRequirements/liquids/time`。

## 4.1 `get_content`（核心数据库的只读镜像）

`GET /content?type=blocks|units|items|liquids&query=&limit=` 返回内容列表。v0.1.1 起
`blocks[]`/`units[]`/`items[]`/`liquids[]` 的每一项都带 `meta`，来自游戏
`UnlockableContent` / 核心数据库使用的同一套字段：

```text
meta: {
  localizedName, description, details, detailsLocked,
  databaseCategory, databaseTag,
  unlocked, unlockedNowHost, alwaysUnlocked,
  banned, hidden, hideDatabase, credit
}
```

- `unlocked`：本地/客户端已解锁；`unlockedNowHost`：当前对局实际可用（战役按
  `unlockedHost`，非战役通常为 true）；
- `banned`：当前规则是否禁用该方块/单位（核心数据库显示红叉）；
- `hidden/hideDatabase`：是否从数据库/UI 隐藏；
- `detailsLocked`：`details` 因未解锁而被隐藏；
- 核心数据库 UI 的“参数”还包括 `Stats` 显示值（攻击、生产、电力等），
  这些是 UI 渲染值，当前 `/content` 不返回任意 `StatValue` 的完整结构；
  需要精确战斗/生产参数时，优先读 `get_tile` 的运行时字段和 `/capabilities`。

`blocks[]` 额外有 `size,health,requirements,researched,researchCost`；
`units[]` 额外有 `health,flying,playerControllable,researched,researchCost`。

### 4.2 `parameters`（核心数据库参数的常用子集）

每个 block/unit 还有 `parameters`，只把最常用的数值做成稳定字段；缺省字段表示该
方块/单位类型没有这项能力，不是 `0` 的同义词。

方块：

```text
parameters: {
  buildTimeTicks, itemCapacity,
  power?: { usagePerTick, usePerSecond, capacity, buffered },
  powerProductionPerSecond?,
  craftTimeTicks?, craftsPerSecond?, outputs?,
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
  itemCapacity, payloadCapacity, canBoost,
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

这些都是 `v0.1.1` 的常用参数；核心数据库 UI 还会显示更多 `StatValue`（例如状态效果、
液体消耗、建造范围等），那些尚未全部 JSON 化。精确运行态优先用 `get_tile`、
`get_capabilities`、`/context.power`。

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
`includeEnemies` 默认 false；`radius` 上限 256 px，单位/建筑上限各 64 条。

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
逐块结果可能是 `{ok, x, y, block, data}` 或 `{ok:false,error:{code,message}}`。
`deconstruct` 的 `data` 是 `{targets[], skipped[], requested}`；`targets` 中的
`{x,y,status}` 只有 `done|pending`，`skipped` 是 `{x,y,reason}`，不是目标状态。

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

写动作在暂停时返回 `game_paused`；`pause` 被规则禁止时返回 `pause_disabled`；
能力不足返回 `cannot_build`/`not_configurable`/`block_locked`；距离错误为 `out_of_range`。
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

## 10. 迷雾契约（v0.1.1）

当 `rules.fog=true` 时：

- `get_tile`/`get_area` 对未发现 tile 返回 `discovered:false, hidden:true`；
  对已发现但当前不可见的 tile 返回地形/矿，但 `block:"hidden", team:-1`，不返回建筑库存/config。
- `query_area`、`get_context.threats`、`get_unit` 过滤当前不可见的敌方单位/建筑。
- `get_map_manifest` 的地图快照在迷雾下只写入已发现的地形，未发现/不可见的 block/team/solid 为 0；
  manifest 带 `fog` 和 `visibility:"assistant-team"`。
- `power` 只汇总助手队伍；事件按可见性入队。
- `get_context.rules.fog/staticFog` 可读；不要假设所有模式都有迷雾。

注意：助手队伍如果是游戏认为的 AI 队伍，Mindustry 的 `FogControl` 可能把该队伍视为
不需要迷雾；这是游戏规则，不是 API 绕过。实际对局以 `rules.fog` 和返回的 `hidden` 为准。
