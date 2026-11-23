# 玩家能力对齐（Player Parity）需求记录

状态：需求记录，未实现；2026-11-23
关联：`docs/ASSISTANT-DESIGN.md`、`docs/OPEN-QUESTIONS.md`、`TASKS.md`

本文记录“规则内玩家能做、AI 还缺什么”，以及已经核对过的 Mindustry v160.8
机制。先把语义和边界定清楚，避免直接照抄一个不存在的 API。

## 1. 入口与现状

正常 AI 入口是 mod 内 session API（以及 `/mcp` 的同一套工具），当前 22 个：

```text
get_context, get_area, get_tile, query_area, get_unit, list_unit_types,
move_to, attack, mine, build_plan, withdraw, deposit, configure, research,
deconstruct, repair, set_stance, release, follow,
get_action_result, cancel, stop
```

另有 `/content`、`/capabilities`、`/guide`、`/events/wait`、`/data` 等读接口。

旧 Node MCP 27 工具和 raw probe 调试面包含一些 session 未开放的动作
（`possess`、`respawn`、`command_units` 等）。它们不等于产品 AI 的正式权限。

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

因此：

- 不能把“附身建筑”塞进现有的 `possess(unitId)` 单位路径
- 需要独立的 building-control 适配层
- 不能默认所有建筑可控制；运行时按 `ControlBlock.canControl()` 和具体方块字段判断
- 需要明确控制期间 `get_context.assistant` 的字段如何表示伪单位
- `release` 要能退出建筑控制并恢复原建筑状态
- 建筑控制的“身体”是否需要独立上下文、op、动作白名单，待定

### 2.3 重生

玩家不能选择“重生单位类型”；重生单位由核心等级决定：

```text
core-shard -> alpha
core-foundation -> beta
core-nucleus -> gamma
```

玩家能选择的是**从哪个合法核心重生**。AI 需要补的是显式 `coreId`，不是
`unitType` 选择。

当前实现的额外问题：

- 助手现在使用自定义 `ai-probe-ai-alpha`，它只从 alpha 复制了一份；
- 如果在 beta/gamma 核心重生，身体仍可能是 alpha 能力，和核心等级不一致；
- 应改为按核心类型生成对应的非 playerControllable 克隆类型（`ai-alpha`/
  `ai-beta`/`ai-gamma`），或从 `CoreBlock.unitType` 动态派生；
- `respawn` 需要校验核心存在、同队、`allowSpawn`、`supportsEnv`，并选择核心
  位置，而不是缓存旧坐标。

### 2.4 工厂不是排队生产

原版单位工厂不是“队列生产”。玩家在工厂 UI 中选择当前生产方案：

- `UnitFactoryBuild.currentPlan` 指向一个 `UnitPlan`
- 工厂按资源和时间生产当前单位
- 没有生产队列，也没有多单位排队
- `Reconstructor` 是选择升级路线，不是生产队列
- 玩家不能通过重生选择单位类型，重生类型跟核心走

所以 AI 需要的是：

```text
选择工厂当前生产方案 / 读取当前方案 / 读取可选方案
```

不是 `queue_unit`。现有 `configure` 可能可以设置工厂方案，但需要按
`UnitFactoryBuild.config()` 的实际值语义实现，并补 `get_config_schema`/工厂
可选方案读取；不能假设有队列。

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

玩家在单局内可以直接控制的内容包括：

- 暂停/恢复（单机）
- 摄像机、选择、UI
- 保存/读取（客户端 UI）
- 规则/模式允许时的规则编辑
- 退出

需要先拍板哪些算“规则内游戏控制”，哪些属于客户端/元层：

- 暂停/恢复：影响模拟，AI 是否允许主动 pause 必须单独定义
- 游戏速度：原版正常界面没有通用变速；不要假设
- 保存/读取：单机 UI 能力，不是世界动作；不应直接暴露给 AI 作为游戏内动作
- 规则编辑：仅编辑器/允许编辑规则的模式；不能默认开放
- 退出：不开放

建议：只开放**明确影响单局世界、且规则允许的玩家操作**；暂停先作为
需要拍板的独立项，不要和普通写动作混在一起。

## 3. 目标能力矩阵

下面的“目标”是本文建议，不是已实现。

| 能力 | 玩家 | AI 当前 | 目标 |
|---|---|---|---|
| 控制自己的单位 | 可以 | 可以 | 保持 |
| 控制同队其他单位 | 可以 | 不可 | `control_unit`/`possess` |
| 附身/退出附身 | 可以 | raw only | session 开放 `possess`/`release` |
| 控制部分建筑 | 可以 | 不可 | `ControlBlock` 适配，独立动作 |
| 选择重生核心 | 可以 | 不可 | `respawn {coreId}` |
| 选择重生单位类型 | 不可以 | 不适用 | 不做 |
| 指挥同队单位 | 可以 | 只有 stance | `command_units`/命令与队列 |
| 选择工厂生产方案 | 可以 | 不完整 | 读方案 + configure |
| 单位特殊能力 | 取决于单位 | 未统一 | 按 UnitType/abilities 执行 |
| boost | 可以 | 未提供 | `boost` 或控制器字段 |
| payload 拾取/投放 | 可以 | 未提供 | payload 动作 |
| 单位进入 payload conveyor | 可以 | 间接 move | 明确 `enter_payload`/move 语义 |
| 物品取放 | 可以 | 可以 | 保持 |
| 液体直接取放 | 不可以 | 不适用 | 不做；只做建筑/网络 |
| 地面物品拾取 | 不适用 | 不适用 | 移除 |
| 配置建筑 | 可以 | 部分 | 补 schema/方案/逻辑代码 |
| 蓝图 | 可以（UI） | 工作目录替代 | 不做 UI |
| 研究 | 可以 | 单节点 | 补科技树图/规则 |
| 暂停/恢复 | 可以 | 不可 | 待拍板 |
| 存档/读档 | 可以（UI） | 不可 | 不纳入世界动作 |
| 跨区域发射/loadout | 可以 | 不可 | 暂不做 |

## 4. 待确认问题

这些问题会直接影响接口设计，记录在 `docs/OPEN-QUESTIONS.md`：

1. **建筑控制范围**：只开放 `ControlBlock`（当前确认 TurretBuild），还是未来
   包括模组控制方块？建筑控制期间的动作集合是什么？
2. **建筑控制的上下文**：`assistant.type` 如何表示 `BlockUnitc`；是否需要
   `controlMode=building`、`buildingId`、`canExit`。
3. **玩家抢占**：AI 控制建筑/单位时，玩家点选/控制是否直接覆盖？反向 AI
   `possess` 是否允许抢玩家正在控制的单位？建议：不能抢玩家当前 body；
   队友 AI 单位按 last-writer-wins。
4. **工厂方案值**：`UnitFactoryBuild.config()` 返回什么；`configure` 应接受
   `UnitType`、plan 名称还是 plan index；如何读取可选方案。
5. **payload 入口**：单位“进入 payload conveyor”的引擎触发条件；是否需要
   `enter_payload`，还是只要移动上去即可。
6. **特殊能力**：哪些 abilities 是自动的，哪些需要玩家输入；AI 是否需要
   `use_ability`。
7. **研究图**：`TechNode.objectives`/`requiresUnlock`/`Rules.researched` 在
   战役和自定义地图中的语义；研究是否需要 sector 级限制。
8. **暂停/游戏速度**：AI 是否允许主动暂停；是否只允许玩家暂停；是否开放
   游戏速度。建议先只读 `paused`，不开放 AI pause，除非明确“规则内玩家控制
   全部开放”。
9. **核心类型**：自定义非 playerControllable 类型是否需要为 alpha/beta/gamma
   各建一份；如何避免存档中的类型 ID 失配。
10. **蓝图**：保持不做 UI，还是允许 AI 读取工作目录中的 schematic 文件？
    当前建议保持不做。
11. **冲突处理**：last-writer-wins 的粒度是单位 controller、命令、stance、
    建筑控制还是动作队列？是否需要日志/提示。
12. **多客户端**：同一台机器运行多个 Mindustry 实例会产生端口/存档/log/
    助手重复问题；产品是否需要单实例锁或明确禁止。

## 5. 实现顺序建议

1. 显式 `respawn(coreId)` + 按核心类型创建对应 assistants
2. 建筑控制适配（先 TurretBuild）
3. `possess`/`release` 进入正常 session 工具面
4. `command_units` + 选择工厂方案
5. `get_config_schema` + 完整配置读取
6. 特殊 abilities / boost / payload
7. 科技树图 + 单节点研究规则
8. 暂停/游戏控制拍板（单独做）
9. 文档与验收场景

## 6. 明确不做

- 蓝图 UI、跨区域发射/loadout（本阶段）
- 液体直接搬运 API
- 地面掉落物 pickup/drop
- 研究队列/自动规划器
- 让 AI 选择重生单位类型
- 让 AI 控制玩家当前 body
