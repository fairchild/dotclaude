#!/usr/bin/env bash
# Mint one single-use (JIT) runner config.
#   mint-jit.sh <owner/repo> <name-suffix> <out-file> [comma-separated-labels]
# A GitHub App mints it when $GONDOLIN_APP_CONFIG exists, and the operator's gh login otherwise.
# Either credential stays on the host; the out-file holds only this one runner's config.
set -euo pipefail

repo=${1:?usage: mint-jit.sh <owner/repo> <name-suffix> <out-file> [labels]}
suffix=${2:?missing name suffix}
out=${3:?missing out-file}
labels=${4:-self-hosted,gondolin,${suffix}}

here=$(cd -- "$(dirname -- "$0")" && pwd)
config=${GONDOLIN_APP_CONFIG:-${XDG_CONFIG_HOME:-$HOME/.config}/github-runner/config}
name="gondolin-${suffix}"

payload=$(jq -nc --arg name "$name" --arg labels "$labels" \
  '{name: $name, runner_group_id: 1, labels: ($labels | split(",")), work_folder: "_work"}')

umask 077
status=0
if [ -f "$config" ]; then
  # shellcheck source=lib/github-app.sh
  source "${here}/lib/github-app.sh"
  load_app_config "$config"
  token=$(app_installation_token "${repo#*/}")
  response=$(github_api "$token" -X POST -H "Content-Type: application/json" -d "$payload" \
    "https://api.github.com/repos/${repo}/actions/runners/generate-jitconfig") || status=$?
else
  response=$(printf '%s' "$payload" | gh api -X POST "repos/${repo}/actions/runners/generate-jitconfig" --input - 2> /dev/null) || status=$?
fi

jit=$(printf '%s' "$response" | jq -r '.encoded_jit_config // empty' 2> /dev/null || true)
if [ -z "$jit" ]; then
  message=$(printf '%s' "$response" | jq -r '.message // empty' 2> /dev/null || true)
  printf '%s\n' "${message:-generate-jitconfig failed (exit ${status})}" >&2
  exit 1
fi

printf '%s' "$jit" > "$out"
chmod 600 "$out"
printf '%s\n' "$name"
