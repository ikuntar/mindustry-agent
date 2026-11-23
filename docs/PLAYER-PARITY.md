# 玩家能力对齐（Player Parity）需求记录

状态：本轮实现（2026-11-23）：`respawn`/`possess`/`pause`/`resume`/`command_units`/`control_building`/`release_building`/`boost`/`pickup_payload`/`drop_payload`/`get_config_schema`/`get_tech_tree` 已接入 session；仅保留明确不做的元层/跨区域项。
关联：`docs/ASSISTANT-DESIGN.md`、`docs/OPEN-QUESTIONS.md`、`TASKS.md`

本文记录“规则内玩家能做、AI 还缺什么”，以及已经核对过的 Mindustry v160.8
机制。先把语义和边界定清楚，避免直接照抄一个不存在的 API。

## 1. 入口与现状

正常 AI 入口是 mod 内 session API（以及 `/mcp` 的同一套工具），当前 34 个：

```text
get_context, get_area, get_tile, query_area, get_unit, list_unit_types,
move_to, attack, mine, build_plan, withdraw, deposit, configure, research,
deconstruct, repair, set_stance, release, follow,
get_action_result, cancel, stop, possess, respawn, pause, resume, command_units,
get_config_schema, get_tech_tree, control_building, release_building, boost, pickup_payload, drop_payload
```

另有 `/content`、`/capabilities`、`/guide`、`/events/wait`、`/data` 等读接口。

旧 Node MCP 27 工具和 raw probe 调试面保留测试入口；本文列出的 34 个工具才是
产品 session 契约。旧调试入口不等于正式权限，`possess`/`respawn`/`pause`/
`resume`/`command_units` 等已进入 session。

## 2. 已确认的修正

### 2.1 `possess` 是什么

当前 mod 的 `possess` 不是“玩家点一下建筑”，而是：

```text
助手当前控制一个 home body
  -> 选中同队、AI 控制、playerControllable 的单位
  -> 保存目标原 controller
  -> 目标 controller 换成 ProbeController
  -> assistant 指向目标，home body despawn
```

`release` 把目标 controller 恢复，并重新从核心生成 home body。

它不是：

- `command_units`：指挥别的单位，不改变助手自己的身体
- 玩家原版 `unitControl`：玩家控制单位，但单位仍是 Player controller
- 建筑控制：建筑控制使用 `ControlBlock` / `BlockUnitc`，不是普通 Unit

### 2.2 建筑控制必须单独建模

原版 `ControlBlock` 接口提供 `unit()`、`canControl()` 等；v160.8 中已确认
`TurretBuild` 实现 `ControlBlock`，炮塔的 `playerControllable` 决定是否可被
玩家控制。建筑控制得到的是 **BlockUnitc**（伪单位），不是普通 Alpha/Dagger
Unit，血量、武器、移动、建造、payload 语义都可能不同。

因此已实现独立路径：

- `control_building` 校验 `ControlBlock`、`canControl()`、同队，记录
  `controlMode=building` 与 building/pseudo-unit identity
- `release_building` 清理目标并恢复控制状态，不 despawn 建筑
- `get_context.control` 报告 `mode/buildingId/block/unitId/unitType`
- 控制期间 `attack` 走 TurretBuild 目标路径；不是普通 Unit 的 move/build 动作
- 具体可控制方块按运行时 `playerControllable` 枚举，不默认所有建筑

### 2.3 重生

玩家不能选择“重生单位类型”；重生单位由核心等级决定：

```text
core-shard -> alpha
core-foundation -> beta
core-nucleus -> gamma
```

玩家能选择的是**从哪个合法核心重生**。AI 需要补的是显式 `coreId`，不是
`unitType` 选择。

当前实现：

- 已改为按核心类型注册 `ai-alpha`/`ai-beta`/`ai-gamma` 三个非
  playerControllable 克隆类型；`spawnAssistantAt` 按 `CoreBlock.unitType`
  选择对应克隆。
- Fortress 实测 `core-foundation` 重生得到 `ai-probe-ai-beta`、health 170。
- gamma 也已实测 `core-nucleus -> ai-probe-ai-gamma`、health 220。
- 仍需补：`supportsEnv` 校验、异常核心类型 fallback、存档中自定义类型 id 的兼容性。
- `respawn` 选择目标核心，不缓存旧坐标。

### 2.4 工厂不是排队生产

已按 v160.8 字节码核对，结论比“其他工厂都升级”更细：

#### 基础工厂 `UnitFactory`

- `UnitFactory.plans` 是 `Seq<UnitPlan>`
- `UnitFactoryBuild.currentPlan` 是当前方案索引（默认 `-1`）
- `config()` 返回 `Integer` 方案索引
- 玩家 UI 只选择当前方案，工厂按 `UnitPlan.requirements/time` 生产
- **没有生产队列，没有多单位排队**
- `getPlanConfigs()` 返回可选解锁内容
- 方案受 `unlockedNow()` / `isBanned()` 过滤

AI 需要的是：

```text
读取可选方案 -> 选择 currentPlan -> 读取 currentPlan/进度
```

不是 `queue_unit`。`configure` 的工厂值应是方案索引；同时应暴露可选方案，
否则 AI 只能猜。

#### 升级工厂 `Reconstructor`

- `Reconstructor.upgrades` 是 `Seq<UnitType[]>` 的 `[基础类型, 升级类型]` 对
- `UnitBlockBuild` 接受 `UnitPayload`
- `acceptUnitPayload()` 只接受存在升级路径、且升级未解锁/未禁用的基础单位
- 升级目标由 `upgrades` 固定，不是玩家随便选一个单位类型
- `config()` 在这里是 `UnitCommand`，不是生产方案
- **没有队列**，流程是“基础单位进入 -> 计时 -> 固定升级单位出来”

#### `UnitAssembler`（Erekir 多方块组装厂）

v160.8 还存在 `UnitAssembler`：

- `AssemblerUnitPlan` 用 payload/item/liquid 需求
- 有多方块模块和 `currentTier`
- 不是简单的“基础单位进、升级单位出”
- 也不是排队生产；需要按 assembler 的模块/需求单独适配

所以不要把“其他工厂”一律写成 Reconstructor。Serpulo 的基础工厂 + 升级工厂
可以按上面的模型；Erekir assembler 要单独列项。

#### 重生单位

玩家不能通过重生选择单位类型。重生单位类型由核心等级决定；工厂方案和重生
单位类型是两件事，不能共用一个 `unitType` 参数。

### 2.5 特殊单位能力

单位能力（abilities）、payload、boost 等由 `UnitType` 和具体 Unit 决定。
如果 AI 附身了特殊单位，理所当然应允许该单位类型本身的能力，不能因为
“AI 只能挖矿/建造”而禁用其技能。

需要区分：

- 被动/自动 abilities：由 controller 每 tick 自动运行，通常不需要额外动作
- 主动能力/payload：玩家有输入入口，AI 需要显式动作或控制器支持
- boost：飞行单位的加速，需要与玩家输入语义对齐
- payload：`payloadCapacity > 0` 的单位可以拾取/投放 `Payloadc`；payload
  conveyor/router/loader 等方块则走建筑载荷系统

不能把“附身特殊单位”简单当作普通 alpha：控制器、武器、payload 容量、
abilities、碰撞、环境限制都要按目标单位本身执行。

### 2.6 液体物流

核对结论：玩家没有“从建筑直接把液体取进身体库存”的普通单位能力。
液体存在于建筑的 `LiquidModule` 中，玩家主要通过：

- 建造/拆除管道、泵、容器、路由器
- 配置相关建筑
- 让建筑之间通过管道/液体网络自动传输

来改变液体分布。没有原版 `withdraw_liquid`/`deposit_liquid` 这种身体动作。

因此不要给 AI 发明液体库存搬运工具；应允许它：

- 建造/拆除液体建筑
- 读取液体建筑状态
- 配置液体相关建筑
- 通过建筑网络间接改变库存

如果后续确实需要“拆除容器导致液体消失/转移”，也应按原版建筑销毁语义，
而不是加一个超出规则的液体传送 API。

### 2.7 地面掉落物

核对结论：v160.8 没有玩家可拾取的“地面物品实体”这一类常规机制。物品在
建筑库存、单位携带、核心/容器之间移动，不存在“走过去捡起地面 Item”的通用
玩家动作。

因此原计划中的 `pickup_item` / `drop_item` 不成立，应从 parity 清单移除。
如果未来发现特定地图/逻辑方块制造了物品实体，再单独适配。

### 2.8 蓝图

蓝图是玩家 UI 便利功能，不是游戏规则必需能力。当前明确不做：

- 不实现蓝图库/复制粘贴 UI
- AI 可以在自己的工作目录生成 build plan 文件
- 只要求 `build_plan` 逐块校验、扣费、计时

### 2.9 研究

玩家也没有“研究队列/自动规划器”。研究是科技树上的逐节点操作，受：

- `TechTree.TechNode.parent/children`
- `techNode.requirements`
- `TechNode.objectives`
- `requiresUnlock`
- `UnlockableContent.unlockedNowHost()/unlock()`
- `Rules.researched`

影响。AI 现在有 `research` 动作，但还缺：

- 完整科技树图（parent/children、成本、objectives、当前解锁状态）
- 为什么某个节点不可研究的依赖原因
- 与战役 `Rules.researched`/sector 规则的对应
- 研究前置节点/父节点的可见性
- 只读 `get_tech_tree` 或 `/content` 的研究图字段

不做“自动规划器/队列”；做**图结构 + 单节点研究动作**即可。

### 2.10 单局游戏控制

**已拍板：开放主动暂停/恢复，但必须遵循规则。**

玩家在单局内可以直接控制的内容包括：

- 暂停/恢复（单机）
- 摄像机、选择、UI
- 保存/读取（客户端 UI）
- 规则/模式允许时的规则编辑
- 退出

需要先拍板哪些算“规则内游戏控制”，哪些属于客户端/元层：

- 暂停/恢复：开放给 AI；按 `Rules.pauseDisabled` 和当前游戏状态校验，且
  `resume` 本身必须能在 `paused=true` 时通过动作门控
- 游戏速度：原版正常界面没有通用变速；不假设存在
- 保存/读取：单机 UI 能力，不是世界动作；不开放给 AI
- 规则编辑：仅编辑器/允许编辑规则的模式；不能默认开放
- 退出：不开放

实现要点：

- `Vars.state.isPaused()` 读状态
- `Vars.state.set(GameState.State.paused/playing)` 改变状态
- `Rules.pauseDisabled` 是规则门闩；为 true 时不得 pause/resume
- `pause`/`resume` 都必须绕过“paused 时禁止写动作”的通用门控
- 暂停期间不能自动重生、不能让正在运行的 op 继续假装进展
- 恢复后正在等待的 op 继续按实际 tick 推进，不补帧

## 2.11 本轮已拍板

- **允许助手控制 `possess` 控制的单位**：附身后 `assistant` 指向借体，后续
  `move_to`/`attack`/`mine`/`build_plan` 等直接作用于借体；`release` 退出。
- **冲突处理按建议**：队友式 last-writer-wins，不做硬锁；不抢占玩家当前
  body，AI 之间/对 AI 指令允许后操作覆盖前操作。
- **暂停/恢复开放**：按 `Rules.pauseDisabled` 和游戏状态执行，遵循规则，
  不把暂停当成绕过模拟的手段。
- **工厂按实际机制**：基础 `UnitFactory` 选择方案而非排队；`Reconstructor`
  是基础单位进入后按固定升级表升级；`UnitAssembler` 单独建模。
- **不做重生单位类型选择**：只允许选择核心；类型跟核心等级。

## 3. 目标能力矩阵

下表“AI 当前”按当前 HEAD；目标列是剩余工作，不是全部已实现。

| 能力 | 玩家 | AI 当前 | 目标 |
|---|---|---|---|
| 控制自己的单位 | 可以 | 可以 | 保持 |
| 控制同队其他单位 | 可以 | `command_units`；不直接改 controller | 需要时再做 `control_unit` |
| 附身/退出附身 | 可以 | session 已开放 | 保持 |
| 控制部分建筑 | 可以 | 已接入 | `control_building`/`release_building` |
| 选择重生核心 | 可以 | 已开放 | 补 `supportsEnv`/异常核心 |
| 选择重生单位类型 | 不可以 | 不适用 | 不做 |
| 指挥同队单位 | 可以 | 有 stance + `command_units` | 保持 last-writer-wins |
| 选择工厂生产方案 | 可以 | 已接入 | `get_config_schema` + `configure` |
| 单位特殊能力 | 取决于单位 | 已暴露 abilities | 按 UnitType/abilities 自动执行 |
| boost | 可以 | 已接入 | `boost`（canBoost 门控） |
| payload 拾取/投放 | 可以 | 已接入 | `pickup_payload`/`drop_payload` |
| 单位进入 payload conveyor | 可以 | `move_to` + drop | 不额外造 `enter_payload`，按建筑/移动规则 |
| 物品取放 | 可以 | 可以 | 保持 |
| 液体直接取放 | 不可以 | 不适用 | 不做；只做建筑/网络 |
| 地面物品拾取 | 不适用 | 不适用 | 移除 |
| 配置建筑 | 可以 | `get_config_schema` | 保持 schema + configure |
| 蓝图 | 可以（UI） | 工作目录替代 | 不做 UI |
| 研究 | 可以 | 单节点 + 图 | `research` + `get_tech_tree` |
| 暂停/恢复 | 可以 | 可以 | 已开放，规则门控 |
| 存档/读档 | 可以（UI） | 不可 | 不纳入世界动作 |
| 跨区域发射/loadout | 可以 | 不可 | 暂不做 |

## 4. 待确认问题

这些问题会直接影响接口设计，记录在 `docs/OPEN-QUESTIONS.md`：

1. **建筑控制范围**：只开放 `ControlBlock`（当前确认 TurretBuild），还是未来
   包括模组控制方块？建筑控制期间的动作集合是什么？
2. **建筑控制的上下文**：`assistant.type` 如何表示 `BlockUnitc`；是否需要
   `controlMode=building`、`buildingId`、`canExit`。
3. **玩家抢占**：已拍板 last-writer-wins；不抢玩家当前 body，只覆盖 AI 单位/命令。
4. **工厂方案值**：`get_config_schema` 返回方案索引，`configure` 接受整数并回读
   `currentPlan`；`Reconstructor` 的 config 是 `UnitCommand`，不作为生产方案。
5. **payload 入口**：已提供 `pickup_payload`/`drop_payload`；payload conveyor 按
   建筑规则接收，当前不额外造 `enter_payload`，移动/投放语义保持不变。
6. **特殊能力**：`get_capabilities` 已列出 `abilities`；被动 abilities 自动运行，
   `boost` 有显式动作。没有为无输入入口的技能伪造 `use_ability`。
7. **研究图**：`get_tech_tree` 已返回 parent/children、成本、objectives、
   researched、blockedReason；`research` 检查父节点和目标；不提供队列/规划器。
8. **暂停/游戏速度**：已拍板开放 `pause`/`resume`，受 `Rules.pauseDisabled`
   约束；游戏速度没有原版通用控制，暂不开放。
9. **核心类型**：已建 alpha/beta/gamma 三份并实测 beta/gamma；仍需异常核心 fallback
   和存档类型 id 兼容。
10. **蓝图**：保持不做 UI，还是允许 AI 读取工作目录中的 schematic 文件？
    当前建议保持不做。
11. **冲突处理**：last-writer-wins 的粒度是单位 controller、命令、stance、
    建筑控制还是动作队列？是否需要日志/提示。
12. **多客户端**：同一台机器运行多个 Mindustry 实例会产生端口/存档/log/
    助手重复问题；产品是否需要单实例锁或明确禁止。

## 5. 实现顺序建议

1. [done] 显式 `respawn(coreId)` + 按核心类型创建对应 assistants
2. [done] 建筑控制适配（先 TurretBuild）
3. [done] `possess`/`release` 进入正常 session 工具面
4. [done] 工厂方案读取/配置（`command_units` 已接入）
5. [done] `get_config_schema` + 完整配置读取
6. [done] 特殊 abilities / boost / payload
7. [done] 科技树图 + 单节点研究规则
8. [done] 暂停/游戏控制拍板（单独做）
9. [done] 文档与验收场景

## 6. 明确不做

- 蓝图 UI、跨区域发射/loadout（本阶段）
- 液体直接搬运 API
- 地面掉落物 pickup/drop
- 研究队列/自动规划器
- 让 AI 选择重生单位类型
- 让 AI 控制玩家当前 body
