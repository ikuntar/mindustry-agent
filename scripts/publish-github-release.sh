#!/usr/bin/env bash
#
# Publish a GitHub Release for the current checkout.
#
# Usage:
#   scripts/publish-github-release.sh [v0.3.0]
#
# The version defaults to v<probe-mod/mod.json version>. The script requires:
#   - a clean or committed local tree
#   - release/mindustry-agent-<version>.jar and SHA256SUMS
#   - a PAT in GITHUB_PAT or ~/.config/mindustry-agent/github_pat
#     with Contents: Read and write for this repository
#
# It creates the tag if needed, pushes the tag, creates a non-draft GitHub
# Release, and uploads the jar plus SHA256SUMS.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

REPO_SLUG="${GITHUB_REPOSITORY:-ikuntar/mindustry-agent}"
MOD_VERSION="$(python3 -c 'import json; print(json.load(open("probe-mod/mod.json"))["version"])')"
TAG="${1:-v${MOD_VERSION}}"
VERSION="${TAG#v}"
JAR="release/mindustry-agent-${VERSION}.jar"
SUMS="release/SHA256SUMS"
PAT_FILE="${GITHUB_PAT_FILE:-${XDG_CONFIG_HOME:-$HOME/.config}/mindustry-agent/github_pat}"

if [[ "${TAG}" != v* ]]; then
    printf 'tag must start with v: %s\n' "${TAG}" >&2
    exit 2
fi
for file in "${JAR}" "${SUMS}"; do
    if [[ ! -s "${file}" ]]; then
        printf 'missing release file: %s\n' "${file}" >&2
        exit 2
    fi
done
if [[ -n "$(git status --porcelain)" ]]; then
    printf 'working tree is not clean; commit changes before publishing\n' >&2
    exit 2
fi

PAT="${GITHUB_PAT:-}"
if [[ -z "${PAT}" && -f "${PAT_FILE}" ]]; then
    PAT="$(<"${PAT_FILE}")"
fi
if [[ -z "${PAT}" ]]; then
    printf 'GitHub PAT (input hidden): ' >&2
    IFS= read -r -s PAT
    printf '\n' >&2
fi
if [[ -z "${PAT}" ]]; then
    printf 'empty PAT\n' >&2
    exit 2
fi

umask 077
TMP_DIR="$(mktemp -d)"
ASKPASS="${TMP_DIR}/askpass.sh"
CURL_CONFIG="${TMP_DIR}/curl.conf"
NOTES="${TMP_DIR}/notes.md"
PAYLOAD="${TMP_DIR}/release.json"
RESPONSE="${TMP_DIR}/response.json"
cleanup() { rm -rf "${TMP_DIR}"; }
trap cleanup EXIT

printf 'header = "Authorization: Bearer %s"\n' "${PAT}" > "${CURL_CONFIG}"
chmod 600 "${CURL_CONFIG}"
cat > "${ASKPASS}" <<'EOF'
#!/bin/sh
case "$1" in
    *Username*) printf '%s\n' 'x-access-token' ;;
    *Password*) printf '%s\n' "${GITHUB_PAT}" ;;
    *) printf '\n' ;;
esac
EOF
chmod 700 "${ASKPASS}"

# Use the changelog section for the release body.
python3 - "${VERSION}" "${NOTES}" <<'PY'
import pathlib, sys
version, out = sys.argv[1], sys.argv[2]
text = pathlib.Path("CHANGELOG.md").read_text()
needle = f"## {version}"
start = text.find(needle)
if start < 0:
    body = f"Mindustry Agent {version}"
else:
    start += len(needle)
    end = text.find("\n## ", start)
    body = text[start:end if end >= 0 else None].strip()
pathlib.Path(out).write_text(f"# Mindustry Agent {version}\n\n{body}\n\n"
    f"## Assets\n\n"
    f"- `mindustry-agent-{version}.jar`\n"
    f"- `SHA256SUMS`\n")
PY

printf 'Publishing %s (%s)...\n' "${TAG}" "${REPO_SLUG}" >&2

# Create or reuse the local tag. Never move an existing tag.
if git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null; then
    TAG_COMMIT="$(git rev-list -n 1 "${TAG}")"
    HEAD_COMMIT="$(git rev-parse HEAD)"
    if [[ "${TAG_COMMIT}" != "${HEAD_COMMIT}" ]]; then
        printf 'tag %s already exists at %s, not HEAD %s\n' "${TAG}" "${TAG_COMMIT}" "${HEAD_COMMIT}" >&2
        exit 2
    fi
else
    git tag -a "${TAG}" -m "Mindustry Agent ${VERSION}"
fi

GIT_CONFIG_GLOBAL=/dev/null \
GIT_CONFIG_SYSTEM=/dev/null \
GITHUB_PAT="${PAT}" \
GIT_ASKPASS="${ASKPASS}" \
GIT_TERMINAL_PROMPT=0 \
    git -c credential.helper= push github "${TAG}"

python3 - "${TAG}" "${REPO_SLUG}" "${NOTES}" "${PAYLOAD}" <<'PY'
import json, pathlib, sys
tag, repo, notes, out = sys.argv[1:5]
payload = {
    "tag_name": tag,
    "name": f"Mindustry Agent {tag[1:]}",
    "body": pathlib.Path(notes).read_text(),
    "draft": False,
    "prerelease": False,
}
pathlib.Path(out).write_text(json.dumps(payload))
PY

API="https://api.github.com/repos/${REPO_SLUG}/releases"
HTTP_CODE="$(curl --silent --show-error --output "${RESPONSE}" --write-out '%{http_code}' \
    --request POST \
    --config "${CURL_CONFIG}" \
    --header 'Accept: application/vnd.github+json' \
    --header 'X-GitHub-Api-Version: 2022-11-28' \
    --header 'Content-Type: application/json' \
    --data-binary @"${PAYLOAD}" \
    "${API}")"
if [[ "${HTTP_CODE}" != "201" ]]; then
    cat "${RESPONSE}" >&2
    printf '\nGitHub release API returned HTTP %s.\n' "${HTTP_CODE}" >&2
    exit 1
fi

UPLOAD_URL="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["upload_url"].split("{",1)[0])' "${RESPONSE}")"
RELEASE_URL="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["html_url"])' "${RESPONSE}")"

upload() {
    local file="$1"
    local name
    name="$(basename "${file}")"
    local code
    code="$(curl --silent --show-error --output "${RESPONSE}.upload" --write-out '%{http_code}' \
        --request POST \
        --config "${CURL_CONFIG}" \
        --header 'Accept: application/vnd.github+json' \
        --header 'X-GitHub-Api-Version: 2022-11-28' \
        --header 'Content-Type: application/octet-stream' \
        --data-binary @"${file}" \
        "${UPLOAD_URL}?name=${name}")"
    if [[ "${code}" != "201" ]]; then
        cat "${RESPONSE}.upload" >&2
        printf '\nupload failed for %s (HTTP %s).\n' "${name}" "${code}" >&2
        exit 1
    fi
    printf 'uploaded: %s\n' "${name}" >&2
}

upload "${JAR}"
upload "${SUMS}"

printf '\nRelease: %s\n' "${RELEASE_URL}"
printf 'Tag:     %s\n' "${TAG}"
printf 'Assets:\n'
printf '  %s\n' "${JAR}"
printf '  %s\n' "${SUMS}"
