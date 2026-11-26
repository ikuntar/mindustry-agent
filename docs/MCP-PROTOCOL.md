# MCP 工具协议

状态：Node MCP 实现说明，2026-11-26，`mindustry-agent` 0.4.2。
适用范围：`mcp-server/` 对外暴露的 MCP 工具。当前同时有 `MockGameAdapter`（协议测试）和
`ProbeGameAdapter`（真实 v160.8 + probe mod）；Node MCP 当前 27 个工具，mod session API
当前 35 个工具。本文描述 Node MCP 的协议和动作语义；session API 的完整工具面见
`docs/SESSION-API.md`。

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
- `ProbeGameAdapter` 已通过本地 TCP 连接 probe mod；发现文件为
  `mindustry-agent-probe/bridge-info.json`，包含 `port`、`token`、`protocol`、
  `version`、`dataPort`、`dataToken` 等字段。
- 握手：`hello {token}` → `{protocol, requireWriter, ...}`；需要写权限时再
  `claim_writer` 取得 writer token；断线自动重连并重新握手。
- MCP server 不进入游戏渲染线程；所有动作进 mod 的队列，由游戏线程按预算执行。

当前实现：`MockGameAdapter` 在内存里模拟世界，用于协议、工具和 harness 测试；
`ProbeGameAdapter` 连接真实游戏。未支持的 op 会显式失败，不会假装成功。

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
| `op_capacity` | 活跃 op 达到 256 上限，拒绝新动作（HTTP 503） |
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

幂等：所有工具接受可选 `idempotencyKey`；同一个 key 的成功结果在 MCP 进程内复用，
不会重复执行动作。`build_plan` 使用同一个机制，计划内容由 host 自己保证稳定。

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
  "maxUnits": 20,          // 可选：单位列表上限，1–64
  "maxBytes": 0            // 可选：上下文字节预算，0=不限
}
```

返回 `GameContext`：tick、timeMs、paused、gameOver、map、mode、wave、enemies、team、teamName、player、assistant、resources、cores、counts、nearby、threats、unitsTruncated、threatsTruncated、bytesTruncated、bytes、eventsSince、eventsPending、eventSummary。

`maxBytes` 会优先裁剪 units/threats；若固定字段仍超预算，`bytesTruncated=true`。`bytes` 是序列化后的大致字节数，不是 token 数。

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
    "drop_id": "0=none, item.id+1 otherwise; see dropIds",
    "dropIds": {"copper": 1, "lead": 2, "...": "..."},
    "items": {"copper": 0, "lead": 1, "...": "..."},
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

只读 bounded window，供没有代码执行能力的 host 使用。`x/y`、`radius` 和返回 tile
都是 **tile 坐标**；不返回全图：
- `radius` 以 tile 为单位，最大 24
- 默认最多 256 个 tile，最大 512
- 返回 `{x,y,radius,tiles:[{x,y,block,team,drop?,solid,items?,ammoTotal?}],truncated,coverage:{x0,y0,x1,y1,next?}}`；`maxTiles` 按行优先截断，`coverage.next` 是第一个未返回的 tile
- 不返回全图；需要大范围分析时用 `get_map_summary` + 数据面

### `query_area`

参数：`{ "x": 20, "y": 20, "radius": 10, "includeUnits": true, "includeBuildings": true, "includeEnemies": false }`。
返回局部 `units` / `buildings`；`includeEnemies=true` 时包含非助手队伍单位。建筑可带 `itemList` 和炮塔 `ammoTotal`。

### `get_config_schema`

参数：`{ "block": "sorter" }`。
返回 `{block, configurable, fields:[{key,type,values?}]}`；`type` 为 `item|liquid|block|unit|boolean|string|number|point`。

### `get_action_result`

参数：`{ "opId": "op-12", "waitMs": 0 }`。返回 `ActionResult`。失败时 `data` 保留失败原因（如 `code=timeout`），并带 `paused` 表示当前游戏是否暂停；暂停时 op 可能保持 `running`，客户端必须结合 `paused` 判断。

### `get_action_log`

参数：`{ "limit": 50 }`（最大 128）。返回最近动作的 `opId`、`kind`、`status`、`progress`、`createdTick` 和 data，用于出错后审计尝试过的动作。

---

## 5. 写工具

所有写工具都返回 `ActionResult`（accepted/opId），并遵守权限矩阵。
`status=done` 表示游戏状态已实际变化，不是“请求已入队”：build 等到 tile 出现方块，
deconstruct 等到目标消失，mine 等到携带量增加，configure 等到 config 回读匹配；
计划被引擎丢弃返回 `build_dropped`/`deconstruct_dropped`，目标消失返回 `target_gone`，
助手死亡/换体返回 `assistant_gone`。
所有工具还接受可选的 `idempotencyKey`；同一 key 的成功结果在 MCP 进程内复用，不会重复执行动作。
工具注册可用 `MCP_ALLOWED_TOOLS` / `MCP_DENIED_TOOLS` 过滤；未注册的工具不会被 `listTools` 暴露。
写工具可用 `MCP_WRITE_RATE_LIMIT`（每秒）限制，超限返回结构化 `rate_limited`。

### 单位

- `move_to { x, y, arriveRadius?, timeoutTicks? }`；`x/y` 和 `arriveRadius` 都是 tile；`timeoutTicks` 超时后 op `failed`，`data.code=timeout`。
- `attack { target: { unitId? | buildingId? | x?, y? }, timeoutTicks? }`；超时后 op `failed`、`data.code=timeout`。
- `follow { unitId, distance?, timeoutTicks? }`；超时后 op `failed`、`data.code=timeout`。
- `mine { x, y, timeoutTicks? }`；超时后 op `failed`、`data.code=timeout`。
- `stop {}`
- `cancel { opId? }`

### 建造

- `build_plan { placements: [{block,x,y,rotation?,config?}], deconstruct?: [{x,y}], allowPartial? }`
  - 按顺序逐块校验/扣费/建造；`allowPartial=false` 遇到首个失败就停止，但之前成功的块已经生效，不是原子事务。
  - 最大 256 个 placement。
  - 返回 `status` 和 `data.results`；每项带 `x/y/block`。失败时可能省略 `opId`，不要轮询空字符串。
  - 单块 `build` 返回 `running`，直到目标 tile 出现该 block 才 `done`；计划被引擎丢弃时 `failed`、`data.code=build_dropped`；campaign 未解锁时 `block_locked`。
- `deconstruct { targets[], allowPartial?, skipMissing?, timeoutTicks? }`；`allowPartial=true` 跳过已消失/不可拆目标并在 `data.skipped` 报告；超时后 op `failed`、`data.code=timeout`，`data.targets` 给出逐目标状态。
- `repair { x, y, timeoutTicks? }`；仅对 `UnitType.canHeal` 的身体可用。Alpha/Beta/Gamma builder body 在 Serpulo 没有修复能力，返回 `cannot_repair`；不要用拆建或治疗单位冒充。

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
| 暂停/变速/研究/发射/存档/管理员 | — | 否 | Node MCP 不暴露；mod session 的 `pause`/`resume` 是独立入口，见 SESSION-API |

所有动作以 `assistant.unit/team` 为 actor；禁止使用 `Vars.player` 作为 actor 来获取玩家身份。

---

## 7. MockGameAdapter

用途：在没有真实 mod 的情况下验证 MCP 协议、工具 schema、动作生命周期和 harness。

行为：

- 64×64 地图，两队；助手自定义 `mindustry-agent-ai-alpha`（外观为 alpha），玩家 alpha，同队 dagger，敌方 dagger。
- 两个核心（10,10 / 30,30）；资源 copper/lead/graphite；若干传送带/分拣器/处理器。
- 动作按 tick 推进（默认 50ms）；`autoTick=false` 时可由测试调用 `advance(ms)`。
- 建造每块扣 10 copper，逐块完成；拆除/修理/取物/配置/指挥/附身/释放/重生都有基本校验。
- 附身：home body 删除；借体解控恢复 AI 并留在世界；重生绕人口（mock 不做人口）。
- 事件日志最多 500 条，溢出计 `dropped`。

限制：

- 不是 Mindustry 物理/规则模拟；只验证接口和状态机。
- 真实 mod adapter 必须替换所有动作实现，并复用同一契约。

---

## 8. Probe adapter 状态与剩余项

当前 `ProbeGameAdapter` 已接入 Node MCP 的 27 个工具，包括 context、capabilities、
content、map/event 数据面、局部区域查询、配置 schema、移动/攻击/跟随/采矿/停止、
建造/拆除/修理、取物/存物、配置、指挥/姿态、附身/释放/重生、动作结果与取消。

真实游戏验证、逐项验收和剩余缺口以以下文档为准：

- `docs/REALITY-CHECK.md`：真实 v160.8 测试记录（历史工具数已在页首说明）
- `docs/PLAYER-PARITY.md`：当前 mod session API 的 35 个工具和玩家能力对齐
- `docs/SESSION-API.md`：session REST/MCP 入口的完整契约

仍属于工程边界的事项：多客户端互斥、完整重连/心跳矩阵、精细的每帧动作预算与背压、
跨 sector/长期战役场景。不要把“Node MCP 有 27 个工具”误写成“session API 只有 27 个”；
后者当前是 35 个。

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
