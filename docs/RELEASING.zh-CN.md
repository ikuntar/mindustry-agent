# 发布流程

[English](RELEASING.md) | [简体中文](RELEASING.zh-CN.md)

mod 通过通用 jar 和 GitHub 源码发布。发布产物不提交到 git 仓库。

## 前置条件

```bash
scripts/fetch-mindustry.sh
# Android 通用构建还需要 d8/android.jar；见 probe-mod/build-universal.sh
```

## 构建和校验和

```bash
scripts/release.sh
```

该脚本构建 `probe-mod/build/mindustry-agent.jar`，复制为
`release/mindustry-agent-<version>.jar`，并写入 `release/SHA256SUMS`。

## GitHub 发布

### 第一次发布：创建仓库

在项目根目录运行：

```bash
scripts/publish-github.sh mindustry-agent
```

脚本会要求一个具有仓库创建权限的 GitHub PAT，创建
`<your-login>/mindustry-agent`（空仓库，不创建 README），添加 `github` remote，
并推送当前分支。PAT 从 `GITHUB_PAT` 或
`~/.config/mindustry-agent/github_pat` 读取（可用 `GITHUB_PAT_FILE` 覆盖），
如果都不存在则隐藏输入。PAT 不会写入 `.git/config` 或 `.git-credentials`；
原来的 Gitea `origin` 不会被修改。

推送使用隔离的 git 配置，因此失效的全局 `gh-proxy.com` rewrite 或本地代理设置
不会阻塞上传。

如果要把 PAT 放在仓库外：

```bash
mkdir -p ~/.config/mindustry-agent
chmod 700 ~/.config/mindustry-agent
read -r -s -p 'GitHub PAT: ' GITHUB_PAT
printf '%s' "$GITHUB_PAT" > ~/.config/mindustry-agent/github_pat
unset GITHUB_PAT
chmod 600 ~/.config/mindustry-agent/github_pat
```

不要把 PAT 放进公开仓库里的“被忽略文件夹”；未跟踪文件仍可能被备份、打包或后续
`git add -f` 带走。优先使用 `~/.config/mindustry-agent/`。

创建私有仓库：

```bash
scripts/publish-github.sh mindustry-agent --private
```

脚本需要 classic PAT 的 `repo`，或 fine-grained PAT 的
Contents read/write + Metadata read。首次创建仓库还需要创建仓库的权限；已有仓库
只需要 Contents write 就能推送。脚本不创建 Release，也不上传 jar。

1. 同时更新 `probe-mod/mod.json` 和 `ProbeMod.VERSION`。
2. 更新 `CHANGELOG.md` 和 `CHANGELOG.zh-CN.md`。
3. Commit 并 push。
4. 创建 GitHub Release 并上传资产：

   ```bash
   scripts/release.sh
   scripts/publish-github-release.sh v0.3.0
   ```

   脚本从 `GITHUB_PAT` 或 `~/.config/mindustry-agent/github_pat` 读取 PAT，
   创建/推送 tag，创建非 draft release，并上传 jar 和 `SHA256SUMS`。它需要
   `Contents: Read and write`；已有仓库不需要 `Administration` 权限。
5. 验证 jar 非空且可以被 `jar` 打开：

   ```bash
   jar tf release/mindustry-agent-<version>.jar | head
   ```

不要把 `refs/`、`artifacts/`、probe discovery 文件、日志或 token 附加到 Release。
