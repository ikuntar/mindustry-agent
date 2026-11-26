# 贡献指南

[English](CONTRIBUTING.md) | [简体中文](CONTRIBUTING.zh-CN.md)

这是一个实验性的 Mindustry mod 和 harness 项目。优先接受小而可验证的改动，而不是大范围重构。

## 提交 PR 前

1. 运行 `mcp-server` 测试：

   ```bash
   cd mcp-server
   npm ci
   npm test
   ```

2. 构建 mod：

   ```bash
   cd ..
   scripts/fetch-mindustry.sh
   probe-mod/build.sh
   ```

3. 涉及游戏玩法/API 的改动，运行相关真实游戏冒烟测试：

   ```bash
   scripts/start-game-server.sh
   node scripts/session-api-smoke.mjs
   scripts/stop-game-server.sh
   ```

   第一次 session 会消耗一次性 bootstrap；运行第二次 smoke 前请重启服务器。

4. 文档和 `/tools` schema 要跟随新动作同步更新。新增读写路径时，尽可能补回归测试。

## 范围约束

- 不要在 MCP server 中加入自主目标或长期规划器；目标循环由 harness 负责。
- 不要加入默认低血撤退、空闲自动索敌或自动开火。单位只能由显式动作移动/攻击。
- 调试/测试操作必须放在 `PROBE_ENABLE_DEBUG_OPS=1` 后面。
- 不要提交 token、服务器凭据、`.env` 文件、`refs/`、`artifacts/` 或构建出的 jar。

## 许可证

提交贡献即表示你同意按 GPL-3.0-only 授权你的贡献。见 `LICENSE`。
