# BEK-Group/MindustryX 拆解：它到底做了什么

仓库：https://github.com/BEK-Group/MindustryX
本地：`refs/MindustryX-Ai/`（浅克隆 depth=1，单分支 main）
快照：main @ 89e3d71 "feat: add MCP desktop bridge client builds"，最后 push 2026-05-23
血缘：`Anuken/Mindustry` → `TinyLake/MindustryX`（362★，patch 层维护）→ `BEK-Group/MindustryX`

一句话：它不是"重写一个 Mindustry"，而是在 MindustryX 之上加了一条**本地 AI 控制通道**，
让外部进程（Claude 这类 LLM，通过 MCP）能读游戏状态、执行动作、收事件。

---

## 1. 仓库结构

| 路径 | 内容 |
|---|---|
| `work/` | submodule → Anuken/Mindustry（上游展开源码，实际开发位置） |
| `Arc/` | submodule → Anuken/Arc（图形/工具库上游） |
| `patches/` | 84 个 git patch（其中 client 75 个），自身改动以 patch 形式叠在上游上 |
| `src/mindustryX/` | 自有 Java/Kotlin 源码，~1.49 万行 |
| `assets/` | 自己的 bundle/图标/协议包表（packets_v146/v153） |
| `scripts/applyPatches.sh` `scripts/genPatches.sh` | patch 展开 / 回收 |

为什么用 patch 而不是直接改 `work/`：上游更新时 `git submodule update` + 重放 patch，
冲突局限在 patch 文件里。MindustryX 就是这么跟到 v154/v8 的，BEK 沿用了这套。

`src/mindustryX/features/` 里除了 `ai/`，还有一大批客户端特性：
`ReplayController`（录像）、`TimeControl`（变速）、`ArcRadar`（雷达图）、`PicToMindustry`（图片转处理器码）、
`MetricCollector`（指标）、`AutoUpdate`、`UIExt` 等 —— 说明这个分支的底子是"魔改客户端"，AI 是其上长出来的一层。

## 2. AI 通道本体（`src/mindustryX/features/ai/`，7 文件 1762 行）

```
AIBridge.java          342  总控：初始化、每帧泵、请求分发、分页、bridge-info.json
AIProtocolServer.java  372  TCP server + 帧编解码（TLV）
StateReader.java       311  读操作 → JSON
ActionExecutor.java    327  写操作 → 直接调游戏内部 API
EventBridge.java        80  游戏事件 → 推送
SharedEventRing.java   146  mmap 文件环形缓冲（跨进程事件）
AIBridgeSupport.java   184  常量、错误码、缓存、Ids
```

### 2.1 传输层
- 绑定 `127.0.0.1:46491`（`defaultControlPort`），只监听本地回环，**无鉴权**。
- 帧格式：4 字节大端长度 + TLV 体；tag 1..13（kind/requestId/op/payload/accepted/opId/
  cursor/errorCode/errorName/message/eventType/eventSeq/dropped），字符串 UTF-8。
- 单帧上限 8 MB，单次 payload 上限 1 MB（超出自动分页）。
- 发现机制：`{java.io.tmpdir}/mindustryx-ai-bridge/bridge-info.json`，运行中每 1s 重写一次。
  客户端只需读这个文件，不用配端口 —— Mindustry-MCP 就是这么自动连的。

### 2.2 线程模型（这一段是精华）
- 网络线程只做解析和入队，**真正执行全部回到游戏主线程**。
- `AIBridge.update()` 每帧跑一次，预算 **1 ms**（`tickBudgetNanos`），超预算立即返回；
  写队列优先，每轮最多再服务一个读。
- 写操作是异步的：立刻回 `accepted + opId`，之后用 `await`（默认 5s、上限 30s，5ms 轮询）取结果；
  结果缓存 TTL 20s、最多 32768 条（`op_expired` 之后要重发）。
- 队列满返回 `queue_full`，不会阻塞游戏。

这套设计说明作者的第一优先级是"不能让 AI 拖低 TPS"，而不是吞吐。

### 2.3 读操作（`StateReader`）
`get_state`、`list_maps`、`get_tiles`、`get_buildings`、`get_units`、`get_content`
- 同一 tick 内相同请求有 `SameTickCache` 去重。
- 大结果按字符数切页，返回 `cursor`，客户端用 `cursor_next` 翻页；cursor TTL 60s，最多缓存 2048 个。
- `get_state` 给的是：tick、时间、headless、paused、menu、gameOver、wave、enemies、地图、队伍等。

### 2.4 写操作（`ActionExecutor`）
`load_map`、`join_game`、`leave_game`、`place_block`、`break_block`、`write_logic`、
`spawn_unit`、`set_speed`、`pause`
- 直接调 `Vars.world` / `Vars.state` / `LogicBlock` 这些内部 API，不走网络包，所以**只有本机客户端能这么干**。
- 粒度是"单方块 / 单个处理器代码 / 单次出生"，没有"建造队列""寻路""编队"这种高层动作。

### 2.5 事件通道（`EventBridge` + `SharedEventRing`）
- `tile_changed`、`health_changed`、`send_packet`（含 cancelled）等游戏事件，双通道发出：
  1. socket 广播（低延迟但占主线程）；
  2. **mmap 文件环形缓冲**：magic `AIBR`、64B 头、24B 槽头、最少 64 槽 × 256B、大端、带 `writeSeq`/`dropped` 计数。
     外部进程直接轮询这个文件，绕开 socket 和主线程 —— 高频事件走这条路。
- 共享内存不可用时 `degradeSharedMemory()`，只剩 socket，功能不挂。

### 2.6 渲染开关（`patches/client/0075-F-MCP-desktop-render-modes.patch`）
- 新增 `Vars.disableRender`，`-Dmindustry.disableRender=true` 时：跳过世界/UI 渲染、跳过 `loader.draw()`、跳过 `Gl.flush()`，
  **游戏逻辑和 tick 照跑**。
- `desktop/build.gradle` 因此能产出两个 jar：带渲染 / 无渲染。无渲染版给服务器式跑 AI，省 GPU。
- 配套 `NoRenderLauncher.java`。

## 3. 配套 MCP server

`DeterMination-Wind/Mindustry-MCP`（TypeScript，3★，2026-07 更新）
- 读 `bridge-info.json` 自动连桥；默认拉起 `artifacts/MindustryX-MCP-{render,no-render}.jar`。
- 把上面的 op 包成 MCP 工具：`launch_client`/`close_client`、六个读、九个写、`await_op`。
- 用法就是 Claude Desktop/任意 MCP 客户端里配一条 `"command": "node", "args": [".../dist/index.js"]`，
  然后 `launch_client` → `get_state` → `load_map` → 开始玩。
- 也就是说：**BEK 的仓库负责"手和眼"，MCP 仓库负责"翻译成 LLM 能调用的工具"，决策完全在模型那边。**

## 4. 想在此基础上做"AI 版"时，它已经给了什么、还缺什么

已经有的（可以直接复用，省掉大量脏活）：
1. 进程内直调游戏 API 的动作通道，不用改网络协议、不用打服务器补丁。
2. 不卡主线程的调度骨架（1ms 预算 + 读写分队列 + 异步 opId）。
3. 高频事件用 mmap 环避开主线程，且做了降级。
4. 无渲染 headless 客户端，AI 批量跑不烧 GPU。
5. 发现机制（bridge-info.json）和 MCP 封装，接 LLM 只差 prompt。

缺的（也就是可以做出差异化的地方）：
1. **没有 RL 语义**：没有 `reset/step/reward`，`load_map` 后要自己判定成败；
   想训练得自己包一层 gym 式接口。
2. **观测太"原始"**：`get_tiles` 是全量 JSON 分页，大图一页页拉，延迟高、token 贵；
   没有局部视野、没有张量/栅格化观测、没有相对坐标归一化。
3. **动作太低层**：只有单方块级原语。要"造一条传送带线""补防御缺口"得在外部拼几十次调用，
   每次都要过 1ms 预算和队列。
4. **单机、无鉴权**：只绑 127.0.0.1，多人/远程要自己做鉴权隧道；也没有多智能体隔离。
5. **无并发保证**：多客户端连同一个桥没有 per-client 配额，谁抢到队列谁执行。

## 5. 构建（要真跑起来时）

```bash
git clone --recursive https://github.com/BEK-Group/MindustryX.git
cd MindustryX && git submodule update --init --depth=10
bash scripts/applyPatches.sh       # 把 patches/ 展开到 work/ 和 Arc/
./gradlew desktop:dist             # JDK 17
# 改完 work/ 或 Arc/ 后：
bash scripts/genPatches.sh         # 回收成 patch，提交 patch 而不是 work/
```

产出三种形态（MindustryX 传统）：apk（安卓）、`desktop.jar`（桌面）、`loader.jar`（当 mod 注入原版）。
BEK 额外出 render / no-render 两个 jar。
