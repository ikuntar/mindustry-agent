# Mindustry Agent 助手设计

状态：设计稿，2026-11-18；实现状态更新 2026-11-26（0.4.2）。
定位：单机/本地对局里的 AI co-op 助手，不是独立 AI 客户端。
目标版本：官方 Mindustry v160.8（服务端 jar 已做 API 核对，见 `docs/REALITY-CHECK.md`）。
交互：先做 MCP 工具接口；游戏内聊天框/对话框暂不做，后续用 harness 测试。

---

## 1. 目标与非目标

### 目标

- 玩家和 AI 在同一局里一起玩；人类保留完整客户端和原版 UI。
- AI 以“单位身份”存在于对局中：有自己的身体、队伍、位置、血量、物品和能力。
- AI 可以做“当前身体作为单位能做的一切”，外加一部分玩家权限。
- AI 的行为和限制尽量与玩家一致：建造扣资源/耗时、取物受 220 范围限制、配置受队伍限制、附身受规则限制、死亡后从核心重生。
- 对外暴露 MCP 工具接口，任何 MCP 客户端或自建 harness 都能通过工具读取状态、下达动作。

### 非目标（当前阶段）

- 不做游戏内聊天框、对话框、语音。
- 不做独立 AI 客户端/无头客户端；AI 是玩家局内的一个实体。
- 研究、暂停、游戏速度等按 `docs/PLAYER-PARITY.md` 记录，逐步对齐；跨区域发射、管理员、存档读档暂不做。
- 不做 UI 便利功能（摄像机、小地图、蓝图面板、聊天面板）。
- 不做跨队能力；AI 在哪个队就只有那个队的能力。

---

## 2. 已拍板事项

| 事项 | 决定 |
|---|---|
| 助手身体来源 | 从核心生成；不设 `spawnedByCore`（非 Player 会被引擎每帧 despawn），用 `isHome` 跟踪 |
| 身体参数 | 使用所从属核心的 `CoreBlock.unitType`；不同核心可能是不同身体 |
| 附身 | 要做；可附身同队、AI 控制、`playerControllable` 的单位 |
| 助手身体可否被附身 | 不可；控制器不是 `AIController`，原版 `unitControl` 天然拒绝 |
| 附身时 home body | 直接消失（`Call.unitDespawn`），和玩家从核心身体切走一致 |
| 借体解控 | 不消失，`resetController()` 交回 AI，留在原地；和玩家行为对齐 |
| 同一时间身体数 | 一个 |
| 死亡重生 | 无限重生，不扣资源，同一时间一个身体；绕过人口上限 |
| 重生核心 | 可从不同核心重生；默认 `bestCore`，支持显式指定任意合法核心 |
| 人口限制 | 重生/默认身体绕过 `Units.getCap`；助手通过工厂/建造生产的其他单位仍受人口和资源限制 |
| 团队约束 | 按游戏规则：同队校验、`team.rules()`、建造/配置/取物/指挥的引擎检查 |
| 同队内归属 | 不做硬约束，用提示词约束；至少保留动作日志 |
| 蓝图/原理图 | AI 不需要该 UI；可用自己的 build plan 宏，但仍逐块扣费/计时 |
| 聊天框 | 暂不做 |
| 接口 | 先做 MCP 工具接口，后续用 harness 测试 |

---

## 3. 架构

```
人类玩家（原版客户端 UI）
        │
        ▼
游戏 mod（感知 / 执行 / 本地反射控制器）
        │  本地 socket / JSON
        ▼
MCP server（工具、资源、会话、动作队列、上下文压缩）
        │  MCP
        ▼
MCP host（Claude Desktop，或自建 agent 守护进程）
        │
        ▼
LLM
```

### 分层职责

- 游戏 mod：读取世界状态；执行动作；维护助手身体、附身、重生；跑本地控制器。不直接实现 MCP，不在渲染线程等模型。
- MCP server：独立进程；把工具调用翻译成 mod 动作；校验参数；维护动作队列/结果/事件；压缩上下文；做鉴权和限流。
- MCP host：可以是 Claude Desktop（被动对话 + 工具调用），也可以是自建 agent 守护进程（主动循环、事件触发、记忆）。游戏内聊天/主动防守只有自建 host 能做。
- 本地反射控制器：LLM 只发意图；当前实现执行显式移动/攻击/跟随、建造推进、卡住重试；**不默认低血撤退，也不默认空闲索敌/开火**。助手死亡后由核心自动重生；是否需要保命由 LLM 通过 `move_to`/`follow` 决定。

### 当前实现状态

- `mcp-server/`：MCP 接口脚手架 + `MockGameAdapter`（模拟世界，用于协议和 harness 测试）。
- 真实 Mindustry mod adapter 已实现（`ProbeGameAdapter`）；MCP server 通过本地 socket 连接 mod，边界已落地。当前 Node MCP 有 27 个工具，session API 有 35 个工具。

---

## 4. 身体与附身生命周期

### 状态

```
HOME         助手默认身体，从核心生成，isHome=true，spawnedByCore=false
POSSESSING   当前控制的是借体，isHome=false
DEAD         没有身体，等待重生
```

> 真实引擎核对（v160.8）：`spawnedByCore=true` 的非 Player 单位会被
> `UnitComp.update()` 每帧 `Call.unitDespawn`。助手身体不能设这个标记；
> 用 `isHome` 自己跟踪，附身时显式 despawn。详见 `docs/REALITY-CHECK.md`。

### 附身

```
possess(target):
  require target.team == assistant.team
  require target.isAI()
  require target.playerControllable()
  require !target.dead
  require !(target.controller instanceof AssistantController)
  require target != player.unit()          // 玩家当前身体不是 AI，天然排除
  require state.rules.possessionAllowed    // 待确认，默认遵守

  old = body
  if old.isHome:
      Call.unitDespawn(old)                // home body 消失
  else:
      UnitCommand cmd = old.controller() instanceof CommandAI ? ai.command : null
      old.resetController()                // 借体留下，交回 AI
      if cmd != null && old.controller() instanceof CommandAI: ai.command(cmd)

  target.controller(assistantController)
  target.isAi = false
  target.isHome = false
  body = target
```

### 解控/释放

- 借体不消失：`resetController()` 交回 AI；玩家队会得到 `CommandAI`，仍可被指挥。
- home body 已经在附身时 despawn，所以“回去”只有两条路：重新在核心生成 home body，或再次附身刚才的借体。
- 释放后当前借体留在世界；助手回到新生成的 home body。

### 死亡与重生

```
onDeath(body):
  body = null
  schedule respawn (delay ≈ Player.deathDelay)

respawn(core = null):
  core = core ?? bestCoreFor(assistant)
  require core.team == assistant.team
  require core.allowSpawn
  type = ((CoreBlock)core.block).unitType
  require type.supportsEnv(state.rules.env)

  u = type.create(assistant.team)
  u.set(core.x, core.y)
  u.health = type.health
  u.maxHealth = type.health
  u.spawnedByCore(false)      // 不要设 true：非 Player 会被引擎每帧 despawn
  u.controller(assistantController)
  u.isHome = true
  u.add()                     // 直接 add，绕开 Units.getCap
  Fx.spawn.at(core)
  body = u
```

- 默认核心选择：`bestCore()`（大核心优先，再按离死亡点距离）；支持显式 `respawn {coreId}`。
- 核心在重生倒计时期间被拆：重生时重新选；不要缓存 tile。
- 没有核心：保持死亡；之后有核心可再重生。
- 不同核心可能给不同 UnitType；助手身体类型跟核心走，这是“和玩家同参数”的一部分。
- `isHome` 用于区分 home body 和借体；不要用 `spawnedByCore` 判断借体（借体本身也可能是核心生成的 AI 单位）。

### 助手身体不可被附身

- `AssistantController` 直接实现 `UnitController`，不继承 `AIController`。
- `Unit.isAI()` 是 `controller instanceof AIController`，所以原版 `unitControl` 拒绝。
- `Unit.isPlayer()` 是 `controller instanceof Player`，所以它是“第三类”：不是 AI，也不是 Player。少数 `isPlayer()` 分支会有外观/统计差异，需要实测。
- 在助手自己的 `possess` 动作里再显式拒绝 `controller instanceof AssistantController`，防止其他 mod 直接改 controller 绕过。

---

## 5. 权限模型

### 单位身份能做到的一切

以当前身体的 `UnitType` 为准：移动、射击、采矿、建造/拆除/旋转、修理、加速、payload、携带/上缴、技能、死亡/重生。具体限制来自 `UnitType` 字段：

- `buildSpeed`（<0 禁用）、`buildRange`
- `mineSpeed`、`mineTier`、`mineRange`
- `weapons`、`range`、`targetAir/targetGround`
- `health`、`armor`、`speed`、`flying`、`canBoost`
- `itemCapacity`、`payloadCapacity`
- `abilities`、`immunities`
- `useUnitCap`、`playerControllable`

### 允许的玩家权限（默认）

- 取物/存物/丢弃：同队、`within(build, 220)`、`maxAccepted` 容量；核心/容器/仓库都算。
- 配置建筑：同队、`build.configured(assistantUnit, value)`；逻辑处理器代码额外编译校验；value schema 按方块类型。
- 指挥单位：同队、`CommandAI`、`type.allowCommand`；命令、队列、stance。
- 附身/控制：同队、`isAI()`、`playerControllable()`、`possessionAllowed`。
- 重生：任意合法核心。
- 建造/拆除/旋转、修理、build plan。

### 默认不给

- 跨区域发射、存档/读档、管理员/踢人/投票、地图选择；研究已单节点开放；暂停/变速见 PLAYER-PARITY。
- 摄像机、小地图、聊天面板、蓝图/原理图 UI。
- 直接 `spawn_unit`、`constructFinish`、改世界、加物品等上帝接口；最多作为调试开关，不进入常规动作集。

> 玩家能力缺口与机制核对见 `docs/PLAYER-PARITY.md`。

### 团队规则

- `Team`：阵营；`team.cores()`、`team.data()`、`team.isAI()`、`team.active()`。
- `TeamRule`（`team.rules()`）：每队的建造/单位/AI 参数，例如 `infiniteResources`、`cheat`、`fillItems`、`buildSpeedMultiplier`、`protectCores`、`checkPlacement`、`extraCoreBuildRadius`、`unitHealthMultiplier`、`unitDamageMultiplier`、`unitMineSpeedMultiplier`、`unitBuildSpeedMultiplier`、`unitCostMultiplier`、`rtsAi`、`buildAi`、`aiCoreSpawn`。
- 全局 `state.rules`：`waves`、`pvp`、`attackMode`、`editor`、`infiniteResources`、`buildCostMultiplier`、`buildSpeedMultiplier`、`unitCap`、`defaultTeam`、`waveTeam`、`possessionAllowed`、`coreBuildAndConfig`。
- 所有动作都传 `assistant.team`；不要传 `Vars.player.team()`。同队共享队伍规则；敌方队伍按 `interactable`/team 校验拒绝。
- `team.isAI()` 只影响 AI 行为和默认控制器，不改变动作合法性。
- 人口：全局 `state.rules.unitCap`/`unitCapVariable` + `Team.ignoreUnitCap`；重生绕过，工厂生产不绕过。

### 同队归属

- 引擎没有 ownership；助手和玩家同队共享资源、单位、建筑。
- 不做硬约束；用提示词约束“别抢玩家当前单位、别乱花资源、别拆玩家建筑”。
- 至少保留动作日志；破坏性操作可回看。可选加确认/预算，但不是 v1 阻塞项。

---

## 6. MCP 接口

### 传输

- MCP server 独立进程，默认 stdio；远程部署使用网络传输（HTTP/Streamable HTTP）。
- MCP server ↔ 游戏 mod：本地 socket / JSON（未来实现）；当前用 `MockGameAdapter` 内存模拟。
- 游戏 mod 暴露 `bridge-info.json` 类似发现文件：host、port、token、version。
- 大体积地图/事件不通过 MCP tool result 返回；使用只读数据面 + `DatasetRef`，由客户端代码读取。详见 `docs/REMOTE-DATA-PLANE.md`。
- 不把 MCP 实现塞进游戏渲染线程。

### 读工具

| 工具 | 作用 |
|---|---|
| `get_context` | 摘要：身体/玩家/队伍资源/核心/附近实体/波次/当前动作 |
| `get_capabilities` | 当前身体能做什么（buildSpeed、mineTier、武器、payload、可指挥命令） |
| `get_content` | 方块/单位/物品/液体注册表 |
| `get_events` | 自 `since` 以来的事件（波次、核心受击、建筑被拆、单位死亡、资源阈值等） |
| `query_area` | 局部区域单位/建筑 |
| `get_config_schema` | 某方块配置字段/合法值；UnitFactory 方案索引 |
| `get_tech_tree` | 科技树节点、父/子、成本、objectives、researched |
| `get_action_result` | 按 `opId` 查询/等待动作结果 |

### 写工具

> 下表是完整目标/旧 Node MCP 的工具面；当前 mod session API 有 35 个；`command_units`/`possess`/`respawn`/`pause`/`resume`/`control_building`/工厂与科技树读工具/`boost`/payload 已进入正常工具面。缺口和实现顺序见 `docs/PLAYER-PARITY.md`。


| 工具 | 作用 |
|---|---|
| `move_to` | 移动到坐标 |
| `attack` | 攻击单位/建筑/坐标 |
| `follow` | 跟随单位 |
| `mine` | 采矿 |
| `stop` | 停止当前动作 |
| `build_plan` | 批量放置 + 拆除 + 配置；逐块扣费/计时 |
| `deconstruct` | 拆除 |
| `repair` | 仅 `canHeal` 身体可用；当前 Alpha/Beta/Gamma 为 builder，不能回血 |
| `withdraw` | 从建筑取物（220 范围） |
| `deposit` | 向建筑存物 |
| `configure` | 配置建筑/逻辑代码 |
| `command_units` | 指挥单位（命令/目标/队列/stance） |
| `set_stance` | 设置单位 stance |
| `possess` | 附身同队 AI 单位 |
| `release` | 解控，回核心生成 home body |
| `respawn` | 死亡后在指定/默认核心重生 |
| `control_building` | 控制同队 ControlBlock 建筑（非单位附身） |
| `release_building` | 退出建筑控制，保留建筑 |
| `boost` | 按 canBoost 开关飞行单位加速 |
| `pickup_payload` | payload 能力单位拾取建筑/单位 |
| `drop_payload` | 在当前位置投放 payload |
| `cancel` | 取消动作 |

### 异步语义

- 写工具立即返回 `{accepted, opId}`；不在工具调用里等几十秒。
- `get_action_result {opId, waitMs?}` 查询/短轮询；`waitMs` 最大 5s。
- 动作状态：`queued | running | done | failed | cancelled`。
- 失败返回 `{code, message}`；常见错误码：`out_of_range`、`invalid_placement`、`insufficient_resources`、`wrong_team`、`not_possessable`、`assistant_dead`、`no_core`、`op_not_found`。

### 事件

- 事件 ID 单调递增；`get_events(since)` 返回 `events`、`next`、`dropped`。
- 高频事件要合并（一波 tile_changed 不要发 50 条）。
- MCP 是客户端拉模型；大多数 host 不会因服务端通知自动唤醒模型。主动行为需要自建 host 循环或本地规则引擎。

---

## 7. 观测与决策分层

### 本地控制器（当前为默认显式模式）

- `ProbeController.updateUnit()` 执行显式移动/攻击/跟随、采矿、建造推进、维修、卡住重试。
- **不默认低血撤退，也不默认空闲索敌/开火**；助手死亡后从核心自动重生，保命策略由 LLM 用 `move_to`/`follow` 决定。
- LLM 发高层意图；本地层只负责执行和路径/动作推进，不偷偷替 LLM 做生存决策。

### 观测 schema（下一阶段）

- 每轮给摘要 + 局部窗口 + 事件增量，而不是全图 JSON。
- 必须包含：助手身体/能力、玩家状态、队伍资源、核心/容器库存、附近单位/建筑、波次/敌人、可指挥单位/stance、当前任务/动作、可配置 schema。
- 支持 `detail`、`radius`、`since` 和 token 预算；大结果分页/resource。

### 主动性

- Claude Desktop 当 host：只能被动对话 + 工具调用。
- 要主动防守/建造/巡逻：自建 agent 守护进程，订阅事件、按策略唤醒 LLM；或本地规则引擎直接执行低风险反射。
- 待拍板：主动 vs 仅应答；默认“可主动，但有预算、静默模式、一键停机”。

---

## 8. 运行时与工程

- 游戏线程动作队列 + 每帧预算；LLM 调用离线程；超时/取消/背压。
- 动作幂等：requestId/planId 去重，重试不重复建造/取物。
- 存档/读档：助手记忆在外部进程；读旧档后记忆与世界不一致，需要清空/回滚/提示。
- 跨区块/跨地图：身体在核心重建，记忆保留；战役科技树变化同步。
- 多人：本地主机可同步；专用服需要服务端 mod；对话框只给拥有者；其他玩家能否看见/指挥助手待定。
- 失败降级：LLM 离线、非法 JSON、动作连续失败、游戏暂停、核心被拆；停手并报告。
- 安全：本地 socket token；MCP server 只绑定 localhost；动作 allowlist；rate limit；prompt injection 防护；API key 只在伴生进程。
- 日志：每次工具调用、动作结果、模型决策；支持复盘和回放。

---

## 9. v1 验收标准（建议）

- 在固定地图上，助手能从核心生成，跟随玩家，移动/攻击/采矿/建造/拆除/修理可用。
- 建造一条 20 格传送带：逐块扣铜、耗时、失败可报告；资源不足时停止。
- 从核心取 30 铜、存入箱子/核心，受 220 范围和容量限制。
- 配置分拣器/卸载器/逻辑处理器，非法配置被拒绝。
- 附身同队 AI 单位，home body 消失；解控后借体留下并恢复 AI；再次附身/释放正常。
- 死亡后在默认核心重生；指定另一个核心重生；核心被拆后 fallback；无核心保持死亡。
- 重生绕过人口上限；工厂生产仍受人口限制。
- MCP harness 能列工具、读上下文、下达动作、查询结果、取消动作。
- 指标：动作成功率、失败率、延迟、token/分钟、误伤玩家资产次数、助手死亡次数。

---

## 10. 待拍板

1. MCP host：Claude Desktop（被动）还是自建 agent 守护进程（主动、可接游戏内对话）？
2. 主动性：只应答，还是允许主动防守/建造？默认后者，带静默模式和预算。
3. `state.rules.possessionAllowed=false` 时，助手是否仍可附身？默认遵守规则：不可。
4. “控制”是否包含建筑/核心控制（`buildingControlSelect`）？默认只做单位。
5. 附身距离：原版 `unitControl` 无距离检查；助手是否也无距离？默认同玩家。
6. 借体解控恢复命令的深度：只 `command`，还是连 `commandQueue`/stance？默认只 `command`。
7. 同队归属：纯提示词，还是加动作日志/破坏性确认/预算？默认日志 + 可选确认。
8. 多人范围：只单机/本地主机，还是要专用服/其他玩家？默认前者。
9. 助手记忆/人格：跨会话、跨区块、读档后如何处理？默认外部进程保存，读档提示重置。
10. 真实 mod adapter 的传输/鉴权/重连/版本握手细节。
11. 测试床和 harness 形态：脚本化玩家 + 固定地图 + 回放，还是直接 LLM harness。
