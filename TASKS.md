# TASKS

状态：M0 完成 / M1 设计阶段
更新：2026-11-18

## M0：MCP 工具接口 + Mock Adapter

- [x] `mcp-server/` 工程骨架（package.json、tsconfig）
- [x] 共享类型：上下文、能力、内容、事件、动作结果、BuildPlan、Command
- [x] `MockGameAdapter`：模拟世界、动作队列、事件、建造/取物/配置/指挥/附身/释放/重生
- [x] `server.ts`：注册全部读/写 MCP 工具
- [x] `index.ts`：stdio 入口、SIGINT 清理
- [x] `test/mock.test.ts`：动作与状态机测试
- [x] `test/mcp.test.ts`：InMemoryTransport MCP 工具测试
- [x] `harness/smoke.ts`：stdio 连接、列工具、读上下文、最小动作序列
- [x] `docs/ASSISTANT-DESIGN.md`
- [x] `docs/MCP-PROTOCOL.md`
- [x] `docs/REMOTE-DATA-PLANE.md`（方案 A：远程只读数据面 + 客户端代码）
- [x] `README.md` 更新目录与运行方式
- [x] `mcp-server/README.md`

## M1：真实 Mindustry mod adapter

- [x] Probe mod：v160.8 服务端加载、`get_context`/`get_tile`/`get_capabilities`/`query_area`/`move_to`/`build` 验证
- [x] Probe mod 发现：`spawnedByCore=true` 的非 Player 会被每帧 despawn；助手用 `isHome`
- [x] Probe 建造完成：`BuildPlan` + `BuilderComp`，MCP `query_area` 读回 conveyor
- [x] `ProbeGameAdapter`：MCP 的 `get_context`/`get_capabilities`/`query_area`/`move_to`/`build`/`attack`/`mine`/`follow`/`withdraw`/`deposit`/`configure`/`command_units`/`set_stance`/`stop`/`possess`/`release`/`respawn`/`deconstruct`/`repair`/`cancel` 接真实游戏
- [x] 真实物流/配置/指挥验证：核心取放 5 copper、sorter 配置、dagger `move` 命令、`holdPosition` stance、`stop`
- [x] `query_area` 建筑读取改为按世界 tile 扫描；`Groups.build.getByID` 在服务端不可用
- [x] attack：支持 `unitId` / `buildingId` / `x,y` 三种目标；敌方 container 实测 `targetHealth 220→0`，position 目标实测 done/inRange=true；unit 目标的独立伤害验收仍受测试单位消失影响
- [x] mine：probe op + adapter 已接；在挖矿可达的 sand tile 上实测 `get_action_result` done，助手获得 sand 1
- [x] possess / release：同队 dagger 附身、原 home body despawn、release 后在核心生成新 alpha；`isHome/possessing` 读回正确
- [x] respawn：kill 后 `assistant.dead=true`，`respawn` 在核心生成新 alpha（id 变化、health 150）
- [x] Probe/真实 adapter 动作：deconstruct/repair/cancel/follow 均有入口和实测；follow 语义仍简化
- [x] 真实 adapter 事件日志：事件环已接，见 `get_events`
- [ ] 选定基线：官方 Mindustry v160.8 + mod；不用 BEK 作为主干（见 `docs/REALITY-CHECK.md`）
- [x] 游戏 mod 暴露本地 socket + 发现文件 + token + 版本握手：`/tmp/mindustry-ai-probe/bridge-info.json`，`hello` 返回 protocol/version，`PROBE_REQUIRE_AUTH=1` 时校验 token
- [x] 游戏线程动作队列 + 每帧预算：socket 只入队，游戏 `update` 每帧最多处理 50 条；LLM 调用不在游戏线程
- [ ] 重连、心跳、多客户端互斥、token 轮换
- [ ] `get_context` / `get_capabilities` / `get_content` / `query_area` 真实数据（get_content 仍静态）
- [x] `build_plan`：单块已验证；adapter 已支持多 placement/deconstruct 顺序提交，多块未单独验收
- [x] `deconstruct` / `repair`：probe 已实现；deconstruct 在 MCP 侧实测建筑消失，repair 在 probe 侧实测 25→45
- [x] `withdraw` / `deposit`：核心取放 5 copper 已验证
- [x] `configure`：sorter 配置已验证
- [x] `command_units` / `set_stance`：dagger move 与 holdPosition 已验证
- [x] `possess` / `release` / `respawn`：基本状态机已验证
- [x] `follow`：入口与移动跟随已验证；目标死亡时 op 会结束，持续跟随/复杂避障仍未定义
- [x] `cancel`：全量取消已实测；按 opId 定向取消已实现但未单独回放
- [x] `get_events`：probe 事件环（unit_destroy / unit_create / block_destroy / block_build_end / build_damage / unit_damage），`since/limit/next/dropped` 已接；MCP 实测返回真实事件
- [ ] 事件类型过滤、事件合并、核心事件细分和 dropped 压测
- [ ] 远程数据面：`DatasetRef`/manifest、只读 HTTP GET/HEAD + Range、revision 保留
- [ ] 客户端 SDK：`open_dataset(ref)`、本地 token 解析、npz/Parquet 读取、输出预算
- [ ] `get_map_summary` / `get_events` 摘要 + ref；客户端代码读取完整数据
- [ ] 无代码 host 的 `get_area` / `get_events` 有界查询 fallback
- [ ] 数据面鉴权/TTL/路径白名单/速率限制与验收
- [x] `get_context.eventsSince` 返回真实事件序号
- [ ] `AssistantController`：本地反射层（寻路/索敌/开火/建造推进/撤退）
- [ ] 助手身体从核心生成；`spawnedByCore=false` + `isHome` 跟踪（v160.8 非 Player 会 despawn）
- [ ] 死亡/重生：`Player.deathDelay`、任意核心、无核心、核心被拆
- [ ] 借体解控：`resetController()`，不消失；命令恢复
- [ ] 人口绕过只限重生/默认身体
- [ ] 团队规则：全程 `assistant.team`；`team.rules()` / `state.rules`
- [ ] 附身目标校验：同队、`isAI`、`playerControllable`、非玩家身体、非助手身体
- [ ] `possessionAllowed` 遵守（待拍板，默认遵守）
- [ ] 助手身体不可附身：非 `AIController` 控制器 + 显式拒绝
- [ ] 动作日志 / 失败原因 / 停机开关

## M2：观测与上下文

- [ ] `get_context` 摘要 + 局部窗口 + 事件增量
- [ ] token 预算、detail/radius/since、分页/resource
- [ ] 可配置方块 schema（sorter/unloader/processor/message/switch/turret 等）
- [ ] 可指挥单位 + stance + 命令队列
- [ ] 玩家上下文：当前选择/镜头/当前工具（如果后续做对话/指令）
- [ ] 事件合并与 dropped 检测

## M3：Harness / LLM 测试

- [ ] 固定地图场景：铺带、供弹、防守 N 波、附身/解控/换核心重生
- [ ] harness：MCP stdio 客户端，跑固定动作序列并断言
- [ ] LLM harness：接真实模型，记录工具调用、token、延迟
- [ ] 指标：任务成功率、动作失败率、响应延迟、token/分钟、误伤玩家资产、助手死亡
- [ ] 失败注入：越界、资源不足、错队、不可附身、无核心、LLM 超时

## M4：运行时/安全/多人

- [ ] 本地 socket 鉴权、localhost only、token
- [ ] 动作 allowlist、rate limit、prompt injection 防护
- [ ] API key 只在伴生进程；日志脱敏
- [ ] 存档/读档记忆处理
- [ ] 跨区块/跨地图重生
- [ ] 本地主机/专用服/其他玩家可见性
- [ ] 重连、版本握手、动作幂等

## 未决项

见 `docs/OPEN-QUESTIONS.md`。未落 TASKS 的设计项视为未收尾。
