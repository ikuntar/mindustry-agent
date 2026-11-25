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

This builds `probe-mod/build/ai-probe.jar`, copies it to
`release/ai-probe-<version>.jar`, and writes `release/SHA256SUMS`.

## GitHub release

1. Update `probe-mod/mod.json` and `ProbeMod.VERSION` together.
2. Update `CHANGELOG.md`.
3. Commit and push.
4. Create a tag matching the mod version:
   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```
5. Attach `release/ai-probe-<version>.jar` and `release/SHA256SUMS` to the
   GitHub release.
6. Verify the jar is non-zero and opens with `jar tf`:
   ```bash
   jar tf release/ai-probe-<version>.jar | head
   ```

Do not attach `refs/`, `artifacts/`, probe discovery files, logs, or tokens.
