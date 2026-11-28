# 变更记录

[English](CHANGELOG.md) | [简体中文](CHANGELOG.zh-CN.md)

## 0.4.4

- `get_tile.building` / `query_area detail:full` 补齐建筑运行时字段：位置、尺寸、
  血量、旋转、阵营、range、flag、库存逐项列表。
- `/content` 补齐核心数据库参数：单元工厂 `plans`、`Reconstructor` 升级对、
  `UnitAssembler` 计划、核心 `unitType`、墙体 `armor`。
- 钻头增加 `liquidBoostIntensity` 别名；`mechanical-drill` / `laser-drill` 当前为 `1.6`。

## 0.4.3

- `build` 对已存在的同种方块幂等，返回 `alreadyPresent`；多格动作目标接受任意覆盖格。
- 支持顶层 `withdraw`/`deposit` 目标，并拆分 `target_not_found`、`item_not_found`、
  `hand_busy`、`hand_full`、`item_not_carried`、`receiver_rejects`、`out_of_range`。
- 增加 `liquidItems`、`powerNetId`、`drillable`、钻机覆盖/液体加成、炮塔射程、
  单位 armor、武器 damage 和传送带带速。
- 支持 `bridge-conveyor.length`；增加 `ore_too_hard`；未阻塞科技不再返回
  `blockedReason`；修正 guide 的维修/撤退和事件分页说明。

## 0.4.2

- `Settings -> Mindustry Agent` 一级设置页直接显示端口、LAN 和 session prompt，
  去掉多余的“Open settings”二级按钮/弹窗。
- 设置页和 session 弹窗按 `Core.graphics`、`growX` 和可滚动宽度自适应，避免窄屏/手机横向溢出。

## 0.4.1

- 修复 `repair`：Alpha/Beta/Gamma builder body 不再直接给建筑回血；动作现在要求
  `UnitType.canHeal`，普通 Serpulo builder 返回 `cannot_repair`；
  `get_capabilities` 增加 `canHeal`。

## 0.4.0

- **破坏性变更：** 所有公开坐标和半径统一为 tile 单位；`move_to`、`get_area`、
  `query_area`、攻击坐标、实体位置、出生点和规则半径不再返回世界像素，连续位置允许小数 tile。
- `deconstruct` 接受游戏允许拆除的静态道具；`get_tile` 增加 `blockType`、
  `blockBreakable`、`destructible`、`alwaysReplace`。
- `build_plan` 为传送带增加输出受阻/对空气/反向的 `warnings[]`。
- `gameOver` 时保留最后一帧 wave/resources/cores 的 `lastSnapshot`。

## 0.3.1

- 把 `get_area` 加入暂停时的只读 op 白名单。
- sorter 的 `configure` 接受物品名字字符串；未知内容引用返回 `not_found`；
  文档补充 config 写入形状。
- `/content` 的 blocks/units 增加 `id`，按 id 去重 units；未知 type 返回 400；
  增加 `counts`/`returned`/`truncated`。
- `/data` manifest 增加 `schema.blocks`，离线可还原 `block_id`。
- `/guide` 和 `/tools` 支持 HEAD/ETag/304；控制面不再错误声明 `Accept-Ranges`。
- guide 版本号升级并暴露 `guideTopics`；未知 `/guide` topic 返回 400。
- 明确 `build_plan` 初始 `data.results[]` 与最后一个子 `opId` 的区别；增加 guide
  目录和文档一致性 CI 检查。
- 失败的 build 增加 `error.placeReason`；`mine` 支持 `untilAmount`/`untilFull`/`until`。
- 核心被摧毁后的写动作返回 `game_over`，`/context` 暴露 `sessionEnded`。
- 增加 `query_area.radiusTiles`、`get_tile.breakable/replaceable/outputTile`，
  以及紧凑敌人字段 `enemyCount`/`nearestThreat`/`nearestThreatDistance`。

## 0.3.0

- 项目名、mod id、显示名、discovery 目录和发布产物从 `mindustry-ai`/`ai-probe`
  改为 `mindustry-agent`/`Mindustry Agent`。
- 使用旧 mod id 的存档不迁移；这是一次有意的 pre-1.0 破坏性改名。
- 增加游戏内设置面板：session 端口/LAN 绑定、bootstrap token 刷新、可编辑/可复制的
  session prompt。
- 精简生成的 session prompt：只声明 API 是什么和最小握手/使用步骤，详细规则保留在
  `/guide`。
- session 端口/bind 解析完成后重写 discovery；此前第一次写入会在世界加载前使用默认端口。
- world load 时无条件轮换 bootstrap：地图重载后旧 bootstrap 一定失效，存活的
  sessionToken 继续有效。
- 在 rules/spawn 数据中暴露 `dropZoneRadius`、`enemyCoreBuildRadius` 和
  `polygonCoreProtection`；`get_tile` 预检增加 `enemy_core_build_radius`。
- 在初始和 MCP task prompt 中加入显式动作策略，避免 harness 推断默认移动、索敌或自动开火。
- 暂时保留 Java 包 `ai.probe` 和仓库目录 `probe-mod`；它们不是面向用户的 mod 身份。

## 0.2.0

- 增加 `get_spawns` 读取固定波次出生点（`WaveSpawner.getSpawns()`），包含 tile/像素坐标、
  可见性、wave team、drop-zone radius 和迷雾过滤。
- 增加共享的 `entity`/`unit`/`building` 传感器对象，底层使用
  `Senseable.sense(LAccess)`；`query_area detail:"full"` 返回相同字段。
- 增加 `context.logic` 别名和 `get_context.time/second/minute/waveSeconds/server/client/contentCounts`。
- 增加 `LOGIC-PROCESSOR-GUIDE.md`，并打包进 mod jar 的 `/docs/LOGIC-PROCESSOR-GUIDE.md`。
- 默认 session bind 改为 loopback（`127.0.0.1`）；局域网访问需要设置
  `PROBE_SESSION_BIND=0.0.0.0`。
- 默认关闭测试/调试操作，只有 `PROBE_ENABLE_DEBUG_OPS=1` 才开启；fixture 脚本显式 opt-in。
- 增加游戏内设置面板：session 端口/LAN 绑定、bootstrap token 刷新、可编辑/可复制
  session prompt。
- 增加 GPL-3.0、安全策略、CI、可复现的 Mindustry 下载和本地发布/校验脚本。
