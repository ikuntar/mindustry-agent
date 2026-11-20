# AI Probe Mod

最小真实游戏探针：在 Mindustry 服务端加载一个 Java mod，开本地 socket，
验证 `get_context` / `move_to` / `build` / `get_tile` 是否真的落到游戏里。

不是产品代码，也不是最终 adapter；它只用来证明“mod 能读状态、能控制单位、能走
`Build.beginPlace`”。

## 构建

```bash
cd probe-mod
./build.sh
```

默认使用 `../refs/mindustry-v160.8/server-release.jar`；可用
`MINDUSTRY_JAR=/path/to/server-release.jar ./build.sh` 覆盖。

## 运行

```bash
cp probe-mod/build/ai-probe.jar refs/mindustry-v160.8/config/mods/
cd refs/mindustry-v160.8
(printf 'host\n'; sleep 60) | java -jar server-release.jar
```

另开终端：

```bash
cd probe-mod
node client/probe-client.mjs
```

客户端会：

1. `get_context`，确认助手从核心生成；
2. `move_to` 到核心附近，轮询 `get_action_result`；
3. 在核心附近找一个合法 tile，`build` 一块 conveyor；
4. `get_tile` 读回（构建中是 `build1`，完成后是 `conveyor`）。

## 已验证 / 已知限制

- 助手身体从核心生成，`spawnedByCore=false`：v160.8 中非 Player 的
  `spawnedByCore=true` 单位会被引擎每帧 despawn。
- `UnitController` 自定义控制器能控制真实单位。
- `Unit.moveAt(Vec2)` 收的是**期望速度向量**，不是目标点；要自己算方向/速度。
- `build` 走 `BuildPlan` + `BuilderComp`，会真实扣资源并完成；建造前检查队伍资源，不足返回 `insufficient_resources`；客户端用
  `get_tile`/MCP `query_area` 读回。
- `withdraw`/`deposit`、`configure`、`command_units`、`set_stance`、`stop` 已在 probe 实现并实测；物流使用 220 范围与 `maxAccepted`。
- `mine` 在可达 sand tile 上实测完成；`attack` 支持 `unitId`/`buildingId`/`x,y`，建筑实测 220→0、坐标实测 done/inRange，单位目标仍缺独立验收；`follow` 仍缺稳定验收。
- `possess`/`release` 已实现：附身时 despawn home body，release 恢复目标控制器并在核心生成新身体；`respawn` 支持 `coreId`，可从同队不同核心重生。
- `follow` 已有 MCP 入口和移动跟随验证；`cancel` 支持全量取消和按 opId 定向取消。固定场景让 ally 移动后助手追到 30px 内，目标死亡/复杂避障仍简化。
- `move_to` 对地面单位使用 BFS 路径，避免 solid tile 并禁止对角切角；飞行单位仍直接移动。路径在目标变化时计算一次，不每 tick 寻路；`follow`/`attack` 的接近移动也走同一 helper，attack 绕障接近已用墙后容器验收。
- 空闲控制：每 10 tick 扫描武器射程内最近敌军，设置 `aimX/aimY/isShooting`；固定场景 dagger 被命中，health 150→123。
- 供弹防守：固定场景建 `duo` 炮塔和 feeder conveyor，从核心取 5 copper，炮塔 ammoTotal 6；连续 spawn 4 个敌人均被命中（150→141），弹药实际消耗到 0。
- 数据 token 轮换：probe `rotate_data_token` 更新 discovery；旧 token 401，新 token 200。
- 多客户端写互斥：`PROBE_REQUIRE_WRITER=1` 时先 `claim_writer`，写操作带 `writerToken`；第二个客户端 claim 得到 `writer_held`，无 token 写入得到 `writer_required`；`renew_writer` 续期，1s TTL 过期后新客户端可 claim。`scripts/run-writer-lock.sh` 验证 raw 客户端和 MCP adapter（`writer-harness`）两条路径。
- `get_tile` 现在返回建筑的 `items` 和炮塔 `ammoTotal`；`get_area` tile 也带同样的有限字段。
- 低血撤退：health < 30% 且空闲时优先退到远离敌人的同队核心，否则向远离最近敌军方向移动；固定场景核心距离 209→62、敌方距离 63→84。
- `deconstruct`/`repair` 已实现并实测：deconstruct 后建筑消失，repair conveyor 25→45。
- `get_events` 事件环已接：unit_destroy/unit_create/block_destroy/block_build_end/build_damage/unit_damage，支持 since/limit/next/dropped。
- 传输层：probe 写 `/tmp/mindustry-ai-probe/bridge-info.json`（port/token/protocol/version/pid）；`hello` 握手；`ping`/heartbeat；`PROBE_REQUIRE_AUTH=1` 启用 token 校验；socket 命令入队，游戏每帧最多处理 50 条。adapter 重连已有 fake probe 单测。
- `query_area` 的建筑扫描必须按世界 tile 读 `tile.build`；服务端 `Groups.build.getByID` 的 mapping 未启用。`query_area` 默认只返回助手队伍单位，`includeEnemies=true` 才返回敌军。`spawn_ally`/`spawn_enemy`/`spawn_ally_core`/`destroy_core`/`give`/`set_core_items`/`start_wave`/`set_possession_allowed`/`list_unit_types`/`set_type_player_controllable`/`set_writes_enabled`/`set_require_writer`/`get_unit`/`kill_assistant`/`damage_building` 是测试辅助，不是 MCP 工具；`get_unit` 额外返回 `isAI`/`isPlayer`/`playerControllable`/`controller`。
- `spawn_enemy` 默认 `ai=false`（IdleController，静止靶子）；传 `ai=true` 保留引擎默认 AI，单位会主动攻击。固定场景用 3 个 `ai=true` dagger 验证核心受击 1100→1082。
- 失败注入：固定场景验证未知物品 withdraw、越界 mine/move_to/build_plan、攻击同队单位、资源不足建造。
