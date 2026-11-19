# mindustry-ai

目标：做一个 Mindustry × AI 的版本。当前阶段：调研/参考实现拆解。

## 目录

```
mindustry-ai/
├── README.md
├── TASKS.md                          ← 实施清单（M0-M4）
├── docs/
│   ├── bek-mindustryx-ai-bridge.md   ← BEK-Group/MindustryX 的 AI 通道拆解（参考实现）
│   ├── ASSISTANT-DESIGN.md           ← 助手总体设计：身体/附身/权限/团队/验收
│   ├── MCP-PROTOCOL.md               ← MCP 工具、动作生命周期、事件、权限矩阵
│   ├── OPEN-QUESTIONS.md             ← 待拍板项与默认建议
│   └── REALITY-CHECK.md              ← v160.8 真实 jar 的 API/启动核对
├── mcp-server/                       ← MCP 工具接口（当前 MockGameAdapter）
├── probe-mod/                        ← 最小真实游戏探针（Java mod + socket + client）
└── refs/
    └── MindustryX-Ai/                ← 参考实现，浅克隆 main @89e3d71 (2026-05-23)
```

## 参考实现速览

`BEK-Group/MindustryX` = MindustryX（承接 Anuken/Mindustry 的 patch 层分支）+ 本地 AI 桥。

- 桥：`src/mindustryX/features/ai/`，7 个文件 ~1762 行，TCP 127.0.0.1:46491，TLV 帧
- 能力：6 个读操作 + 9 个写操作 + mmap 事件环 + 无渲染构建
- 对接：`DeterMination-Wind/Mindustry-MCP`（TypeScript MCP server，把桥包成 LLM 工具）
- 详情见 `docs/bek-mindustryx-ai-bridge.md`

## 状态

- [x] 拉取参考实现（不初始化 submodule 也能读 AI 代码；要编译才需要 `work/` `Arc/`）
- [x] 路线定为：局内 co-op 助手（mod + 本地执行层），不是独立 AI 客户端
- [x] 设计落档：`docs/ASSISTANT-DESIGN.md`、`docs/MCP-PROTOCOL.md`、`TASKS.md`
- [x] MCP 接口脚手架 + MockGameAdapter（`mcp-server/`）
- [x] MCP server 24 个工具、stdio 入口、Mock/MCP 测试、stdio harness（`npm test` 15/15）
- [x] Probe mod：真实 v160.8 服务端加载、get_context/move_to/build/get_tile 跑通
- [x] ProbeGameAdapter：MCP 24 工具中的 context/capabilities/query_area/move/build/withdraw/deposit/configure/command_units/set_stance/stop 接真实游戏
- [x] 真实动作验证：核心取放、sorter 配置、指挥 dagger、holdPosition stance
- [ ] 真实 Mindustry mod adapter（本地 socket + 游戏线程动作队列）
- [ ] attack/mine 端到端产出验证；possess/release/respawn；真实事件日志
- [ ] 助手本地反射控制器（寻路/索敌/建造/撤退）
- [ ] 固定地图端到端验收

## MCP 快速开始

```bash
cd mcp-server
npm install
npm run build
npm test        # MockGameAdapter + MCP 工具测试
npm run harness # stdio harness（构建后运行）
```

## 备注

- `refs/MindustryX-Ai/` 是本地参考克隆，已加入 `.gitignore`，不随本项目提交。
- 本机 git 全局配置把 github.com 重写到 gh-proxy.com 且挂了 127.0.0.1:7897 代理，
  直连可用。拉 GitHub 时用：
  `git -c http.proxy= -c https.proxy= -c url.https://github.com/.insteadOf= clone ...`
- GitHub PAT 曾以明文出现在会话中，跑完这轮应吊销重发。
