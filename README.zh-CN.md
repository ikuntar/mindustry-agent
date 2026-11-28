# mindustry-agent

[English](README.md) | [简体中文](README.zh-CN.md)

一个实验性的 [Mindustry](https://github.com/Anuken/Mindustry) 合作 AI 助手，以 mod、本地 session API 和 MCP 工具的形式提供。

助手是游戏里的普通身体：可以被附身、从核心重生、建造、采矿、战斗并执行明确指令。长期目标循环由 harness 负责；本项目不内置自主规划器。

> 状态：技术预览。API 和 mod 可以用于实验，但还不是完成的消费级 mod。暴露到网络前请先阅读[安全说明](#安全)。

当前公开版本：`0.4.4`（[GitHub Release](https://github.com/ikuntar/mindustry-agent/releases/tag/v0.4.4)）。

## 项目内容

- `probe-mod/` —— Mindustry Java mod，以及游戏内 session/数据 API
- `mcp-server/` —— MCP server 实现和用于协议测试的 mock adapter
- `mindustry_data/` —— 只读地图/事件数据面客户端
- `docs/` —— 游戏指南、API 契约、逻辑处理器指南、harness 接入和设计记录
- `scripts/` —— 本地构建、服务器、冒烟测试和发布辅助脚本

有两套相关但不同的工具面：

```text
session API:  mod 在 /tools 和 /mcp 暴露的 35 个工具
Node MCP:     独立的 mcp-server 包（mock/stdio 开发面），27 个工具
```

session API 是游戏内助手使用的产品路径。Node MCP 包适合协议测试和 host 接入。

## 环境要求

- Mindustry 160.x；构建和测试固定使用 v160.8。
- 构建 mod 需要 Java 17+。
- MCP server 和冒烟测试需要 Node.js 20+。
- Android 通用包还需要 Android SDK build-tools（`d8`）和 `android.jar`。
- 桌面客户端或专用服务器；专用服务器没有战役 UI，因此战役场景需要显式加载 fixture。

## 安装 mod

从 [GitHub Releases 页面](https://github.com/ikuntar/mindustry-agent/releases) 下载 `mindustry-agent-<version>.jar`，放入游戏 mods 目录：

```text
Linux:   ~/.local/share/Mindustry/mods/
Windows: %APPDATA%/Mindustry/mods/
macOS:   ~/Library/Application Support/Mindustry/mods/
```

Android 请使用游戏内导入器，不要直接复制到 `Android/data`：

```text
Mods -> Import Mod -> Import File -> 选择 jar/zip
```

通用 jar 同时包含 JVM classes 和 `classes.dex`；桌面和 Android 使用同一个压缩包中的不同部分。

如果你从旧的 `AI Probe` 名称升级，先删除旧 `ai-probe.jar` 再安装 `mindustry-agent.jar`。不要让两个 mod jar 同时加载：它们使用不同的 mod id，会各自生成助手。旧存档不会自动迁移。

这个 jar 有意保持为探针/助手 mod，不是独立客户端。启动 Mindustry、加载地图，然后使用 mod 显示的 session prompt 连接 harness。

## 从源码运行

先获取固定版本的上游服务器 jar，再构建：

```bash
scripts/fetch-mindustry.sh
probe-mod/build.sh
```

构建桌面 + Android 通用 jar：

```bash
probe-mod/build-universal.sh
```

启动带 probe 的本地专用服务器：

```bash
scripts/start-game-server.sh
node scripts/session-api-smoke.mjs   # 会消耗一个 bootstrap token
scripts/stop-game-server.sh
```

需要类似战役的地图 fixture 时使用：

```bash
scripts/start-ground-zero-server.sh
```

> 冒烟测试后请重启测试服务器。bootstrap token 是一次性的；不重启就建立第二个 session 会按设计返回 401。

## Session API

mod 会启动一个带认证的 HTTP 控制面：

```text
POST /session      一次性 bootstrap -> sessionToken
GET  /context      有界的游戏上下文
GET  /guide        游戏知识指南
GET  /tools        35 个工具 schema
POST /actions      {kind: ...} -> opId
GET  /actions/{id} 轮询动作状态
GET  /events/wait  有界长轮询
GET  /data/...     只读地图/事件数据面
```

默认只监听：

```text
127.0.0.1:47600
```

局域网访问需要显式开启：

```bash
PROBE_SESSION_BIND=0.0.0.0 scripts/start-game-server.sh
```

`/session` 的 bootstrap token 通过请求头传递：

```http
Authorization: Bearer <bootstrap>
```

session token 与 raw probe token、只读 data token 是分开的。不要把任何 token 放进公开 issue、截图或聊天消息。

端点细节见 [docs/SESSION-API.md](docs/SESSION-API.md)，返回字段见 [docs/API-DATA-CONTRACT.md](docs/API-DATA-CONTRACT.md)。

### 游戏内设置

直接打开 `Settings -> Mindustry Agent`；控件就在这一级分类里，不再套二级按钮：

- 修改 session 端口（1024–65535），并立即重启 HTTP server
- 使用 `0.0.0.0` 复选框开启局域网绑定
- 刷新一次性 bootstrap token
- 编辑、复制、重置 session prompt 文本

端口和 LAN 选项会保存在 Mindustry 设置中。进程启动时，`PROBE_SESSION_PORT` 和 `PROBE_SESSION_BIND` 仍可覆盖已保存的值。重新绑定端口不会改变已有 session token 或游戏状态；客户端必须连接新端点。修改 prompt 文本只影响复制出去的内容，不改变 API 行为。

## MCP

Node 包提供 MCP/stdio 开发面：

```bash
cd mcp-server
npm ci
npm run build
npm test
```

游戏/probe server 启动后，再启动 wrapper：

```bash
scripts/mindustry-mcp --check
MINDUSTRY_AI_ADAPTER=probe npm run host-smoke
```

默认 adapter 是 mock。设置 `MINDUSTRY_AI_ADAPTER=probe` 可通过 probe discovery 文件连接真实游戏。

Claude Code/Desktop、Codex、OpenCode、omp 和 Hermes 的配置示例见 [docs/HARNESS-INTEGRATION.md](docs/HARNESS-INTEGRATION.md)。

## 安全

本项目暴露的是游戏控制能力，而不只是遥测。

- session API 默认只绑定 loopback。暴露到局域网由你负责；请使用防火墙和可信网络。
- 调试/测试操作（`give`、`spawn_enemy`、`set_floor`、`kill_assistant` 及相关 helper）默认关闭。只有本地 fixture 才设置 `PROBE_ENABLE_DEBUG_OPS=1`。仓库中的 `scripts/start-*.sh` 测试 fixture 会显式开启；发布 jar 不会。
- 不要把 raw probe socket 或 session API 暴露到公网。
- 只在单人游戏或允许自动化的服务器上使用助手。它不是绕过服务器规则或反作弊的许可。
- 威胁模型和漏洞报告流程见 [SECURITY.zh-CN.md](SECURITY.zh-CN.md)。

## 开发

```bash
# Node 测试（mock adapter + MCP 协议）
cd mcp-server && npm ci && npm test

# Java 编译
scripts/fetch-mindustry.sh
probe-mod/build.sh

# 本地发布包 + 校验和（不上传）
scripts/release.sh
```

固定地图和真实游戏测试记录见 [docs/REALITY-CHECK.md](docs/REALITY-CHECK.md)。bootstrap 是一次性的；创建 session 的测试需要在两次测试之间重启服务器，或者重新加载世界取得新的 bootstrap。

## 文档

- [docs/GAME-GUIDE.md](docs/GAME-GUIDE.md) —— 给 AI harness 的游戏入门
- [docs/SESSION-API.md](docs/SESSION-API.md) —— mod HTTP/MCP 工具面
- [docs/API-DATA-CONTRACT.md](docs/API-DATA-CONTRACT.md) —— 字段级响应契约
- [docs/LOGIC-PROCESSOR-GUIDE.md](docs/LOGIC-PROCESSOR-GUIDE.md) —— 游戏内逻辑处理器用法和 API 名称映射
- [docs/MCP-PROTOCOL.md](docs/MCP-PROTOCOL.md) —— Node MCP 工具和动作生命周期
- [docs/HARNESS-INTEGRATION.md](docs/HARNESS-INTEGRATION.md) —— host 配置
- [docs/PLAYER-PARITY.md](docs/PLAYER-PARITY.md) —— 已实现玩家能力和剩余缺口
- [docs/REALITY-CHECK.md](docs/REALITY-CHECK.md) —— 真实游戏验证记录
- [docs/DOC-AUDIT.md](docs/DOC-AUDIT.md) —— 文档一致性审计与中文版本索引
- [docs/DATA-ACCESS-AUDIT.md](docs/DATA-ACCESS-AUDIT.md) —— 游戏数据访问审计
- [docs/RELEASING.zh-CN.md](docs/RELEASING.zh-CN.md) —— 构建、tag 和上传发布包
- [CHANGELOG.zh-CN.md](CHANGELOG.zh-CN.md) —— 版本变更
- [CONTRIBUTING.zh-CN.md](CONTRIBUTING.zh-CN.md) —— 贡献流程
- [SECURITY.zh-CN.md](SECURITY.zh-CN.md) —— 安全策略
- [mcp-server/README.zh-CN.md](mcp-server/README.zh-CN.md) —— Node MCP server

## 已知限制

- 项目仍是技术预览；1.0 前 API 可能变化。
- 专用服务器没有战役 UI；类似战役的 fixture 会显式加载 sector rules。
- 手机托管游戏 session 和完整 Android 真机验证尚未完成。
- 一些长时间/战役场景和跨区域物流不在当前范围内。
- Java mod 是一个较大的单文件源码，API 稳定前有意保持可审计的小规模。

## 许可证

GPL-3.0-only。见 [LICENSE](LICENSE) 和 [NOTICE](NOTICE)。

Mindustry 是 Anuken 和贡献者维护的独立 GPLv3 项目。本仓库不分发 Mindustry jar；`scripts/fetch-mindustry.sh` 会从官方 release 下载固定版本。
