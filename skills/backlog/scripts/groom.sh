#!/usr/bin/env bash
# Groom the backlog: detect stuck doing/ items, unresolvable deps, cycles.
# Advisory — never moves files.
# Usage:
#   groom.sh [--backlog=PATH] [--quiet-after=DUR] [--no-network]

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

backlog_arg=""
quiet_after="7d"
no_network=0
for arg in "$@"; do
  case "$arg" in
    --backlog=*)     backlog_arg="${arg#*=}" ;;
    --quiet-after=*) quiet_after="${arg#*=}" ;;
    --no-network)    no_network=1 ;;
    --*) echo "unknown flag: $arg" >&2; exit 2 ;;
    *) backlog_arg="$arg" ;;
  esac
done

BACKLOG=$(find_backlog "$backlog_arg")

# ---- Duration parsing -----------------------------------------------------

# parse_dur "3d" → seconds
parse_dur() {
  local s="$1"
  local n="${s%[smhdw]*}"
  local unit="${s: -1}"
  case "$unit" in
    s) echo "$n" ;;
    m) echo $(( n * 60 )) ;;
    h) echo $(( n * 3600 )) ;;
    d) echo $(( n * 86400 )) ;;
    w) echo $(( n * 604800 )) ;;
    *) echo 0 ;;
  esac
}

iso_to_epoch() {
  local iso="$1"
  if command -v gdate >/dev/null 2>&1; then
    gdate -d "$iso" +%s 2>/dev/null
  elif date -j -f "%Y-%m-%dT%H:%M:%SZ" "$iso" +%s >/dev/null 2>&1; then
    date -j -u -f "%Y-%m-%dT%H:%M:%SZ" "$iso" +%s
  else
    python3 -c "import datetime,sys; print(int(datetime.datetime.strptime('$iso','%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=datetime.timezone.utc).timestamp()))"
  fi
}

now_epoch=$(date -u +%s)
quiet_secs=$(parse_dur "$quiet_after")

# ---- Buckets --------------------------------------------------------------

merged_not_moved=()
timed_out=()
quiet=()
unresolvable=()
ok_doing=0
ok_todo=0

# ---- doing/ checks --------------------------------------------------------

for f in "$BACKLOG"/doing/*.md; do
  [[ -f "$f" ]] || continue
  slug=$(slug_of "$f")
  claimed_at=$(read_fm_scalar "$f" claimed_at)
  timeout=$(read_fm_scalar "$f" timeout)
  branch=$(read_fm_scalar "$f" branch)
  pr=$(read_fm_scalar "$f" pr)

  age=0
  if [[ -n "$claimed_at" ]]; then
    epoch=$(iso_to_epoch "$claimed_at" 2>/dev/null || echo 0)
    [[ "$epoch" -gt 0 ]] && age=$(( now_epoch - epoch ))
  fi

  # Merged-but-not-moved: PR is set and merged, or branch is gone and present on main.
  if (( ! no_network )) && [[ -n "$pr" && "$pr" != "null" ]] && command -v gh >/dev/null 2>&1; then
    state=$(gh pr view "$pr" --json state -q .state 2>/dev/null || echo "")
    if [[ "$state" == "MERGED" ]]; then
      merged_not_moved+=("  $slug  (pr $pr merged — run complete.sh)")
      continue
    fi
  fi
  if [[ -n "$branch" && "$branch" != "(no-branch)" ]]; then
    if git -C "$BACKLOG" rev-parse --verify "$branch" >/dev/null 2>&1; then
      :
    elif git -C "$BACKLOG" log --oneline "main" 2>/dev/null | grep -q "$branch"; then
      merged_not_moved+=("  $slug  (branch $branch merged into main — run complete.sh)")
      continue
    fi
  fi

  # Timed out (author set a timeout).
  if [[ -n "$timeout" ]]; then
    limit=$(parse_dur "$timeout")
    if (( limit > 0 && age > limit )); then
      over=$(( age - limit ))
      timed_out+=("  $slug  (claimed ${age}s ago, timeout $timeout, +$(( over / 3600 ))h over)")
      continue
    fi
  fi

  # Quiet (no timeout, but no activity in quiet_after window).
  if (( age > quiet_secs )); then
    quiet+=("  $slug  (claimed $(( age / 86400 ))d ago, no declared timeout)")
    continue
  fi

  ok_doing=$(( ok_doing + 1 ))
done

# ---- Dep resolution checks (todo/ + doing/) ------------------------------

# Build a set of all slugs in tree.
all_slugs=$(find "$BACKLOG/todo" "$BACKLOG/doing" "$BACKLOG/done" -type f -name "*.md" 2>/dev/null \
  | xargs -n1 basename 2>/dev/null | sed 's/\.md$//' | sort -u || true)

slug_exists() {
  echo "$all_slugs" | grep -Fxq "$1"
}

for f in "$BACKLOG"/todo/*.md "$BACKLOG"/doing/*.md; do
  [[ -f "$f" ]] || continue
  slug=$(slug_of "$f")
  while IFS= read -r dep; do
    [[ -z "$dep" ]] && continue
    if ! slug_exists "$dep"; then
      unresolvable+=("  $slug  → $dep (no such slug in tree)")
    fi
  done < <(read_fm_dep_slugs "$f")
done

# ---- Cycle detection (todo + doing graph) --------------------------------

# Build adjacency: emit "src dst" pairs.
edges=$(mktemp)
trap 'rm -f "$edges"' EXIT
for f in "$BACKLOG"/todo/*.md "$BACKLOG"/doing/*.md; do
  [[ -f "$f" ]] || continue
  src=$(slug_of "$f")
  while IFS= read -r dep; do
    [[ -z "$dep" ]] && continue
    # Skip deps that are done (won't appear in active graph anyway).
    dep_pile=""
    dep_path=$(find "$BACKLOG/todo" "$BACKLOG/doing" -name "${dep}.md" -type f 2>/dev/null | head -1)
    [[ -n "$dep_path" ]] && echo "$src $dep" >> "$edges"
  done < <(read_fm_dep_slugs "$f")
done

cycles=()
if [[ -s "$edges" ]]; then
  # DFS-based cycle detection in awk.
  cycles_out=$(awk '
    {
      from = $1; to = $2
      adj[from] = (adj[from] == "" ? to : adj[from] " " to)
      nodes[from] = 1; nodes[to] = 1
    }
    function dfs(node, path, _, n, i, parts, child) {
      state[node] = 1   # gray
      n = split(adj[node], parts, " ")
      for (i = 1; i <= n; i++) {
        child = parts[i]
        if (child == "") continue
        if (state[child] == 1) {
          print path " -> " child
          return
        }
        if (state[child] == 0) dfs(child, path " -> " child)
      }
      state[node] = 2   # black
    }
    END {
      for (n in nodes) if (state[n] == 0) dfs(n, n)
    }
  ' "$edges")
  if [[ -n "$cycles_out" ]]; then
    while IFS= read -r line; do
      [[ -n "$line" ]] && cycles+=("  $line")
    done <<< "$cycles_out"
  fi
fi

# ---- todo/ counts --------------------------------------------------------

for f in "$BACKLOG"/todo/*.md; do
  [[ -f "$f" ]] && ok_todo=$(( ok_todo + 1 ))
done

# ---- Report --------------------------------------------------------------

print_bucket() {
  # $1=title  $2=count  $3..=lines
  local title="$1"; local count="$2"; shift 2
  (( count == 0 )) && return
  echo ""
  echo "## $title ($count)"
  printf '%s\n' "$@"
}

echo "Backlog Grooming Report"
echo "======================="
print_bucket "MERGED BUT NOT MOVED" "${#merged_not_moved[@]}" "${merged_not_moved[@]+"${merged_not_moved[@]}"}"
print_bucket "TIMED OUT"            "${#timed_out[@]}"        "${timed_out[@]+"${timed_out[@]}"}"
print_bucket "QUIET"                "${#quiet[@]}"            "${quiet[@]+"${quiet[@]}"}"
print_bucket "UNRESOLVABLE DEPS"    "${#unresolvable[@]}"     "${unresolvable[@]+"${unresolvable[@]}"}"
print_bucket "CYCLES"               "${#cycles[@]}"           "${cycles[@]+"${cycles[@]}"}"

echo ""
echo "## OK"
echo "  todo:  $ok_todo"
echo "  doing: $ok_doing (healthy)"
