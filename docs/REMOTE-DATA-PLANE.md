# REMOTE DATA PLANE

状态：已选方案 A（2026-11-20）
范围：远程 MCP 场景下的地图/事件等大体积观测数据
关联：`docs/MCP-PROTOCOL.md`、`docs/ASSISTANT-DESIGN.md`、`TASKS.md`

## 0. 结论

采用 **远程只读数据面 + 客户端代码分析**：

- MCP 控制面只返回摘要、游标和 `DatasetRef`，不返回整张地图或完整事件日志。
- 大体积数据由游戏侧写入只读快照，通过 HTTP(S) 只读端点提供；客户端代码按 `ref` 下载并在本地分析。
- 不要求客户端和游戏同机，不要求客户端有游戏目录写权限。
- 游戏 JVM 不执行模型生成的代码；代码在客户端沙箱或本地代码运行时执行。
- 如果客户端没有代码执行能力，退回 `get_area` / `get_events` 的有界查询；如果数据不允许出服务器，改用服务端查询（方案 B）。

这里的“远程”指 MCP 控制面可以走网络；数据面是同一服务的只读 HTTP 端点，不需要共享文件系统。

## 1. 原则

1. **MCP 工具结果必须有硬上限**：默认不超过 8 KiB JSON；超限返回 `truncated`、`hasMore`、`next` 或 `ref`，不静默截断。
2. **原始数据只进代码运行时，不进模型上下文**：模型看到 manifest/schema/摘要；代码看到完整快照。
3. **一份权威快照，多个消费者**：游戏侧维护不可变 `revision`；MCP、客户端代码、UI 都按 revision 读取，不各自生成副本。
4. **客户端只读**：数据面只允许 GET/HEAD；所有写操作仍走 MCP 动作工具和游戏权限。
5. **同机只是开发优化**：`file://` 本地路径只用于 probe/co-op 调试；正式网络部署使用 `https://` 只读端点。
6. **代码执行位置决定数据访问方式**：代码在客户端，就传只读快照；代码在服务端，才需要服务端沙箱。方案 A 选择前者。

## 2. 拓扑

```text
                 MCP control (HTTP/stdio)
  Agent host  <-------------------------->  Mindustry MCP gateway
      |                                           |
      |  GET /data/... (read-only, range)         |  actions / summaries
      v                                           v
  Client code runtime                       Game mod / probe
  (sandbox, temp dir)                       (snapshot writer)
      |                                           |
      +---------- DatasetRef / revision ----------+
```

- MCP 控制面：现有 24 个工具，新增/调整读工具返回 `ref`。
- 数据面：只读 HTTP(S)，可和 MCP gateway 同进程，也可独立部署。
- 快照写入：游戏侧在 tick/地图变化窗口生成 revision；客户端永远不写。
- UI 可以直接使用同一数据面，不经过 MCP，也不经过 LLM。

## 3. DatasetRef 数据模型

MCP 返回的引用对象：

```json
{
  "ref": "obs://map/rev/123",
  "revision": 123,
  "kind": "map",
  "format": "npz",
  "schema": {
    "width": 256,
    "height": 256,
    "layers": ["block_id", "team", "ore_id", "solid"],
    "dtype": "int16",
    "coord": "tile"
  },
  "counts": {
    "buildings": 42,
    "enemy_units": 3
  },
  "access": {
    "mode": "http-readonly",
    "baseUrl": "https://mcp.example/data",
    "readOnly": true,
    "expires": 1234567890
  }
}
```

字段约定：

| 字段 | 含义 |
|---|---|
| `ref` | 不透明句柄；模型只传它，不解析路径 |
| `revision` | 不可变快照版本；同一 revision 内容不变 |
| `kind` | `map` / `events` / `replay` 等 |
| `format` | `npz` / `zarr` / `parquet`；客户端按 schema 解码 |
| `schema` | 维度、dtype、层名、坐标单位；不含实际数据 |
| `access.baseUrl` | 只读 HTTP 根地址；不含 token |
| `expires` | 访问有效期；过期返回 `ref_expired` |

**不把 token 放进 `access` 正文。** 客户端代码通过本地凭据存储/环境变量解析 token；必要时才用 `resolve_dataset` 返回短 TTL 签名 URL，作为没有本地凭据时的 fallback。

## 4. MCP 接口调整

### `get_map_summary`

只返回摘要和 `DatasetRef`，不返回 tile 矩阵。

```json
{
  "ref": "obs://map/rev/123",
  "revision": 123,
  "kind": "map",
  "format": "npz",
  "schema": { "...": "..." },
  "counts": { "buildings": 42, "enemy_units": 3 },
  "bytes": 320
}
```

### `get_events`

默认摘要模式；完整事件不回 MCP。

```json
{
  "summary": {
    "total": 42,
    "byType": { "build_damage": 38, "unit_destroy": 4 }
  },
  "next": 142,
  "ref": "obs://events/rev/142",
  "bytes": 410,
  "hasMore": false
}
```

需要细节时用 `get_events_page` 或客户端代码读取 `events.parquet`；单页仍受 `limit`/`maxBytes` 限制。

### `get_area`

只用于小范围调试/模型即时决策，保留现有的实体窗口查询；不等价于“全图数据”。

### `resolve_dataset`

可选 fallback：把 `ref` 换成一个短期、只读、限定 revision 的 URL。

- 无客户端凭据时才用。
- URL 进入上下文是可以接受的边界，但 token 必须短期、只读、不可写。
- 更推荐客户端 SDK 用本地凭据解析，模型看不到 token。

### 不新增

- 不新增 `get_map` 全图 JSON 工具。
- 不通过 MCP 传 base64 图片、二进制地图或完整事件数组。
- 不在游戏 JVM 中执行模型代码。

## 5. 数据面 HTTP 规范

### 5.1 路径

```text
GET /data/map/{revision}
GET /data/map/{revision}/chunk/{cx}/{cy}
GET /data/events/{revision}
GET /data/events/{revision}/page/{cursor}
GET /data/manifest/{revision}
```

- `revision` 只接受服务端生成的数字/不透明 ID，不接受路径穿越。
- 地图 chunk 使用 `Range` 或固定 chunk 路径；事件页使用游标。
- 所有端点只允许 GET/HEAD；`PUT/POST/PATCH/DELETE` 统一 405。

### 5.2 鉴权

- `Authorization: Bearer <data-token>`。
- token 只读、限定 revision、带过期时间；不得复用 MCP 动作 token。
- token 不写进 URL query；只有 `resolve_dataset` 的短期签名 URL 例外。
- 客户端凭据文件权限 0600；不进入 MCP tool result。
- 错误码：`401 unauthorized`、`403 forbidden`、`410 ref_expired`。

### 5.3 格式

- 地图：`npz`（当前 256×256 够用）或 `zarr`（大地图/chunk）；manifest 描述层和 dtype。
- 事件：Parquet，列包含 `id/type/tick/time_ms/team/x/y/entity_id/severity`；支持列裁剪。
- manifest：JSON，最大 8 KiB；只含 schema/统计/ref，不含数据。
- 响应带 `ETag`/`Content-Length`；客户端按 revision 缓存。

### 5.4 快照生命周期

- 游戏侧在固定 tick 或地图变化窗口生成不可变 revision。
- 同一 revision 禁止原地修改；新内容生成新 revision。
- 默认保留最近 N 个 revision（建议 8）；过期后旧 ref 返回 `ref_expired`。
- 不要求客户端有写权限；快照写入只发生在游戏侧自己的临时目录/对象存储。
- 如果服务器无法写磁盘，则从内存快照流式返回；仍不要求客户端写。

## 6. 客户端代码

### 6.1 Hermes / 本地代码运行时

1. 模型调用 `get_map_summary`，拿到 `ref`/schema。
2. 模型用 `execute_code` 写分析代码；代码通过客户端 SDK 读取 ref。
3. SDK 从本地凭据/环境变量取 token，通过 HTTP Range 下载所需 chunk。
4. 代码只把聚合结果/前 N 条输出到 stdout；完整中间结果写临时文件，不进入上下文。
5. 代码结束时清理临时数据；快照由客户端缓存按 revision 管理。

示例：

```python
from mindustry_data import open_dataset

ds = open_dataset("obs://map/rev/123")
blocks = ds.layer("block_id")
teams = ds.layer("team")

print({
    "enemy_tiles": int((teams != 1).sum()),
    "buildings": int((blocks != 0).sum()),
})
```

### 6.2 没有代码运行时的 host

- 使用 `get_area` / `get_events` 的有界查询；
- 或使用方案 B 的服务端查询/沙箱；
- 不为了让 host “能看”而退回全量 JSON。

### 6.3 输出与预算

- 代码输出上限建议 8 KiB；超限写 artifact 并返回路径/摘要。
- 不允许把原始数组直接 `print`；SDK 可提供 `summarize()`。
- 代码执行不在游戏线程，不持有游戏动作权限。

## 7. 安全与边界

必须做：

- 数据面只读；客户端无写入路径。
- token 作用域：单 revision、只读、短期；不能跨 revision/团队。
- 路径参数白名单；禁止任意文件路径。
- 代码沙箱：无网络、只读挂载、CPU/内存/时间上限、输出上限。
- 速率限制和最大响应尺寸；大请求返回 `413`/`429`。
- 日志不记录 token；错误消息脱敏。

明确防不住/不做：

- 客户端代码沙箱不是强安全边界；恶意代码仍可能耗尽本地资源；需要独立进程/容器限额。
- 数据面只解决“数据不进模型上下文”，不解决“模型代码本身可能有 bug”。
- 远端客户端需要网络出口；纯 MCP host 无代码执行时只能用有界查询。
- 方案 A 不做服务端代码执行；“不能出服务器”的场景改用方案 B。

## 8. 验收标准

1. `get_map_summary` 响应 ≤ 8 KiB，且不含 tile 数组。
2. 客户端代码能通过 `DatasetRef` 读取地图 chunk，算出聚合结果；MCP tool result 不包含原始地图。
3. `GET /data/...` 无写方法；跨 revision/过期 token 返回 401/403/410。
4. 同一 revision 两次读取内容 hash 一致；新 revision 不复用旧 ref。
5. 事件摘要页不超过 `maxBytes`，高频 `build_damage` 被聚合，不淹没 `unit_destroy`/`core_damage`。
6. 没有代码运行时的 host 能走 `get_area`/`get_events` 有界查询，不需要全量数据。
7. 客户端不拥有游戏目录写权限时仍能完成分析流程。

## 9. 分阶段实施

### Phase 1：文档与接口冻结

- 本文件。
- `DatasetRef`/manifest schema。
- MCP 读工具返回字段冻结。
- TASKS 增加数据面条目。

### Phase 2：probe 只读数据面（已实现）

- 游戏侧生成地图快照 revision（内存，最多保留 8 个）。
- HTTP GET/HEAD + token；`/data/manifest/current`、`/data/map/{rev}`、`/data/events/{rev}`。
- 当前 probe 格式为 **raw-v1**（`MND1` 头 + int16 层），不是最终 npz/zarr；事件为 NDJSON，不是最终 Parquet。
- discovery/manifest 返回 `dataBaseUrl`/`dataToken`/ref。
- 本地 dev 仍可用 `file://`，但标记为 dev-only。

### Phase 3：客户端 SDK（已实现最小版）

- `mindustry_data.open_dataset(ref)`。
- 本地 token 解析、raw-v1 地图解码、NDJSON 事件读取；无 numpy 时回退纯 Python。
- Hermes `execute_code` 示例和输出预算。
- `mindustry_data/demo.py` 和 `test_data_plane.py` 已跑通。

### Phase 4：MCP 接入（部分完成）

- `get_map_summary` 已接 MCP，返回 `DatasetRef`/schema，不含 tile。
- `get_events` 仍返回原始事件页；摘要模式/ref 聚合待补。
- 移除任何“全图 JSON”假设。
- 事件聚合在游戏侧待补。

### Phase 5：验收与压测

- 大事件量、地图 chunk、token 过期、无代码 host、无写权限客户端。
- 记录字节数、延迟、缓存命中率、上下文 token。

## 10. 默认值表（可否决）

| 项 | 默认 |
|---|---|
| 部署 | 远程 MCP + 客户端代码 |
| 数据面 | 只读 HTTPS，GET/HEAD |
| 同机 | 不需要 |
| 客户端写权限 | 不需要 |
| 地图格式 | npz（当前）/ zarr（大地图） |
| 事件格式 | Parquet |
| manifest 上限 | 8 KiB |
| 工具结果上限 | 8 KiB |
| revision 保留 | 最近 8 个 |
| token | 只读、单 revision、短期 |
| 无代码 host | 有界查询 fallback |
| 数据不出服务器 | 转方案 B |
| 游戏 JVM 执行模型代码 | 禁止 |
