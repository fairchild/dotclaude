#!/bin/bash
# Discover active projects in ~/code and report their git status
# Usage: discover.sh [--json]

set -euo pipefail

CODE_ROOT="${CODE_ROOT:-$HOME/code}"
IGNORED="backburner|references|worktrees|tmp|todos"

json_output=false
[[ "${1:-}" == "--json" ]] && json_output=true

projects=()
for dir in "$CODE_ROOT"/*/; do
  name=$(basename "$dir")
  [[ "$name" =~ ^($IGNORED)$ ]] && continue
  [[ -d "$dir/.git" ]] && projects+=("$name")
done

if $json_output; then
  echo "["
  first=true
  for project in "${projects[@]}"; do
    cd "$CODE_ROOT/$project"

    branch=$(git branch --show-current 2>/dev/null || echo "detached")
    dirty=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')

    git fetch origin 2>/dev/null || true
    counts=$(git rev-list --left-right --count HEAD...@{u} 2>/dev/null || echo "0 0")
    ahead=$(echo "$counts" | awk '{print $1}')
    behind=$(echo "$counts" | awk '{print $2}')

    has_upstream=$(git remote | grep -q upstream && echo "true" || echo "false")

    $first || echo ","
    first=false
    cat <<EOF
  {
    "name": "$project",
    "branch": "$branch",
    "dirty": $dirty,
    "ahead": $ahead,
    "behind": $behind,
    "hasUpstream": $has_upstream
  }
EOF
  done
  echo "]"
else
  printf "%-20s %-12s %-8s %s\n" "PROJECT" "BRANCH" "CLEAN" "REMOTE"
  printf "%-20s %-12s %-8s %s\n" "-------" "------" "-----" "------"

  for project in "${projects[@]}"; do
    cd "$CODE_ROOT/$project"

    branch=$(git branch --show-current 2>/dev/null || echo "detached")
    dirty=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')

    git fetch origin 2>/dev/null || true
    counts=$(git rev-list --left-right --count HEAD...@{u} 2>/dev/null || echo "0 0")
    ahead=$(echo "$counts" | awk '{print $1}')
    behind=$(echo "$counts" | awk '{print $2}')

    clean="yes"
    [[ "$dirty" -gt 0 ]] && clean="no ($dirty)"

    if [[ "$ahead" == "0" && "$behind" == "0" ]]; then
      remote="up-to-date"
    elif [[ "$behind" == "0" ]]; then
      remote="${ahead} ahead"
    elif [[ "$ahead" == "0" ]]; then
      remote="${behind} behind"
    else
      remote="${ahead}↑ ${behind}↓"
    fi

    printf "%-20s %-12s %-8s %s\n" "$project" "$branch" "$clean" "$remote"
  done
fi
