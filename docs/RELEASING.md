# Releasing

The mod is distributed as a universal jar and as source on GitHub. The release
artifact is not committed to the repository.

## Prerequisites

```bash
scripts/fetch-mindustry.sh
# Android universal build also needs d8/android.jar; see probe-mod/build-universal.sh
```

## Build and checksum

```bash
scripts/release.sh
```

This builds `probe-mod/build/mindustry-agent.jar`, copies it to
`release/mindustry-agent-<version>.jar`, and writes `release/SHA256SUMS`.

## GitHub release

### First publish: create the repository

From the repository root:

```bash
scripts/publish-github.sh mindustry-agent
```

The script asks for a GitHub PAT with repository-creation permission, creates
`<your-login>/mindustry-agent` (empty, no README), adds a `github` remote, and
pushes the current branch. The PAT is read from `GITHUB_PAT`, or from
`~/.config/mindustry-agent/github_pat` (override with `GITHUB_PAT_FILE`), or
from a hidden prompt if neither exists. It is not written to `.git/config` or
`.git-credentials`; the existing Gitea `origin` is untouched.
The push uses an isolated git config so a stale global `gh-proxy.com` rewrite or
local proxy setting cannot break the upload.

To store the PAT outside the repository:

```bash
mkdir -p ~/.config/mindustry-agent
chmod 700 ~/.config/mindustry-agent
read -r -s -p 'GitHub PAT: ' GITHUB_PAT
printf '%s' "$GITHUB_PAT" > ~/.config/mindustry-agent/github_pat
unset GITHUB_PAT
chmod 600 ~/.config/mindustry-agent/github_pat
```

Do not put the PAT in an ignored folder inside the public repository; an
untracked file can still be exposed by backups, archives, or a later
`git add -f`. Prefer `~/.config/mindustry-agent/`.

Use `scripts/publish-github.sh mindustry-agent --private` for a private repo.
The script requires a classic PAT with `repo`, or a fine-grained PAT with
Contents read/write and Metadata read. Creating a new repository additionally
needs repository-creation permission; an existing repository only needs
Contents write to push. It does not create a release or
upload the jar.

1. Update `probe-mod/mod.json` and `ProbeMod.VERSION` together.
2. Update `CHANGELOG.md`.
3. Commit and push.
4. Create a tag matching the mod version:
   ```bash
   git tag v0.3.0
   git push origin v0.3.0
   ```
5. Attach `release/mindustry-agent-<version>.jar` and `release/SHA256SUMS` to the
   GitHub release.
6. Verify the jar is non-zero and opens with `jar tf`:
   ```bash
   jar tf release/mindustry-agent-<version>.jar | head
   ```

Do not attach `refs/`, `artifacts/`, probe discovery files, logs, or tokens.
