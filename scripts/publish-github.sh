#!/usr/bin/env bash
#
# Create a GitHub repository and push this checkout to it.
#
# The PAT is read without echo and is never written to .git/config or
# .git-credentials. It is passed to git through GIT_ASKPASS for this one push.
#
# Usage:
#   scripts/publish-github.sh [repo-name] [--private]
#
# Requires a GitHub PAT with repository creation permission:
#   - classic PAT: repo scope
#   - fine-grained PAT: Administration (read/write) + Contents (read/write)
#     for the target account/repository
#
# The existing "origin" remote (Gitea) is left untouched. A separate
# "github" remote is added or updated.

set -euo pipefail

REPO_NAME="${1:-mindustry-agent}"
if [[ "${REPO_NAME}" == "--help" || "${REPO_NAME}" == "-h" ]]; then
    sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
fi
VISIBILITY="public"
if [[ "${2:-}" == "--private" ]]; then
    VISIBILITY="private"
fi
if [[ ! "${REPO_NAME}" =~ ^[A-Za-z0-9._-]+$ ]]; then
    printf 'invalid repository name: %s\n' "${REPO_NAME}" >&2
    exit 2
fi

for command in git curl python3; do
    if ! command -v "${command}" >/dev/null 2>&1; then
        printf 'missing dependency: %s\n' "${command}" >&2
        exit 2
    fi
done

if [[ ! -d .git ]]; then
    printf 'run this from the repository root\n' >&2
    exit 2
fi

BRANCH="$(git symbolic-ref --short HEAD 2>/dev/null || true)"
if [[ -z "${BRANCH}" ]]; then
    printf 'the current checkout is not on a branch\n' >&2
    exit 2
fi

if [[ -n "$(git status --porcelain)" ]]; then
    printf 'warning: uncommitted changes are not included in this push\n' >&2
fi

PAT="${GITHUB_PAT:-}"
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
RESPONSE="${TMP_DIR}/response.json"
cleanup() {
    rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

# Keep the token out of curl's argv (which is visible in ps). The config file
# is mode 700 inside the temporary directory and is deleted on exit.
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

api() {
    curl --silent --show-error --fail-with-body \
        --config "${CURL_CONFIG}" \
        --header 'Accept: application/vnd.github+json' \
        --header 'X-GitHub-Api-Version: 2022-11-28' \
        "$@"
}

printf 'Reading GitHub account...\n' >&2
USER_JSON="$(api https://api.github.com/user)"
LOGIN="$(printf '%s' "${USER_JSON}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["login"])')"
if [[ -z "${LOGIN}" ]]; then
    printf 'could not read the GitHub login from the PAT\n' >&2
    exit 1
fi
printf 'Authenticated as %s\n' "${LOGIN}" >&2

PAYLOAD="$(python3 - "${REPO_NAME}" "${VISIBILITY}" <<'PY'
import json, sys
print(json.dumps({
    "name": sys.argv[1],
    "private": sys.argv[2] == "private",
    "auto_init": False,
    "description": "Mindustry AI co-op assistant mod with MCP/session API",
}))
PY
)"

printf 'Creating %s/%s (%s)...\n' "${LOGIN}" "${REPO_NAME}" "${VISIBILITY}" >&2
HTTP_CODE="$(curl --silent --show-error --output "${RESPONSE}" --write-out '%{http_code}' \
    --request POST \
    --config "${CURL_CONFIG}" \
    --header 'Accept: application/vnd.github+json' \
    --header 'X-GitHub-Api-Version: 2022-11-28' \
    --header 'Content-Type: application/json' \
    --data "${PAYLOAD}" \
    https://api.github.com/user/repos)"

case "${HTTP_CODE}" in
    201)
        FULL_NAME="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["full_name"])' "${RESPONSE}")"
        printf 'Created %s\n' "${FULL_NAME}" >&2
        ;;
    422)
        # The repository may already exist. Only continue if it is readable
        # by this PAT; otherwise show GitHub's validation error.
        if api "https://api.github.com/repos/${LOGIN}/${REPO_NAME}" >/dev/null 2>&1; then
            printf 'Repository already exists; continuing with the push.\n' >&2
        else
            cat "${RESPONSE}" >&2
            printf '\nGitHub rejected repository creation (HTTP 422).\n' >&2
            exit 1
        fi
        ;;
    *)
        cat "${RESPONSE}" >&2
        printf '\nGitHub API returned HTTP %s.\n' "${HTTP_CODE}" >&2
        exit 1
        ;;
esac

REMOTE_URL="https://github.com/${LOGIN}/${REPO_NAME}.git"
if git remote get-url github >/dev/null 2>&1; then
    git remote set-url github "${REMOTE_URL}"
else
    git remote add github "${REMOTE_URL}"
fi

printf 'Pushing %s to github (%s)...\n' "${BRANCH}" "${REMOTE_URL}" >&2
# This machine has a global url.*.insteadOf rewrite to gh-proxy.com and an
# http(s).proxy pointing at 127.0.0.1:7897. Either can be stale. Push with an
# isolated git config so a dead local proxy does not break the publish; the
# remote itself is still the clean https://github.com URL.
GIT_CONFIG_GLOBAL=/dev/null \
GIT_CONFIG_SYSTEM=/dev/null \
GITHUB_PAT="${PAT}" \
GIT_ASKPASS="${ASKPASS}" \
GIT_TERMINAL_PROMPT=0 \
    git -c credential.helper= push -u github "${BRANCH}"

printf '\nDone.\n'
printf 'Repository: https://github.com/%s/%s\n' "${LOGIN}" "${REPO_NAME}"
printf 'Remote:     github -> %s\n' "${REMOTE_URL}"
printf 'Branch:     %s\n' "${BRANCH}"
