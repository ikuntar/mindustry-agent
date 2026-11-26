# Mindustry 逻辑处理器指南

面向使用逻辑处理器（Logic Processor）的 AI/harness。这里描述的是**游戏内可编程逻辑方块**的用法，不是 session HTTP API 的替代品。

版本基线：Mindustry v160.8，Serpulo / 通用逻辑。具体解锁、规则和方块可用性以当前对局为准。

---

## 1. 逻辑处理器是什么

逻辑处理器是玩家可以放置、连线、写程序并由游戏每 tick 执行的方块。它通过 `sensor` 读取游戏对象、通过 `control`/`ucontrol` 修改对象，通过 `radar`/`ulocate` 搜索对象，通过 memory 保存状态，通过 display 输出。

常见方块：

```text
micro-processor        小型处理器，链接相邻方块
world-processor        世界处理器，可执行部分特权指令
memory-cell            记忆格
memory-bank            记忆库
switch                 玩家/逻辑可切换开关
message                显示消息
logic-display          小型逻辑显示屏
large-logic-display    大型显示屏
canvas                 画布
tileable-logic-display 可拼接显示
```

处理器通过连线（links）访问方块：

```text
@links                 当前 links 数量
getlink result index   取得第 index 个链接方块
@ipt                   当前处理器每 tick 可执行的指令数
@this / @thisx / @thisy 当前处理器/坐标
```

不要把 `@links`、`@ipt`、`@thisx/@thisy` 和 `getlink` 当成全局世界坐标；它们是处理器自身上下文。

---

## 2. 执行模型和时间

逻辑程序按行执行，处理器每 tick 执行最多 `@ipt` 条指令。`jump` 改变下一条指令位置；`end` 结束本次执行；`wait` 暂停若干秒。

```text
@tick       当前游戏 tick
@time       游戏内毫秒，等于 @tick / 60 * 1000
@second     游戏内秒，@tick / 60
@minute     游戏内分钟，@tick / 3600
@waveNumber 当前波次
@waveTime   距离下一波的秒数（state.wavetime / 60）
@mapw/@maph 地图宽高（tile）
@server     当前是服务器/单机为 1
@client     当前是客户端为 1
```

注意：

- `@time` 不是墙钟时间；不要和 HTTP API 的 `timeMs` 混用。
- `@waveTime` 是秒；API 的 `context.wavetime` 是 tick，`context.waveSeconds` 才是逻辑单位。
- `wait 1` 是等待约 1 秒（按 tick 推进），暂停时不会推进。
- 程序没有函数调用；用 `set`/`op`/`jump` 组合。变量默认是数字或对象；`null` 是空对象。

---

## 3. 基本语法

一条语句通常由关键字和空白分隔的参数组成：

```text
set result 0
op add result a b
jump 4 lessThan result 10
sensor health block1 @health
control enabled block1 0
```

常用集合：

```text
set var value
op <运算> result a b
jump <行号> <条件> a b
select result <条件> a b trueValue falseValue
wait seconds
stop
end
```

条件包括 `equal`、`notEqual`、`lessThan`、`lessThanEq`、`greaterThan`、`greaterThanEq`、`strictEqual`、`always`。

`op` 常见运算：`add`、`sub`、`mul`、`div`、`idiv`、`mod`、`pow`、`equal`、`notEqual`、`land`、`lor`、`shl`、`shr`、`max`、`min`、`angle`、`len`、`noise`、`abs`、`log`、`log10`、`floor`、`ceil`、`sqrt`、`rand`、`sin`、`cos`、`tan`、`asin`、`acos`、`atan`。

对象值可以直接赋值：

```text
set target @unit
set block1 turret1
```

内容常量用 `@` 前缀：

```text
@copper @lead @graphite @silicon @titanium @thorium
@water @slag @oil @cryofluid
@dagger @flare @mace ...
@conveyor @duo @combustion-generator ...
```

---

## 4. 全局变量

```text
@time @tick @second @minute
@waveNumber @waveTime
@mapw @maph
@server @client
@this @thisx @thisy @links @ipt
@unit
@counter
@pi @e @degToRad @radToDeg
@blockCount @unitCount @itemCount @liquidCount
@ctrlProcessor @ctrlPlayer @ctrlCommand
```

- `@blockCount/@unitCount/@itemCount/@liquidCount` 是**已加载内容类型数量**，不是地图上当前实体数量。
- `@unit` 是 `ubind` 之后绑定的单位；不是“所有单位”。
- `@counter` 可作为跳转/循环状态读取；通常由 `jump` 维护。
- `@client*`（`@clientUnit`、`@clientName`、`@clientTeam`、`@clientLocale`、`@clientMobile`）是客户端/特权变量，不应作为服务器逻辑的通用输入。

---

## 5. `sensor`：读取对象字段

语法：

```text
sensor <结果变量> <对象变量/链接> <字段>
```

例子：

```text
sensor hp block1 @health
sensor max block1 @maxHealth
sensor items block1 @totalItems
sensor copper block1 @copper
sensor angle @unit @rotation
```

### 5.1 通用字段

对 Unit 和 Building 通常都可用：

```text
@health @maxHealth @dead @team @type @id @name
@x @y @rotation @size @solid @range
@flag @controlled @controller
```

`@x/@y` 在逻辑里是 **tile 坐标**（不是世界像素）；`@range` 单位是 tile。`@size` 是方块边长/单位占用大小（tile）。

### 5.2 单位字段

```text
@velocityX @velocityY
@shootX @shootY @shooting
@boosting
@mining @mineX @mineY
@buildX @buildY @building @breaking
@speed @ammo @ammoCapacity
@armor @shield
@payloadCount @payloadType @totalPayload @payloadCapacity
@selectedBlock @selectedRotation
```

说明：

- `@mineX/@mineY` 是正在挖的 tile 坐标；未挖矿时通常为 `-1`。
- `@building/@breaking` 是对象（目标建筑），不是数字。
- `@payloadType` 是 payload 内的内容对象。
- `@controlled` 是控制类型码：`@ctrlProcessor`、`@ctrlPlayer`、`@ctrlCommand` 或 `0`。
- `@controller` 是控制器对象，不一定是内容名。

### 5.3 建筑字段

```text
@totalItems @firstItem
@totalLiquids @totalPower
@itemCapacity @liquidCapacity @powerCapacity
@powerNetStored @powerNetCapacity @powerNetIn @powerNetOut
@ammo @ammoCapacity @currentAmmoType
@memoryCapacity
@heat @shield @armor
@efficiency @progress @timescale
@enabled @config
@payloadCount @payloadType @totalPayload @payloadCapacity
@maxUnits
```

注意：

- `@totalLiquids` 是**建筑内部液体总量**，不是地板液体；`@liquid` 不是这个字段。
- `@totalPower` 是该建筑自身存储的电力（受 `consPower.buffered` 影响），不是整个电网。
- `@powerNet*` 才是电网视图。
- `@firstItem` 和 `@config` 返回对象，不是数字。
- `@ammo`、`@currentAmmoType` 只对炮塔/弹药类建筑有意义；不是所有建筑都支持。
- 不支持某字段时，游戏会返回 `null`/无效值；不要把它当作 0。

---

## 6. `control`：写对象

语法和常用形式：

```text
control enabled block1 0
control shoot block1 x y shoot
control shootp block1 unit shoot
control config block1 value
control color block1 colorValue
```

- `enabled`：开关建筑。
- `shoot`：向世界坐标点射击；参数为 `x y shoot`。
- `shootp`：向单位/对象射击；参数为 `unit shoot`。
- `config`：写建筑配置（只对可配置建筑有效）。
- `color`：写颜色/发光类配置。

`LAccess` 还有一组 settable 字段（如 `x/y`、`velocity`、`health`、`team`、`flag` 等），但：

- 只对支持该字段的对象有效；
- 受 `privileged` / 世界处理器 / 规则限制；
- 很多字段不应由普通逻辑无条件写入。

逻辑处理器能写不等于玩家通常应该做；在自己的逻辑程序里也要检查对象类型、队伍和规则。

---

## 7. `radar` / `uradar`：搜索目标

### 7.1 建筑雷达

```text
radar enemy any any distance block1 1 result
```

参数顺序：

```text
radar <target1> <target2> <target3> <sort> <fromBuilding> <order> <output>
```

`target` 过滤器：`any`、`enemy`、`ally`、`player`、`attacker`、`flying`、`boss`、`ground`。
`sort`：`distance`、`health`、`shield`、`armor`、`maxHealth`。
`order`：`1` 升序，`0` 降序（以实际 UI 为准；用固定测试验证）。
`output` 是 Unit 对象；没有目标时为 `null`。

### 7.2 单位雷达

```text
uradar enemy any any distance 0 1 result
```

`uradar` 从当前绑定单位发起，不需要 `fromBuilding` 参数。

### 7.3 搜索不是全图全知

雷达有范围、队伍、目标类型和 `targetable` 限制；受单位/建筑自身能力约束。不能把它当成无条件全图扫描。

---

## 8. 单位和 `ucontrol`

### 8.1 绑定单位

```text
ubind @dagger
```

之后 `@unit` 指向被绑定单位；没有可用单位时为 `null`。不是所有单位都 `logicControllable`。

### 8.2 控制动作

```text
ucontrol idle
ucontrol stop
ucontrol move x y
ucontrol approach x y radius
ucontrol pathfind x y
ucontrol autoPathfind
ucontrol boost enable
ucontrol target x y shoot
ucontrol targetp unit shoot
ucontrol itemDrop to amount
ucontrol itemTake from item amount
ucontrol payDrop
ucontrol payTake takeUnits
ucontrol payEnter
ucontrol mine x y
ucontrol flag value
ucontrol build x y block rotation config
ucontrol deconstruct x y
ucontrol getBlock x y type building floor
ucontrol within x y radius result
ucontrol unbind
```

说明：

- `move/approach/target` 的坐标是 tile 坐标；
- `targetp` 的目标是 Unit 对象；
- `itemTake` 的 `from` 是建筑对象；
- `build` 的 `block` 是内容对象，`config` 是配置对象/值；
- `build`、`deconstruct` 等受规则和单位能力限制；
- `ucontrol stop` 只停止当前动作，不是停止处理器。

### 8.3 查找

```text
ulocate ore core true @copper outx outy found building
ulocate building core true outx outy found building
ulocate spawn true outx outy found building
ulocate damaged true outx outy found building
```

`ulocate` 的结果是坐标/建筑/`found` 变量；具体参数顺序按 UI 生成的语句为准。`ore` 使用 `@copper` 等物品内容。

---

## 9. 记忆格

```text
read result cell1 0
write value cell1 0
```

`cell1` 是链接的 memory-cell/memory-bank；最后一个是地址。地址从 0 开始，越界会被忽略。`@memoryCapacity` 可读取容量。

常见计数器：

```text
read n cell1 0
op add n n 1
write n cell1 0
```

记忆格适合跨 tick 保存状态；处理器变量在重新编译/重置时会丢失。

---

## 10. 显示器和绘制

```text
draw clear r g b
draw color r g b a
draw col colorValue
draw stroke width
draw line x1 y1 x2 y2
draw rect x y width height
draw lineRect x y width height
draw poly x y sides radius rotation
draw linePoly x y sides radius rotation
draw triangle x1 y1 x2 y2 x3 y3
draw image x y image rotation
draw print x y align text
draw translate x y
draw scale x y
draw rotate degrees
draw reset
drawflush display1
```

坐标是显示器内部像素；`@displayWidth/@displayHeight` 可读尺寸。`drawflush` 才把缓冲区刷新到显示屏。不要每 tick 无意义清屏/刷新；按需更新。

打印到 message：

```text
print "HP: "
print hp
printflush message1
```

`printflush` 的目标是 message/display 的链接对象。

---

## 11. 世界处理器和特权指令

以下语句只在特定方块/规则/权限下可用，普通 micro-processor 可能不可用或需要 world processor：

```text
getblock
setblock
spawn
status
weathersense / weatherset
spawnwave
setrule
message
cutscene
effect
explosion
setrate
fetch
sync
clientdata
getflag / setflag
setprop
playsound
setmarker / makemarker
localeprint
```

不要把“游戏有这条语句”当成“当前处理器能执行”。使用前检查：

- 方块是否是 world-processor；
- 服务器/客户端权限；
- `state.rules` 是否允许逻辑建造、单位建造、世界处理器；
- 多人服务器可能禁用逻辑或限制特权。

这些能力也不应该通过 session API 自动开放；它们是玩家/服务器规则边界。

---

## 12. 示例

### 12.1 读取单位血量并显示

```text
ubind @dagger
sensor hp @unit @health
sensor max @unit @maxHealth
op div pct hp max
print "HP "
print pct
printflush message1
```

### 12.2 雷达找敌人并让单位攻击

```text
ubind @dagger
uradar enemy any any distance 0 1 target
jump 0 equal target null
ucontrol targetp target 1
```

### 12.3 用传感器控制开关

```text
sensor power block1 @totalPower
jump 3 greaterThan power 0
control enabled block2 0
end
control enabled block2 1
```

### 12.4 记忆格计数器

```text
read count cell1 0
op add count count 1
write count cell1 0
```

### 12.5 根据核心物品控制传送带

```text
sensor copper core1 @copper
jump 3 lessThan copper 100
control enabled conveyor1 1
end
control enabled conveyor1 0
```

示例的变量名和链接名必须与你的实际处理器 links 对齐；链接顺序决定 `block1/core1` 指向什么。

---

## 13. 逻辑处理器与 session API 的名字映射

API 的 `get_unit.unit` 和 `get_tile.building` 子对象**故意使用 `LAccess` 名称**，方便从逻辑处理器迁移：

| 逻辑处理器 | Session API |
|---|---|
| `@tick` | `context.tick` |
| `@time` | `context.time`（游戏毫秒；`context.timeMs` 是墙钟） |
| `@second` / `@minute` | `context.second` / `context.minute` |
| `@waveNumber` | `context.wave` |
| `@waveTime` | `context.waveSeconds`（`context.wavetime` 是 tick） |
| `@mapw` / `@maph` | `context.worldWidth` / `context.worldHeight` |
| `@server` / `@client` | `context.server` / `context.client` |
| `sensor u @health` | `get_unit.unit.health`（或 `get_unit.entity.health`） |
| `sensor b @totalItems` | `get_tile.building.totalItems` |
| `sensor b @totalLiquids` | `get_tile.building.totalLiquids` |
| `sensor b @totalPower` | `get_tile.building.totalPower` |
| `sensor b @powerNetIn` | `get_tile.building.powerNetIn` |
| `sensor b @ammoCapacity` | `get_tile.building.ammoCapacity` |
| `sensor u @shooting` | `get_unit.unit.shooting` |
| `sensor u @mining` | `get_unit.unit.mining` |
| `sensor u @payloadCount` | `get_unit.unit.payloadCount` |

`get_context.logic` 还把这些常用全局量按逻辑名字再投影了一次：

```text
logic.time, logic.tick, logic.second, logic.minute,
logic.waveNumber, logic.waveTime, logic.mapw, logic.maph,
logic.server, logic.client
```

这样从逻辑处理器迁移时可以优先读 `logic.*`，不用记 `context.wave`/`waveSeconds` 的命名差异。

单位/建筑专属字段：

```text
get_unit.unit.*      LAccess 名称，x/y/mineX/mineY/buildX/buildY/shootX/shootY 是 tile 坐标
get_tile.building.*  LAccess 名称
get_unit.entity.*    id/type/name/team/x/y/health/maxHealth/dead/rotation/size/rangeTiles/solid
get_tile.entity.*    building 的同一套通用字段
```

差异：

- API 的 `entity.x/y` 和逻辑的 `@x/@y` 都是 tile 坐标；API 的 `x/y` 可能带小数。
- API 用 `get_spawns` 读固定波次出生点；逻辑处理器用 `ulocate spawn` 查找离单位最近的出生点；API 的 `spawns[].x/y` 是 tile。
- API 用 `get_area`/`query_area` 做空间搜索；逻辑用 `radar`/`uradar`/`ulocate`，但 API 受 fog/team 过滤。
- API 的 `move_to`/`attack`/`configure` 是显式动作；逻辑的 `ucontrol`/`control` 是处理器程序内的写操作。两者权限模型不同。
- API 没有 `@client*`、`@links`、`@ipt`、处理器内存内容，也没有任意 settable 字段；不要假设所有 `LAccess` 都能通过 API 读/写。

---

## 14. 调试

- 用 `print` + `printflush` 到 message 看变量。
- 用 `@ipt` 确认每 tick 指令预算；处理器过载时程序看起来“慢”。
- 用 `@links`/`getlink` 确认链接顺序；链接对象错位是最常见 bug。
- 用 `wait` 控制刷新频率，不要每 tick 刷显示。
- 用 memory 保存跨 tick 状态。
- 处理 `null` 目标：`jump ... equal target null` 后再使用对象，避免无效 `sensor/control`。
- 逻辑程序不停止整个游戏；一个处理器出错不会让 API/游戏 tick 停止。

---

## 15. 和 session API 的边界

逻辑处理器是玩家在游戏内写的程序；session API 是外部 harness 观察/控制助手的接口。

- 逻辑处理器可以读自己链接/雷达能拿到的对象；API 仍要遵守 fog/team 可见性。
- 逻辑处理器可以写部分对象；API 不自动开放这些写权限，仍走显式 action。
- 逻辑处理器能读的字段比 API 多，不代表 API 应该暴露全部；`@client*`、处理器内部量、世界处理器特权字段要单独决定。
- 如果 AI 要在逻辑处理器和 API 之间迁移，优先复用 `LAccess` 字段名和 `unit`/`building` 子对象，不要依赖 `@` 前缀、设备链接顺序或 UI 文案。
