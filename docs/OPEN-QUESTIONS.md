# OPEN QUESTIONS

状态：默认值已在实现中采用；仍可一票否决 / 待验证
更新：2026-11-21

每条包含：问题、默认建议、影响范围。默认值可一票否决。

## Q1. MCP host 是谁？

- 选项：Claude Desktop（被动） / 自建 agent 守护进程（主动、可接游戏内对话）。
- 默认：自建守护进程作为主 host；MCP server 同时暴露给外部客户端。
- 影响：主动性、游戏内对话框、事件唤醒、记忆。

## Q2. 助手是否主动行动？

- 选项：仅应答 / 允许主动防守、建造、巡逻。
- 默认：可主动，但有预算、静默模式、一键停机。
- 影响：事件触发、本地规则引擎、LLM 调用频率、token 成本。

## Q3. `state.rules.possessionAllowed=false` 时是否仍可附身？

- 默认：遵守规则，不可附身。
- 状态：probe 读取 `state.rules.possessionAllowed`，false 时拒绝；固定场景已覆盖。
- 影响：附身功能在部分地图/模式下不可用；符合“游戏规则”。

## Q4. “控制”是否包含建筑/核心控制？

- 已确认：要做，但不能复用单位 `possess`；`ControlBlock`/`BlockUnitc` 独立适配。
- 范围：当前确认 `TurretBuild` 等带 `playerControllable` 的控制方块；是否覆盖模组方块待定。
- 影响：动作接口、上下文、release、权限矩阵。详见 `docs/PLAYER-PARITY.md`。

## Q5. 附身距离？

- 原版 `unitControl` 没有距离检查（代码里是 TODO）。
- 默认：同玩家，无距离限制；要平衡可加范围，但属于偏离原版。

## Q6. 借体解控恢复命令的深度？

- 选项：只恢复 `command` / 连 `commandQueue`、stance 一起恢复。
- 默认：只恢复 `command`，和原版玩家切换接近；队列丢失可接受。
- 影响：借体解控后的行为一致性。

## Q7. 同队归属怎么处理？

- 选项：纯提示词 / 动作日志 / 破坏性确认 / 资源预算。
- 默认：提示词 + 动作日志；确认/预算作为可选开关。
- 影响：co-op 体验、信任、prompt injection 风险。

## Q8. 多人范围？

- 选项：单机/本地主机 / 专用服 + 其他玩家。
- 默认：单机/本地主机；专用服需要服务端 mod，后续再做。
- 影响：部署、同步、对话框归属、mod 内容同步。

## Q9. 助手记忆/人格？

- 选项：仅当前会话 / 跨会话 / 跨区块 / 跨存档。
- 默认：外部进程保存，跨区块保留；读档后提示可能不一致，允许重置。
- 影响：对话体验、存档兼容、隐私。

## Q10. 真实 mod adapter 的传输与鉴权？

- 选项：本地 socket + token / WebSocket / HTTP。
- 默认：localhost TCP + token + 版本握手 + 发现文件；MCP server 独占连接。
- 状态：已实现；固定场景默认 `PROBE_REQUIRE_AUTH=1`，数据面另有只读 token。
- 影响：安全、重连、多人。

## Q11. Harness 形态？

- 选项：脚本化动作序列 / 真实 LLM / 两者。
- 默认：先脚本化 MCP smoke，再接 LLM harness；固定地图 + 回放。
- 影响：验收速度、可重复性、token 成本。

## Q12. 观测 token 预算？

- 选项：每轮摘要 + 局部窗口 + 事件增量 / 全量。
- 默认：摘要 + 局部 + 增量；`detail/radius/since` 控制；大结果分页。
- 影响：上下文成本、决策质量。

## Q13. 助手身体类型是否固定？

- 已定：从核心生成，使用 `CoreBlock.unitType`；不同核心可能不同。
- 待确认：是否允许“固定为玩家初始单位类型”的特殊模式。


## Q14. 玩家能力对齐的范围

- 已记录：`docs/PLAYER-PARITY.md`
- 已确认：显式 `respawn(coreId)`；建筑控制要和单位附身分开；工厂是选择方案而不是队列；液体没有直接身体搬运；地面没有通用掉落物；不做蓝图/跨区域。
- 已拍板：允许助手控制 possess 借体；last-writer-wins 不抢占玩家 body；主动 pause/resume 开放但受 `Rules.pauseDisabled` 约束。
- 待拍板/实现：建筑控制范围、payload 入口、科技树图、多客户端单实例。

## Q15. 建筑控制

- v160.8 已确认 `ControlBlock` + `BlockUnitc`（TurretBuild 实现，具体方块按 `playerControllable` 枚举）。
- 待定：是否只开放炮塔，是否允许模组控制方块，控制期间的动作集合。

## Q16. 单位控制冲突

- 已拍板：队友式 last-writer-wins，不做硬锁；允许助手控制 `possess` 后的借体。
- 边界：不抢占玩家当前 body；AI 之间/对 AI 指令允许后操作覆盖前操作。
- 已实现 `command_units` session 工具；动作日志/覆盖粒度仍是后续加固项。

## Q17. 工厂方案配置

- 已确认：基础 `UnitFactory` 的 `config()` 是 `Integer currentPlan`；不是队列。
- `Reconstructor` 是固定 `[基础单位, 升级单位]` 表，接受 `UnitPayload`；不是选任意单位。
- `UnitAssembler` 是 Erekir 多方块组装，需求是 payload/item/liquid，需单独适配。
- 待实现：`get_config_schema`/方案列表；`configure` 接受 plan index；重生类型仍只由核心决定。


## Q18. 暂停/恢复

- 已拍板：开放主动 `pause`/`resume`。
- 规则：`Rules.pauseDisabled` 为 true 时拒绝；只有游戏进行中可用；`resume`
  必须能在 paused 状态通过动作门控；AI 不得借暂停跳过 tick/资源/冷却。
- 语义：last-writer-wins；不做“自动恢复”的隐含行为。
