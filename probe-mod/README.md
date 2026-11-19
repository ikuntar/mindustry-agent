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
- `build` 走 `BuildPlan` + `BuilderComp`，会真实扣资源并完成；客户端用
  `get_tile`/MCP `query_area` 读回。
- 本 probe 没有战斗、取物、配置、附身、重生；这些在真实 adapter 里做。
