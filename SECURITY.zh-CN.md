# 安全策略

[English](SECURITY.md) | [简体中文](SECURITY.zh-CN.md)

`mindustry-agent` 暴露本地游戏控制 API。请把 session token 和 raw probe token 当作控制正在运行游戏的凭据。

## 支持的版本

安全修复只应用到最新的 `0.3.x` mod 版本。旧 jar 和未发布快照不受支持。

## 报告安全漏洞

不要在公开 issue 中写入 token、密码、私有服务器地址，或尚未公开的漏洞细节。请使用仓库的 GitHub 私密安全公告，或通过仓库主页联系维护者。请包含：

- 受影响版本（`/session` 和 `/context` 返回 `version`）
- 平台（桌面/专用服务器/Android；Mindustry 160.x）
- 已移除密钥的复现步骤
- probe/session 端口是仅 loopback，还是暴露到了局域网

## 威胁模型

- session API 可以读取游戏状态、移动/附身单位、修改建筑，不是只读遥测接口。
- raw probe socket 是内部/测试传输。设置 `PROBE_ENABLE_DEBUG_OPS=1` 后它可以访问调试操作；不要暴露它。
- session server 默认绑定 `127.0.0.1`。设置 `PROBE_SESSION_BIND=0.0.0.0` 会把接口暴露到网络，这是显式 opt-in，需要你自己的防火墙和信任边界。
- token 按游戏进程生成。不要把它们粘贴到 issue、日志、截图或公开聊天中。
- 本 mod 没有绕过服务器规则、反作弊或其他玩家同意的许可。只应在单人游戏或允许自动化的服务器上使用。

## 调试操作

`give`、`spawn_enemy`、`set_floor`、`kill_assistant`、`set_paused` 及相关 fixture helper 默认关闭，只有设置 `PROBE_ENABLE_DEBUG_OPS=1` 才启用。测试 fixture 脚本会显式打开它。不要对可被不可信客户端访问的服务器使用这个开关。
