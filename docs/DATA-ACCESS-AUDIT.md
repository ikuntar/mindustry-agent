# 游戏数据访问审计

状态：2026-11-24。审计基线 `b431a3b`，加上本轮 `TimerObjective`/电力过滤修复。
范围：`probe-mod/src/ai/probe/`、session/MCP 数据面、discovery 文件。

## 1. 结论摘要

- **没有**发现内存扫描、屏幕截图/OCR、注入进程、读取游戏存档、外部遥测或出站 HTTP。
- 主要状态读取走 Mindustry mod 公开面：`Vars.state/world/content`、`Groups.unit/build/player`、
  `Tile/Building/Unit`、`Events`、`PowerGraph`、`Rules`。
- **已移除一处非标准游戏状态读取**：`MapObjectives.TimerObjective.countup` 原先是 protected
  字段，通过 `getDeclaredField` + `setAccessible` 读取；现在不再反射，返回
  `current=-1`、`display` 和 `progressAvailable=false`。
- 仍保留一处**构造期**反射：克隆助手 `UnitType` 时遍历 `UnitType.class.getFields()` 的
  public 字段，用于注册 `ai-alpha/beta/gamma`；它不读取运行时对局状态，也不进入 LLM 输出。
- 仍有宿主元数据读取：Android/桌面 PID（`Class.forName`）和本机网卡地址（`NetworkInterface`）。
  这些不是游戏数据，但属于主机环境信息。
- 最大的规则风险不是“反射”，而是**服务端全图可见性**：读接口和事件可以拿到玩家当前不可见的
  敌方单位、方块、地图和伤害事件。它们是公开 mod API，但不是玩家等价视野；需要产品决策。

## 2. 标准 mod API 使用

| 数据 | 来源 | 用途 |
|---|---|---|
| 当前 tick/波次/暂停/胜负/规则 | `Vars.state` | context、事件、暂停门控 |
| 地图 tile/block/floor/drop/team | `Vars.world.tile()` / `Tile` | get_tile/get_area/寻路/地图快照 |
| 单位/建筑/玩家 | `Groups.unit`、`Groups.build`、`Groups.player` | context、query_area、目标查找 |
| 队伍资源/核心 | `team.items()`、`team.cores()`、`team.data()` | context/动作校验 |
| 内容与科技 | `Vars.content`、`TechTree` | get_content/get_tech_tree |
| 电力网络 | `Building.power.graph` / `PowerGraph` | context.power |
| 事件 | `Events.on(EventType...)` | 事件环、事件等待 |
| 配置 | `Building.config()` | get_tile 配置回读 |

这些 API 是 mod 可直接访问的公开接口；调用本身不等价于“玩家能看见”。所有动作仍以
`assistant.team/unit` 为 actor，没有用 `Vars.player` 冒充玩家身份；`Vars.player` 只在判断
“这个身体是否正被玩家控制”时作为保护条件出现。

## 3. 发现与处置

### F1 已修复：protected 计时器字段反射

原实现读取 `TimerObjective.countup`（`MapObjectives.java` 中为 `protected`）：

```text
ProbeMod.java:3492  reflectedFloat(timer, "countup")
ProbeMod.java:3530  getDeclaredField + setAccessible
```

这是唯一一处**运行时读取非公开游戏字段**的行为。现在已改为公开的
`timer.text()`，并明确返回 `current=-1`、`display`、`progressAvailable=false`；
不伪造秒数。没有新增工具。

### F2 保留：助手 UnitType 克隆反射

`ProbeMod.java:190` 遍历 `UnitType.class.getFields()`（public 字段），复制到新的
`ai-*` 类型。用途是注册助手身体，不是采集对局数据；它不读取 private/protected 字段，
不把字段内容发给 LLM。若要求“完全无反射”，可改为显式字段复制，但会扩大维护面。

### F3 保留：宿主 PID 反射

`ProbeMod.java:5539` 在 Android 用 `Class.forName("android.os.Process")`，桌面用
`ManagementFactory` 取 PID（`ProbeMod.java:5547`），写入 discovery。它是进程标识，不涉及游戏状态；
如果只看“游戏数据”，不构成采集通道。

### F4 已加迷雾限制：服务端全图读取

这些接口使用公开 mod API；在 `rules.fog=false` 时仍可读全图（这是游戏规则允许的状态），
在 `rules.fog=true` 时已按助手队伍限制：

- `get_tile`/`get_area`：未发现 tile 返回 `discovered:false, hidden:true`；已发现但当前不可见
  只返回地形/矿，block 标记为 `hidden`、team=-1，不返回库存/config。
- `query_area`、`get_context.threats`、`get_unit`、`findUnit`/`findBuilding` 过滤当前不可见实体。
- `get_map_manifest`/`/data/map/**` 在迷雾下只写已发现地形；未发现/不可见格 block/team/solid 为 0，
  manifest 带 `fog`/`visibility`。
- 事件监听器按 `unitVisible`/`buildingVisible`/`tileVisible` 在入队时过滤。
- `context.power` 只汇总 `assistant.team`。

实测（Fortress + 控制台开启 `fog/staticFog`）：远处 `get_tile` 返回 hidden；`get_area` 全隐藏；
`query_area` 0 单位；`spawn_enemy` 后 `get_unit` 返回 `unit_not_found`；`threats` 0。
**判定**：迷雾内已是玩家等价读取；无迷雾模式仍保留全图感知（这是模式规则，不是绕过）。


### F5 保留：本地 raw debug 面

`startSocket()` 绑定 `127.0.0.1`（`ProbeMod.java:5498`）。存在测试辅助 op：
`give`、`spawn_enemy`、`spawn_ally`、`set_floor`、`kill_assistant`、`set_paused`、
`set_possession_allowed` 等。它们**不在** session `/actions` 白名单和 MCP `/tools` 中；
默认由 `PROBE_ENABLE_DEBUG_OPS` 关闭，只有显式设为 `1` 才启用。本机进程只要连上
127.0.0.1 并满足 token 配置，仍可调用；不要把测试构建当正式服务暴露。

### F7 已修复：session prompt 的损坏占位符

审计还抓到 `sessionPrompt()` 里残留了 `Bearer ***` 形式的占位符（历史补丁被脱敏后写回）。
这不属于数据采集，但会让新 harness 无法按提示完成握手；已改回普通文字说明。headless 模式
没有 UI 可直接回放该 prompt，已做源码检查。

### F6 未发现：外发遥测/出站请求

全源码搜索没有 `HttpClient`、`HttpURLConnection`、`openConnection`、`okhttp` 或
外部 URL；只有 `ServerSocket` 监听。`NetworkInterface` 仅枚举本机 IPv4 地址用于
显示 LAN URL，不发送数据。`/data` 只读、需要 data token、限流；session 需要 session token；
`/guide`/`/tools` 可用 bootstrap 只读。

## 4. 权限与数据面

- 控制面 session 默认只绑定 `127.0.0.1`；`PROBE_EXPOSE_SESSION=1` 只控制 discovery 写入/提示，
  **不**改变 bind。需要局域网访问时显式设置 `PROBE_SESSION_BIND=0.0.0.0`，并自行承担网络暴露风险。所有数据/动作端点
  要 `sessionToken`，`/data` 要独立 `dataToken`（默认 1h，可轮换）。
- 数据面同时监听 `127.0.0.1:DATA_PORT`；session server 也挂 `/data`，因此开启 LAN 时
  地图/事件会暴露给持有 data token 的局域网客户端。
- discovery 文件桌面写 `/tmp/mindustry-agent-probe/bridge-info.json` 并尝试设为仅当前用户
  可读写；Android 写 `Vars.dataDirectory`。文件包含 bootstrap/data token，不应被其他用户读取。
- 没有把游戏数据写进仓库或发往第三方；大体积地图/事件走本地 HTTP，不塞进模型上下文。

## 5. 验收

```text
./probe-mod/build.sh                         OK
node scripts/session-api-smoke.mjs            PASS
```

本轮修复没有新增工具，工具面仍为 35 个。

## 6. 待办/待拍板

- [ ] 决定 F4 的可见性语义：玩家等价（队伍/视野过滤）还是显式全图感知。
- [ ] 若要彻底无反射，替换 `UnitType` 构造期 `getFields()` 为显式复制。
- [x] 正式构建默认关闭 raw debug op；只有 `PROBE_ENABLE_DEBUG_OPS=1` 才启用。
- [ ] issue #34：`/guide` fallback 可观测性、`get_area` cursor 分页仍未完成。
