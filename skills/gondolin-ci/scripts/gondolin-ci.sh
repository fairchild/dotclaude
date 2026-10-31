#!/usr/bin/env bash
# Pick a pull request, run one CI suite inside a disposable gondolin VM, and watch it go.
#   gondolin-ci.sh                   list candidates, newest first
#   gondolin-ci.sh run <pr> [suite] [sha]
#                                    run one at the commit you read; sha defaults to today's head,
#                                    and suite to the workflow's first
#   gondolin-ci.sh check             say what this laptop and repository still need
#   gondolin-ci.sh setup             install the lane's dependencies and build the guest
#
# The repository is $GONDOLIN_CI_REPO, or the one the current directory is a checkout of.
# $GONDOLIN_CI_WORKFLOW names its opt-in workflow, default pr-optin-run.yml.
set -euo pipefail

here=$(cd -- "$(dirname -- "$0")" && pwd)
lane=${GONDOLIN_RUNNER_DIR:-$(cd -- "${here}/../lane" && pwd)}
workflow=${GONDOLIN_CI_WORKFLOW:-pr-optin-run.yml}
assets=${GONDOLIN_ASSETS:-${XDG_CACHE_HOME:-$HOME/.cache}/gondolin-runner/assets}
config=${GONDOLIN_APP_CONFIG:-${XDG_CONFIG_HOME:-$HOME/.config}/github-runner/config}

if [ -t 1 ]; then
  dim=$'\033[2m'; bold=$'\033[1m'; cyan=$'\033[36m'; green=$'\033[32m'; yellow=$'\033[33m'; off=$'\033[0m'
else
  dim=''; bold=''; cyan=''; green=''; yellow=''; off=''
fi

usage() { sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; }

find_repo() {
  [ -z "${GONDOLIN_CI_REPO:-}" ] || return 0
  GONDOLIN_CI_REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner 2> /dev/null || true)
  if [ -z "$GONDOLIN_CI_REPO" ]; then
    printf '%s\n' "no repository: set GONDOLIN_CI_REPO=owner/name, or run this from a checkout of it" >&2
    return 2
  fi
  export GONDOLIN_CI_REPO
}

need_lane() {
  [ -f "${lane}/run-optin.sh" ] || {
    printf '%s\n' "no lane at ${lane}: unset GONDOLIN_RUNNER_DIR, or point it at one" >&2
    exit 1
  }
}

# Forks are left out because the lane refuses them. A title is its author's text, so it goes through
# the lane's sanitiser like any guest output.
candidates() {
  gh pr list --repo "$GONDOLIN_CI_REPO" --limit 30 --json number,title,headRefOid,updatedAt,isDraft,isCrossRepository \
    --jq "[.[] | select((.isDraft or .isCrossRepository) | not)][:${1:-6}][]"' | "\(.number)\t\(.headRefOid[0:8])\t\(.updatedAt[11:16])\t\(.title)"' \
    | node "${lane}/lib/terminal.mjs"
}

show_list() {
  local heading=$1 limit=$2 skip=${3:-}
  printf '\n%s%s%s\n\n' "$bold" "$heading" "$off"
  local first=1
  while IFS=$'\t' read -r num sha _when title; do
    [ -n "${num:-}" ] || continue
    [ "$num" = "$skip" ] && continue
    if [ "${#title}" -gt 56 ]; then title="${title:0:55}…"; fi
    if [ -z "$skip" ] && [ "$first" = 1 ]; then
      printf '  %s▸ %-5s%s %-56s  %s%s · newest%s\n' "$cyan" "$num" "$off" "$title" "$dim" "$sha" "$off"
      first=0
    else
      printf '    %s%-5s%s %-56s  %s%s%s\n' "$cyan" "$num" "$off" "$title" "$dim" "$sha" "$off"
    fi
  done <<< "$(candidates "$limit")"
}

# The suites are the workflow's jobs, each gated on its name in the `suites` input.
suites() {
  gh workflow view "$workflow" --repo "$GONDOLIN_CI_REPO" --yaml 2> /dev/null \
    | grep -oE "',[a-zA-Z0-9_-]+,'" | tr -d "'," | sort -u | paste -sd' ' - || true
}

missing=0
# label, what to do about it, then the command that says yes or no
report() {
  local label=$1 remedy=$2
  shift 2
  if "$@" > /dev/null 2>&1; then
    printf '  %sok%s       %s\n' "$green" "$off" "$label"
  else
    printf '  %smissing%s  %s %s— %s%s\n' "$yellow" "$off" "$label" "$dim" "$remedy" "$off"
    missing=$((missing + 1))
  fi
}

on_apple_silicon() { [ "$(uname -sm)" = "Darwin arm64" ]; }
node_is_recent() { [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 24 ]; }
lane_installed() { [ -d "${lane}/node_modules/@earendil-works/gondolin" ]; }
guest_built() { [ -f "${assets}/manifest.json" ]; }
has_mke2fs() { [ -x /opt/homebrew/opt/e2fsprogs/sbin/mke2fs ]; }
has_workflow() { gh api "repos/${GONDOLIN_CI_REPO}/actions/workflows/${workflow}"; }
is_private() { [ "$(gh api "repos/${GONDOLIN_CI_REPO}" --jq .private)" = true ]; }
has_app() { [ -f "$config" ]; }
is_admin() { [ "$(gh api "repos/${GONDOLIN_CI_REPO}" --jq .permissions.admin)" = true ]; }

check() {
  printf '\n%sThis laptop%s\n\n' "$bold" "$off"
  report "macOS on Apple silicon" "the lane's guest and priority bands need it" on_apple_silicon
  report "node 24 or newer" "brew install node" node_is_recent
  report "qemu" "brew install qemu" command -v qemu-system-aarch64
  report "jq" "brew install jq" command -v jq
  report "gh, logged in" "gh auth login" gh auth status
  report "the lane's dependencies" "gondolin-ci.sh setup" lane_installed
  report "the guest" "gondolin-ci.sh setup, which needs Docker and mke2fs" guest_built
  if ! guest_built; then
    report "docker, running" "start Docker" docker info
    report "mke2fs" "brew install e2fsprogs" has_mke2fs
    report "lz4" "brew install lz4" command -v lz4
  fi

  if ! find_repo; then
    printf '\n'
    return 1
  fi
  printf '\n%s%s%s\n\n' "$bold" "$GONDOLIN_CI_REPO" "$off"
  report "a private repository" "the lane refuses public ones (references/design.md, gap 2)" is_private
  report "${workflow} on the default branch" \
    "copy the skill's assets/pr-optin-run.yml to .github/workflows/ and merge it" has_workflow
  report "admin on the repository, to list and register runners" "ask an admin" is_admin
  has_app && report "a GitHub App to mint runners" "" has_app
  printf '\n'
  [ "$missing" = 0 ]
}

setup() {
  need_lane
  (cd "$lane" && npm ci)
  if guest_built; then
    printf '%s\n' "guest already built at ${assets}; to rebuild: bash ${lane}/build-image.sh"
  else
    bash "${lane}/build-image.sh"
  fi
}

case "${1:-list}" in
  list | "")
    need_lane
    find_repo || exit 2
    show_list "Pull requests this laptop can run in ${GONDOLIN_CI_REPO}" 6
    printf '\n  %ssuites%s  %s\n' "$dim" "$off" "$(suites)"
    printf '  %srun%s     gondolin-ci.sh run <pr> [suite] [sha]\n\n' "$dim" "$off"
    ;;
  run)
    need_lane
    find_repo || exit 2
    pr=${2:-}
    suite=${3:-}
    sha=${4:-}
    [ -n "$pr" ] || { usage >&2; exit 2; }
    # The head as it stands now is the commit the operator is asking for, so a push during the wait
    # for the VM slot refuses rather than running unread.
    [ -n "$sha" ] || sha=$(gh pr view "$pr" --repo "$GONDOLIN_CI_REPO" --json headRefOid --jq .headRefOid)
    status=0
    bash "${lane}/run-optin.sh" "$pr" "$suite" "$sha" || status=$?
    [ "$status" = 2 ] && exit 2
    show_list "Next" 5 "$pr"
    printf '\n  %sgondolin-ci.sh run <pr> [suite] [sha]%s\n\n' "$dim" "$off"
    exit "$status"
    ;;
  check)
    need_lane
    check
    ;;
  setup) setup ;;
  -h | --help | help) usage ;;
  *)
    usage >&2
    exit 2
    ;;
esac
