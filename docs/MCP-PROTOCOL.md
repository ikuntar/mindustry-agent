# MCP 工具协议

状态：v0.1 设计稿，2026-11-18
适用范围：`mcp-server/` 对外暴露的 MCP 工具；当前由 `MockGameAdapter` 实现，真实 Mindustry mod adapter 后续替换。

---

## 1. 拓扑与传输

```
MCP host（Claude Desktop / 自建 agent）
   │ MCP (stdio)
   ▼
MCP server（Node/TypeScript）
   │ 本地 socket / JSON（真实实现）
   ▼
游戏 mod（进程内，读取 Vars / Groups / Build）
```

- MCP server 默认 stdio，由 host 启动。
- MCP server 与游戏 mod 的传输尚未实现；契约要求：
  - 只监听 `127.0.0.1`；
  - 发现文件 `mindustryx-ai-bridge/bridge-info.json`：`{host, port, token, version, pid}`；
  - 握手：`hello {protocolVersion, clientVersion}` → `welcome {gameVersion, toolVersion}`；
  - 断线重连；游戏读档后 session 重建。
- MCP server 不进入游戏渲染线程；所有动作进 mod 的队列，由游戏线程按预算执行。

当前实现：`MockGameAdapter` 在内存里模拟世界，用于协议、工具和 harness 测试。

---

## 2. 返回约定

所有工具返回 MCP `content: [{type:"text", text: "<json>"}]`。

成功：

```json
{ "ok": true, "data": { } }
```

失败（`isError: true`）：

```json
{ "ok": false, "error": { "code": "out_of_range", "message": "..." } }
```

常见错误码：

| code | 含义 |
|---|---|
| `bad_request` | 参数缺失/非法 |
| `out_of_bounds` | 坐标越界 |
| `out_of_range` | 超出交互/采矿/建造范围 |
| `invalid_placement` | 放置非法（地形/占用/规则） |
| `insufficient_resources` | 资源不足 |
| `not_found` / `unit_not_found` / `building_not_found` | 目标不存在 |
| `wrong_team` | 目标不属于助手队伍 |
| `not_possessable` | 目标不可附身 |
| `not_commandable` | 目标不可指挥 |
| `not_configurable` | 方块不可配置 |
| `assistant_dead` | 助手没有可用身体 |
| `no_core` | 没有可重生核心 |
| `queue_full` | 动作队列满 |
| `op_not_found` | opId 不存在/过期 |
| `internal_error` | 未预期错误 |

---

## 3. 动作生命周期

写工具立即返回 accepted 结果，不阻塞等待完成：

```json
{
  "ok": true,
  "data": {
    "opId": "op-12",
    "status": "queued",
    "progress": 0
  }
}
```

客户端用 `get_action_result` 查询：

```json
{ "opId": "op-12", "waitMs": 1000 }
```

返回：

```json
{
  "ok": true,
  "data": {
    "opId": "op-12",
    "status": "running",
    "progress": 0.4,
    "data": {},
    "error": null
  }
}
```

状态：`queued | running | done | failed | cancelled`。
`waitMs` 最大 5000；不要用工具调用等待长建造。

幂等：写工具支持 `requestId`（建议由 host 生成）用于去重；`build_plan` 用 `planId`。当前 v0.1 尚未在 mock 中实现 requestId 去重，协议保留。

---

## 4. 读工具

### `get_context`

参数：

```json
{
  "detail": "normal",     // summary | normal | full
  "radius": 15,           // 附近实体半径（tile）
  "since": 0,             // 可选：附带事件起点
  "includeEnemies": false, // 可选：额外返回 threats
  "maxUnits": 20           // 可选：单位列表上限，1–64
}
```

返回 `GameContext`：tick、timeMs、paused、gameOver、map、mode、wave、enemies、team、teamName、player、assistant、resources、cores、counts、nearby、threats、unitsTruncated、eventsSince、eventsPending、eventSummary。

`detail=summary` 不带 nearby；`full` 可扩大实体和字段；`radius` 以 tile 为单位；`includeEnemies=true` 时 `threats` 最多 16 个敌军。

### `get_capabilities`

返回当前身体的 `Capabilities`：health、speed、flying、buildSpeed、buildRange、mineSpeed、mineTier、mineRange、itemCapacity、payloadCapacity、canBoost、weapons、commands、canBuild、canMine、canAttack、canPossess。

### `get_content`

参数：`{ "type": "all" | "blocks" | "units" | "items" | "liquids", "query": "dag", "limit": 20 }`。`query` 按名称子串过滤，`limit` 限制每类返回条目数（最大 500）。
返回真实游戏注册表条目；blocks 含 `name/size/health/requirements`，units 含 `name/health/flying/playerControllable`。

### `get_map_summary`

无参数。返回地图 `DatasetRef`、revision、schema、字节数和只读访问信息；**不返回 tile 矩阵**。

```json
{
  "ref": "obs://map/rev/3",
  "revision": 3,
  "kind": "map",
  "format": "raw-v1",
  "schema": {
    "width": 256,
    "height": 256,
    "layers": ["block_id", "team", "drop_id", "solid"],
    "dtype": "int16-le",
    "coord": "tile"
  },
  "bytes": 524304,
  "access": {
    "mode": "http-readonly",
    "baseUrl": "http://127.0.0.1:46501/data",
    "readOnly": true,
    "expires": 1234567890
  }
}
```

客户端代码通过 `DatasetRef` 读只读数据面；完整地图不进入工具结果。详见 `docs/REMOTE-DATA-PLANE.md`。

### `get_events`

参数：

```json
{ "since": 0, "limit": 50, "summary": false, "types": ["unit_destroy"] }
```

- `summary=false`：返回 `{events, next, dropped, hasMore}` 原始事件页。
- `summary=true`：返回 `{summary:{total,byType}, next, dropped, ref, hasMore, bytes}`，不返回事件数组；`ref` 指向只读事件快照。
- `types` 在游戏侧过滤，避免高频 `build_damage` 淹没决策事件。
- 完整事件数据仍由只读数据面 `/data/events/{revision}` 提供，不进入 MCP 上下文。

事件结构：

```json
{
  "id": 12,
  "type": "core_damage",
  "tick": 345,
  "timeMs": 12345,
  "data": { "coreId": 1000, "amount": 20 }
}
```

建议事件类型：`wave_start`、`wave_end`、`core_damage`、`building_destroyed`、`unit_destroyed`、`resource_low`、`resource_full`、`build_complete`、`player_damaged`、`assistant_damaged`、`action_done`、`action_failed`、`possessed`、`released`、`respawned`。

### `get_area`

参数：`{ "x": 20, "y": 20, "radius": 6, "maxTiles": 256 }`。

只读 bounded tile window，供没有代码执行能力的 host 使用：
- `radius` 以 tile 为单位，最大 24
- 默认最多 256 个 tile，最大 512
- 返回 `{x,y,radius,tiles:[{x,y,block,team,drop?,solid,items?,ammoTotal?}],truncated}`
- 不返回全图；需要大范围分析时用 `get_map_summary` + 数据面

### `query_area`

参数：`{ "x": 20, "y": 20, "radius": 10, "includeUnits": true, "includeBuildings": true, "includeEnemies": false }`。
返回局部 `units` / `buildings`；`includeEnemies=true` 时包含非助手队伍单位。

### `get_config_schema`

参数：`{ "block": "sorter" }`。
返回 `{block, configurable, fields:[{key,type,values?}]}`；`type` 为 `item|liquid|block|unit|boolean|string|number|point`。

### `get_action_result`

参数：`{ "opId": "op-12", "waitMs": 0 }`。返回 `ActionResult`。

### `get_action_log`

参数：`{ "limit": 50 }`（最大 128）。返回最近动作的 `opId`、`kind`、`status`、`progress`、`createdTick` 和 data，用于出错后审计尝试过的动作。

---

## 5. 写工具

所有写工具都返回 `ActionResult`（accepted/opId），并遵守权限矩阵。
所有工具还接受可选的 `idempotencyKey`；同一 key 的成功结果在 MCP 进程内复用，不会重复执行动作。

### 单位

- `move_to { x, y, arriveRadius? }`
- `attack { target: { unitId? | buildingId? | x?, y? } }`
- `follow { unitId, distance? }`
- `mine { x, y }`
- `stop {}`
- `cancel { opId? }`

### 建造

- `build_plan { placements: [{block,x,y,rotation?,config?}], deconstruct?: [{x,y}], allowPartial? }`
  - 逐块校验、扣费、建造；`allowPartial=false` 时任一失败整单拒绝。
  - 最大 256 个 placement。
- `deconstruct { targets: [{x,y}] }`
- `repair { x, y }`

### 物流

- `withdraw { target: {buildingId?|x?,y?}, item, amount }`
  - 同队、`within(build, 220)`、助手容量。
- `deposit { target: {buildingId?|x?,y?}, item, amount }`

### 配置

- `configure { x, y, value }`
  - `value` 支持 `string|number|boolean|null|{item}|{liquid}|{block}|{unit}|{x,y}`。
  - 同队、方块可配置；逻辑处理器代码额外校验。

### 指挥

- `command_units { unitIds?, command, target?, queue?, stance? }`
  - `command`: `move|attack|repair|rebuild|assist|mine|enterPayload|loadUnits|loadBlocks|unloadPayload|loopPayload`
  - 目标单位必须同队、`CommandAI`、`allowCommand`。
- `set_stance { unitIds, stance }`
  - `stance`: `stop|holdFire|pursueTarget|patrol|ram|boost|holdPosition|mineAuto`

### 附身/重生

- `possess { unitId }`
- `release {}`
- `respawn { coreId? }`

---

## 6. 权限矩阵

| 动作 | 单位身份 | 玩家权限子集 | 引擎校验 |
|---|---|---|---|
| 移动/攻击/采矿/建造/拆除/修理/payload | 是 | — | UnitType + 队伍/规则 |
| 取物/存物/丢弃 | 是（容量） | 是 | 同队 + 220 范围 + maxAccepted |
| 配置建筑 | — | 是 | 同队 + configurable + value 校验 |
| 指挥单位 | — | 是 | 同队 + CommandAI + allowCommand |
| 附身/控制 | — | 是 | 同队 + isAI + playerControllable + possessionAllowed |
| 从核心重生 | — | 是 | 同队 + allowSpawn + supportsEnv + 核心类型 |
| 暂停/变速/研究/发射/存档/管理员 | — | 否 | 不暴露 |

所有动作以 `assistant.unit/team` 为 actor；禁止使用 `Vars.player` 作为 actor 来获取玩家身份。

---

## 7. MockGameAdapter

用途：在没有真实 mod 的情况下验证 MCP 协议、工具 schema、动作生命周期和 harness。

行为：

- 64×64 地图，两队；助手/玩家 alpha，同队 dagger，敌方 dagger。
- 两个核心（10,10 / 30,30）；资源 copper/lead/graphite；若干传送带/分拣器/处理器。
- 动作按 tick 推进（默认 50ms）；`autoTick=false` 时可由测试调用 `advance(ms)`。
- 建造每块扣 10 copper，逐块完成；拆除/修理/取物/配置/指挥/附身/释放/重生都有基本校验。
- 附身：home body 删除；借体解控恢复 AI 并留在世界；重生绕人口（mock 不做人口）。
- 事件日志最多 500 条，溢出计 `dropped`。

限制：

- 不是 Mindustry 物理/规则模拟；只验证接口和状态机。
- 真实 mod adapter 必须替换所有动作实现，并复用同一契约。

---

## 8. 真实 adapter 待实现清单

当前进度：

- 已实现 `ProbeGameAdapter`：`get_context` / `get_capabilities` / `get_area` / `query_area` / `get_content` / `move_to` / `build_plan` / `withdraw` / `deposit` / `configure` / `command_units` / `set_stance` / `stop` / `attack` / `mine` / `follow` / `possess` / `release` / `respawn` / `deconstruct` / `repair` / `cancel`；`get_content` 从游戏内容读取。、
- `get_events` 已接真实事件环；大体积地图/事件不通过 MCP 工具结果传输，见 `docs/REMOTE-DATA-PLANE.md`。
`unit_destroy`/`unit_create`/`block_destroy`/`block_build_end`/`build_damage`/`unit_damage`，支持 `since/limit/next/dropped`；高频 `build_damage` 会占满页。
- `attack` / `follow` 已接入口。`attack` 支持单位/建筑/坐标三种目标：建筑实测 `targetHealth 220→0`，坐标实测 done/inRange；单位目标未独立验收。`follow` 仍缺稳定验收。
- `respawn` 已实测死亡后核心重生。
- 其余动作（`deconstruct`/`repair`/`cancel` 之外）仍有 probe 未实现项；不是假成功。
- 已验证 `query_area` 能读回真实 `conveyor`/`sorter`；`withdraw`/`deposit` 的 copper 5 与 `get_context` 携带量一致；`configure` sorter 成功；`command_units` 的 dagger 位移；`set_stance` holdPosition 成功。
- 已验证附身/释放：home body despawn、目标 dagger 接管、release 后新 alpha 在核心生成；`isHome/possessing` 读回正确；`respawn` 死亡后 id 211→212、health 150。`mine` 实测 sand 1，`attack` 实测 220→0。

待实现：
- 重连、多客户端互斥、token 轮换（重连/心跳已有 fake probe 单测）。
- 游戏线程动作队列 + 每帧预算；LLM 调用离线程（probe 已有每帧 50 条上限，正式 adapter 还需要更细预算/背压）。
- `get_context` 的真实数据（单位/建筑/核心/资源/波次）；`get_content` 仍静态。
- 真实 `build_plan`：逐块 `Build.validPlace` + `Build.beginPlace(assistantUnit, ...)` + 物品/时间；不允许 `constructFinish`。
- 真实 `withdraw/deposit`：`interactable` + 220 范围 + `maxAccepted`；不用 `Vars.player`。
- 真实 `configure`：`build.configured(assistantUnit, value)`；逻辑代码校验。
- 真实 `command_units`：直接操作 `CommandAI`；不从 `InputHandler.commandUnits(Vars.player, ...)` 走。
- 真实 `possess/release/respawn`：状态机按 `docs/ASSISTANT-DESIGN.md`。
- 助手 `AssistantController`：本地寻路/索敌/开火/建造/撤退。
- 事件：`Events` + 轮询补足（波次、核心受击、资源阈值等）。
- 鉴权、限流、动作日志、停机开关。

---

## 9. Harness 约定

harness 通过 MCP stdio 连接，不应直接 import adapter（真实 mod 也不允许）。
最小序列：

1. `listTools` 应包含读/写工具。
2. `get_context` → 检查 assistant/team/resources。
3. `move_to` → `get_action_result`。
4. `build_plan` → 观察资源扣减和 `build_complete` 事件。
5. `withdraw` / `configure` / `command_units` / `possess` / `release` / `respawn`。
6. `get_events` 验证事件序列和 dropped。
7. 取消/失败路径：越界、资源不足、错队、不可附身、无核心。

当前 `mcp-server/test/` 和 `mcp-server/harness/` 是这套约定的实现起点。
