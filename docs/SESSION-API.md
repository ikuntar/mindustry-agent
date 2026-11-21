# 单 Mod + 会话 API 设计

状态：Phase 2 MVP + Phase 3 弹窗代码 + Phase 4 数据面 + Phase 5 可选 MCP（2026-11-21）。
`probe-mod` 内已加入 `/session`、`/context`、`/actions`、`/actions/{opId}`、`/guide`、
`/tools`、LAN 绑定、客户端 session prompt 弹窗、session server `/data`，以及
`POST /mcp` 的最小 MCP Streamable HTTP 子集；弹窗尚未做 UI 实测，SSE/resources、
Android 尚未实现。当前开发路径仍是 probe socket + Node MCP server。

目标：普通用户只安装一个 Mindustry mod，按需启动一局 AI 会话；不安装 Node、
不常驻 MCP、不安装 skill，也不需要把 MCP 永久配置进 coding harness。

## 1. 使用模型

- Mindustry 和 harness 是两个独立软件。
- AI 是可选功能：不是每局都要用。
- 每局开始时，mod 弹窗给出一段 **session prompt**。
- 用户把 prompt 粘贴到 omp/Claude/Codex 等新会话。
- harness 通过 HTTP 调用游戏内 API，完成本局任务。
- 关闭游戏/进程退出后，endpoint 和 token 全部失效。
- 不需要跨会话 MCP 配置、skill 或 agent 记忆。

这比“把 MCP 永久安装到 coding harness”更符合实际使用：写代码和玩游戏完全分离。

## 2. 组件形态

目标：

```text
Mindustry + ai-probe.jar
  ├── 游戏内工具实现
  ├── HTTP session/control API
  ├── HTTP data plane
  ├── 一次性 bootstrap token
  └── 游戏内弹窗（session prompt）

harness（omp 等）
  └── 粘贴 session prompt，用 shell/HTTP 工具调用
```

不再需要：

- Node mcp-server
- npm/启动脚本
- 全局 MCP 配置
- omp skill
- 永久保留的 token 文件

## 3. 网络绑定

目标默认：

```text
bind: 0.0.0.0
port: 47600
auth: Bearer token
```

原因：用户可能用手机/另一台电脑上的 harness 控制当前游戏。

启动时枚举非 loopback IPv4，生成：

```text
EndpointInfo:
  loopbackUrl: http://127.0.0.1:47600
  lanUrls: [http://192.168.1.23:47600, ...]
  protocolVersion: 1
  toolCount: 10
  guideVersion: 1
```

弹窗显示当前可用的局域网地址；用户选一个复制。

安全约束：

- 所有请求必须带 token，不允许匿名 LAN 访问。
- token 不放进 URL query。
- 默认不自动做公网端口映射。
- 关闭游戏后端口关闭，所有 token 失效。
- 不支持无 TLS 的公网直接暴露；不可信网络要求 WireGuard/Tailscale 等隧道。
- token 不写日志；错误信息不回显 Authorization。

## 4. 一次性握手与 session token

每局启动生成 **bootstrap token**：

```text
bootstrapToken = random(32 bytes)
bootstrapUsed = false
sessionToken = random(32 bytes)
sessionExpires = game process lifetime
```

握手：

```http
POST /session
Authorization: Bearer <bootstrapToken>
Content-Type: application/json

{}
```

成功：

```json
{
  "sessionToken": "***",
  "expires": "game-process",
  "apiVersion": 1,
  "promptVersion": 1
}
```

规则：

- bootstrap token 只能成功使用一次；成功后立即置为 used。
- 后续所有 API 使用 `sessionToken`，不再使用 bootstrap token。
- sessionToken 与当前游戏进程绑定；游戏退出/进程崩溃即失效。
- 不把 token 写入持久文件。
- 重连/omp 重启需要继续本局时，用户点击弹窗的“重新生成 session prompt”，
  产生新的 bootstrap token 和 session；旧 session 可保留到游戏结束或显式撤销。
- 握手失败返回 401，不区分“token 错误/已使用”，避免探测。

注意：一次性握手降低重放风险，但不能阻止 token 在**本局运行期间**通过
模型上下文、provider 日志、终端历史或截图泄露。该风险在“仅控制游戏助手、
关闭游戏即失效”的边界内可接受；产品化可加 TLS/分权 token。

## 5. Session prompt

弹窗生成简短、可直接粘贴的 prompt：

```text
Mindustry AI session

Endpoint: http://192.168.1.23:47600
Bootstrap token: ***

Do this for this game session only:
1. POST /session with the bootstrap token and keep the returned session token.
2. GET /context?detail=summary to inspect the game.
3. Use POST /actions for writes; poll GET /actions/{opId} until done/failed.
4. GET /guide?topic=basics for game rules.
5. Do not use mock state. Do not ask questions. The token is valid only while
   this game is running.

If your host supports shell, use curl. If your host supports MCP, the optional
MCP endpoint is http://192.168.1.23:47600/mcp with the same token.
```

要点：

- prompt 不是 MCP 配置的替代品；它是“本局 API 会话语义”。
- token 只在本局有效，关闭游戏失效。
- 不要求 harness 修改全局配置或安装 skill。
- 不承诺所有 harness 都能自动配置 MCP；有 shell/HTTP 的 harness 用 REST 即可。

## 6. REST API

### 控制面（小 JSON）

```text
POST /session
GET  /context?detail=summary|full&radius=...&since=...
GET  /capabilities
GET  /content?type=units|blocks|items
GET  /guide?topic=basics
GET  /actions/{opId}
POST /actions
POST /cancel
```

动作：

```json
{
  "kind": "move_to",
  "x": 952,
  "y": 584,
  "arriveRadius": 12,
  "timeoutTicks": 600
}
```

返回：

```json
{ "opId": "op-1", "status": "running" }
```

小结果直接 JSON；不要返回全图。

### 数据面（大结果）

当前 session server 已挂载 `/data`；旧的 `127.0.0.1:46501/data` 仍保留给 MCP 开发路径。

```text
GET /data/map/latest
GET /data/map/{revision}
GET /data/map/{revision}/chunk/{x}/{y}
GET /data/manifest/latest
GET /data/events/latest
GET /data/events/{revision}/page/{cursor}
```

特点：

- 二进制/NDJSON，不包成 MCP JSON。
- 支持 `Content-Length`、`Content-Range`、`ETag`/revision。
- token 用 header，不放 URL。
- `POST /session` 返回 `sessionToken` 和独立的 `dataToken`（以及 `dataBaseUrl`）；`/data` 只接受 data token，控制面只接受 session token。
- 旧的 `dataToken` 仍可访问本地 `46501`；session server `/data` 使用同一个 data token，不做控制面越权。
- manifest 的 `access.baseUrl` 按请求 Host 返回，LAN 客户端拿到的是 `http://<host>:47600/data`。
- harness 可直接重定向到文件：

```bash
curl -fsS -H "Authorization: Bearer ***" \
  -o /tmp/map.mnd \
  "http://192.168.1.23:47600/data/map/latest"
```

大结果不要进模型上下文；由 shell/脚本读取后只返回摘要。

### 引用格式

`get_map_summary` / `get_events` 返回：

```json
{
  "ref": "obs://map/latest",
  "url": "/data/map/latest",
  "revision": 42,
  "bytes": 123456,
  "contentType": "application/octet-stream"
}
```

模型只需要知道 ref/url/bytes，不需要拿到内容。

## 7. 游戏说明（后续）

游戏说明不占常驻上下文，分三层：

1. **MCP instructions / session prompt 短说明**
   - 你是谁
   - 先读 context
   - 写动作异步，轮询
   - 不要使用 mock
2. **按需 guide**
   - `GET /guide?topic=basics`
   - 主题：basics/actions/economy/defense/campaign/safety
   - 后续可映射成 MCP resources `mindustry://guide/*`
3. **任务模板（可选）**
   - MCP prompts：`play-campaign`、`defend-core` 等
   - 不支持 prompts 的 harness 可以忽略

guide 是 mod 内置 Markdown，版本随 mod 走；不安装 skill。

## 8. 可选 MCP 兼容层

同一 mod 可以额外暴露：

```text
POST /mcp   MCP Streamable HTTP
```

已实现最小子集：

- `initialize`：返回 `protocolVersion=2024-11-05`、`serverInfo=mindustry-ai`、
  `Mcp-Session-Id`
- `notifications/initialized`：202，无 body
- `tools/list`：10 个核心工具
- `tools/call`：复用现有游戏动作队列，返回 MCP text content
- `resources/list` / `resources/read`：`mindustry://guide`
- `prompts/list` / `prompts/get`：`play-session`、`defend-core`、`mine-and-deposit`
- `ping`
- 错误使用 JSON-RPC 错误码；未知方法 `-32601`
- 鉴权：`Authorization: Bearer <sessionToken>`；session token 由 `POST /session` 获取
- 已用官方 `@modelcontextprotocol/sdk` 的 `StreamableHTTPClientTransport` 验证：
  connect、tools/list、tools/call、resources/list、resources/read、prompts/list、prompts/get 均通过
- 尚未实现：GET SSE、完整兼容性矩阵

用途：支持 MCP 且愿意配置一次的 harness。它不是主路径；session prompt + REST 仍是主路径。

注意：

- 许多 host 不支持热重载，首次配置后要重启。
- 本项目的推荐流程是 session prompt，不依赖 MCP 配置。
- MCP 和 REST 共享同一份工具 schema 与游戏动作队列，避免行为漂移。
- 第一版只暴露 10 个核心工具，不搬 27 个。

## 9. 弹窗设计

当前 MVP（已编译，未做客户端 UI 实测）：

- `WorldLoadEvent` 后、`reset()` 轮到新 bootstrap token 后显示 `BaseDialog`。
- 显示 endpoint、bootstrap token 和完整 session prompt。
- 按钮：`Copy session prompt`、`Close`。
- 复制使用 `Core.app.setClipboardText`，不写 settings、不持久化 token。
- 专用服务端没有 UI；本局 token 可通过 `PROBE_EXPOSE_SESSION=1` 写 discovery（0600），
  默认不写。

后续：

- 显示 loopback/LAN URL 列表，用户选一个复制。
- `Copy curl smoke command`、`Copy optional MCP config`。
- `Regenerate session prompt`：旧 bootstrap 失效，已建立的 session token 是否保留需明确。
- `Don't show again`，用 `Core.settings` 记录已读；不记录 token。
- 设置菜单保留 “AI MCP / Session API” 入口。
- 移动端使用可滚动/可复制的文本区域，避免长 prompt 被截断。

## 10. 生命周期

- `init()`：启动 socket、数据面、HTTP session server；端口冲突时目前只记录错误，不递增重试。
- world load：轮换 bootstrap token、清空 session token；客户端显示弹窗。
- world unload / game exit：当前进程退出后端口关闭、token 失效；显式关闭和删除 discovery 仍待补。
- 进程崩溃：端口关闭，token 自然失效；不保证清理文件，但默认文件不保存 session token。
- 重启：新 bootstrap token，不存在旧 token 复用。

## 11. 安全边界

- token 只授予游戏助手/观测，不授予宿主机 shell/文件。
- LAN 绑定必须配 token；无 token 直接 401。
- 不可信网络必须用 VPN/TLS；HTTP 明文 token 可被嗅探。
- session token 进模型上下文是已知风险；通过一次性 bootstrap、游戏退出失效、
  读写分权、短 TTL 降低影响。
- 游戏文本/地图数据是不可信输入；模型不能把游戏内文字当系统指令。
- harness 如果拥有 shell，token 泄露不是最高风险；shell 权限才是。
- 不把 token 放 URL、日志、错误响应或持久配置。

## 12. 实施阶段

### Phase 1：文档与协议

- 本设计文档
- REST schema/错误码
- session prompt 模板
- 安全边界评审

### Phase 2：mod 内 HTTP API

已完成（MVP）：

- `/session`：一次性 bootstrap token → session token
- `/context`：有界摘要，`detail=summary/full`
- `/actions`：`{kind,...}` 复用现有动作实现，返回 `opId`
- `/actions/{opId}`：动作状态轮询
- `/guide`：短游戏说明
- `/tools`：10 个核心工具的 JSON Schema（get_context/get_area/move_to/attack/mine/build_plan/withdraw/deposit/configure/get_action_result）
- LAN 绑定 `0.0.0.0:47600`，Bearer 鉴权
- 通用动作路由：REST 层不复制游戏逻辑，直接复用 `ProbeMod.handle`

待完成：

- 10 个核心工具的显式 schema/错误码表
- `/data/map` + Range、`/data/events` NDJSON 迁移进 mod
- session token 失效/刷新按钮
- 弹窗/UX

### Phase 3：弹窗/UX

部分完成：

- 客户端 `WorldLoadEvent` 后显示 `BaseDialog`
- `Copy session prompt` 按钮
- 专用服 discovery（仅 `PROBE_EXPOSE_SESSION=1`）
- 尚未做 UI 实测；LAN URL 选择、regenerate、don't show again、设置入口未做

### Phase 4：数据面

部分完成：

- session server 挂载 `/data/map/latest`、`/data/map/{revision}`、chunk、Range
- `/data/manifest/latest`，`access.baseUrl` 按请求 Host 生成
- `/data/events/latest` 和 `/data/events/{revision}/page/{cursor}` NDJSON
- data token 可读；旧 `46501` 数据面继续服务 MCP 路径
- session token 只用于控制，不用于 `/data`
- `scripts/session-api-smoke.mjs` 已用 HTTP 把地图写入 `/tmp/mindustry-session-map.bin`，
  并验证 Range 206
- 尚未做：data token TTL 刷新、Parquet、`curl` 进程级验收

### Phase 5：可选 MCP

部分完成：

- `POST /mcp` 的 `initialize`、`notifications/initialized`、`tools/list`、`tools/call`、`ping`
- 10 个核心工具与 REST 共用 `toolsJson()` schema
- `Mcp-Session-Id`
- `resources/list` / `resources/read`：`mindustry://guide`
- `prompts/list` / `prompts/get`：`play-session`、`defend-core`、`mine-and-deposit`
- 已用官方 `@modelcontextprotocol/sdk` 验证 connect/list/call/resources/prompts
- 尚未做：GET SSE、完整兼容性矩阵、bootstrap token 直接用来初始化

### Phase 6：Android

- `android: true` + d8
- 去掉 `com.sun.net.httpserver`
- 外部配置/discovery 路径
- 手机 LAN endpoint + PC harness

## 13. 验收标准

1. 全新环境只安装 Mindustry + 一个 mod + harness。
2. 弹窗复制 session prompt，粘贴到新 harness 会话即可读 context。
3. 不需要修改 harness 的 MCP 配置，不安装 skill。
4. `POST /session` 的 bootstrap token 只能用一次。
5. 关闭游戏后旧 endpoint 和 token 不可用。
6. `curl -o` 能把地图/事件写到文件，不进入模型上下文。
7. `get_context` 只返回有界摘要；大结果只返回 ref/url。
8. 可选 `/mcp` 配置一次后可用，但不是主路径。
9. 代码会话/普通 omp 会话看不到 Mindustry MCP 工具。

## 14. 非目标

- 不做常驻 agent daemon
- 不自动替用户修改 harness 全局配置
- 不承诺所有 harness 都能从一句 prompt 自动注册 MCP
- 不把游戏控制暴露到公网
- 不把地图/事件全量塞进上下文
- 不把长期目标/自动玩游戏做进 mod；目标由 harness 管理

## 15. 当前实现与实测（Phase 2 MVP + Phase 4 数据面）

代码位置：`probe-mod/src/ai/probe/ProbeMod.java`

已实现：

- `startSessionServer()`：`HttpServer` 绑定 `PROBE_SESSION_BIND`（默认 `0.0.0.0`）
  和 `PROBE_SESSION_PORT`（默认 `47600`）
- `POST /session`：校验一次性 `bootstrapToken`，返回 `sessionToken`；
  `bootstrapToken` 只能成功使用一次
- `GET /context?detail=summary|full&radius=...`：通过游戏线程队列执行
  `get_context`，HTTP 线程只等待结果
- `POST /actions`：接受 `{kind,...}` 或 `{op,...}`，入队到现有 `handle`，
  返回 `opId`；支持已有动作，不复制游戏逻辑
- `GET /actions/{opId}`：入队 `get_action_result`
- `GET /guide`：短游戏说明
- `GET /tools`：10 个核心工具 JSON Schema
- `POST /mcp`：最小 MCP Streamable HTTP 子集（initialize/tools/list/tools/call/ping）
- session server 的 `/data`：地图 raw/chunk/Range、manifest、事件 NDJSON
- 关闭游戏/进程退出后端口关闭，session token 与 bootstrap token 一起失效
- 进程内 discovery 增加 `sessionPort`/`sessionBind`；仅当
  `PROBE_EXPOSE_SESSION=1` 时写入 `sessionBootstrapToken`（开发/测试用）

实测：

```bash
# 启动 Fortress（脚本设置 PROBE_EXPOSE_SESSION=1）
scripts/start-game-server.sh

# 读取 discovery，走 /session -> /context -> /actions -> /actions/{opId} -> /data
node scripts/session-api-smoke.mjs

# 可选 MCP HTTP
node scripts/mcp-http-smoke.mjs
```

结果：

```text
session 200 true
reused bootstrap 401
tools 200 10
context 200 Fortress 928 584
action 200 op-1
result 200 done
data map 200 524304 MND1 sessionData 401 range 206 16 bytes 0-15/524304 manifest 200 ... events 200
guide 200 # Mindustry AI session
```

MCP 冒烟：

```text
session 200
initialize 200 mindustry-ai 2024-11-05
initialized notification 202
tools/list 200 10
tools/call get_context 200 Fortress 928 584
tools/call move_to 200 op-1 running
tools/call get_action_result done
unknown method 200 -32601
```

官方 SDK：

```text
sdk tools 10
sdk resources 1
sdk guide true
sdk prompts 3
sdk prompt text true
sdk context Fortress 928 584
sdk move op-1 running
```

说明：

- Node 冒烟脚本用 `fetch`，与 curl 的 HTTP 语义一致；curl 可用
  `curl -H "Authorization: Bearer ***" ...` 复现。
- `/session` 的一次性 token 已验证第二次返回 401。
- 完整地图已由脚本写入 `/tmp/mindustry-session-map.bin`，验证了“大结果落文件”路径。
- 当前没有把 session token 写进 discovery；只有开发开关会写 bootstrap token。
- 下一阶段：客户端 UI 实测、显式工具 schema、可选 `/mcp`、独立数据 token、Android。
