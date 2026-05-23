#!/usr/bin/env bash
# Shared helpers for backlog scripts. Source me, don't run me.
# All scripts: ~/.claude/skills/backlog/scripts/{add,take,complete,...}.sh
#
# Conventions:
#   $BACKLOG points to the backlog root for the duration of a script
#   slugs are filenames minus .md, kebab-case
#   frontmatter mutations are atomic (write to temp, mv)

set -euo pipefail

# ---- Path resolution -------------------------------------------------------

# find_backlog [explicit_path]
# Resolves the backlog directory. Looks at $1 first, then ./backlog, then
# walks upward looking for a backlog/ sibling. Echos absolute path.
find_backlog() {
  local explicit="${1:-}"
  if [[ -n "$explicit" ]]; then
    [[ -d "$explicit" ]] || { echo "no such dir: $explicit" >&2; return 1; }
    cd "$explicit" && pwd
    return 0
  fi

  if [[ -d backlog ]]; then
    cd backlog && pwd
    return 0
  fi

  local dir
  dir=$(pwd)
  while [[ "$dir" != "/" ]]; do
    if [[ -d "$dir/backlog" ]]; then
      echo "$dir/backlog"
      return 0
    fi
    dir=$(dirname "$dir")
  done

  echo "no backlog/ directory found (tried ./backlog and ancestors)" >&2
  return 1
}

ensure_dirs() {
  local backlog="$1"
  mkdir -p "$backlog/todo" "$backlog/doing" "$backlog/done"
}

# ---- Slug + file resolution ------------------------------------------------

slug_of() {
  local path="$1"
  local b
  b=$(basename "$path")
  echo "${b%.md}"
}

# resolve_slug BACKLOG SLUG
# Find a task file by slug across todo/, doing/, done/**. Echos absolute path.
# Exits non-zero if not found or ambiguous.
resolve_slug() {
  local backlog="$1"
  local slug="$2"
  local matches=()
  while IFS= read -r f; do
    matches+=("$f")
  done < <(find "$backlog/todo" "$backlog/doing" "$backlog/done" -name "${slug}.md" -type f 2>/dev/null)

  if [[ ${#matches[@]} -eq 0 ]]; then
    echo "slug not found: $slug" >&2
    return 1
  fi
  if [[ ${#matches[@]} -gt 1 ]]; then
    echo "ambiguous slug: $slug" >&2
    printf '  %s\n' "${matches[@]}" >&2
    return 1
  fi
  echo "${matches[0]}"
}

# pile_of PATH
# todo | doing | done
pile_of() {
  local path="$1"
  local rel="${path#*/backlog/}"
  case "$rel" in
    todo/*) echo todo ;;
    doing/*) echo doing ;;
    done/*) echo done ;;
    *) echo unknown ;;
  esac
}

# ---- Time --------------------------------------------------------------

iso_now() {
  date -u +%Y-%m-%dT%H:%M:%SZ
}

year_now() {
  date -u +%Y
}

# ---- Frontmatter parsing -----------------------------------------------

# read_fm_scalar FILE KEY
# Print the value of a scalar frontmatter key (no quoting cleanup beyond trim).
# Returns empty if absent or if file has no frontmatter.
read_fm_scalar() {
  local file="$1"
  local key="$2"
  awk -v key="$key" '
    NR==1 { if ($0 != "---") exit; in_fm=1; next }
    in_fm && /^---$/ { exit }
    in_fm {
      # match "key:" at start of line, capture value
      if (match($0, "^" key ":[[:space:]]*")) {
        val = substr($0, RSTART + RLENGTH)
        # strip surrounding quotes
        sub(/^"/, "", val); sub(/"$/, "", val)
        sub(/^'\''/, "", val); sub(/'\''$/, "", val)
        # trim trailing whitespace
        sub(/[[:space:]]+$/, "", val)
        print val
        exit
      }
    }
  ' "$file"
}

# read_fm_dep_slugs FILE
# Print one dep slug per line. Supports block form (preferred):
#   dependencies:
#     foo: "reason"
#     bar: ""
# and inline form:
#   dependencies: {foo: "reason", bar: ""}
read_fm_dep_slugs() {
  local file="$1"
  awk '
    NR==1 { if ($0 != "---") exit; in_fm=1; next }
    in_fm && /^---$/ { exit }
    in_fm {
      # inline form: dependencies: {a: ..., b: ...}
      if (match($0, /^dependencies:[[:space:]]*\{/)) {
        line = $0
        sub(/^dependencies:[[:space:]]*\{/, "", line)
        sub(/\}[[:space:]]*$/, "", line)
        n = split(line, parts, ",")
        for (i = 1; i <= n; i++) {
          gsub(/^[[:space:]]+|[[:space:]]+$/, "", parts[i])
          colon = index(parts[i], ":")
          if (colon > 0) {
            k = substr(parts[i], 1, colon - 1)
            gsub(/^[[:space:]]+|[[:space:]]+$/, "", k)
            gsub(/^"|"$/, "", k)
            if (k != "") print k
          }
        }
        next
      }
      # block form opener
      if (/^dependencies:[[:space:]]*$/) { in_block=1; next }
      if (in_block) {
        # any non-indented line ends the block
        if (!/^[[:space:]]/) { in_block=0; next }
        # extract slug before the first colon
        line = $0
        sub(/^[[:space:]]+/, "", line)
        colon = index(line, ":")
        if (colon > 0) {
          k = substr(line, 1, colon - 1)
          gsub(/^[[:space:]]+|[[:space:]]+$/, "", k)
          gsub(/^"|"$/, "", k)
          if (k != "") print k
        }
      }
    }
  ' "$file"
}

# ---- Frontmatter mutation --------------------------------------------------

# fm_set_scalar FILE KEY VALUE
# Set or replace a scalar field in the frontmatter. If the field exists it is
# replaced in place; otherwise appended just before the closing ---.
# Atomic: writes to a temp file and mv.
fm_set_scalar() {
  local file="$1"
  local key="$2"
  local value="$3"
  local tmp
  tmp=$(mktemp)
  awk -v key="$key" -v value="$value" '
    BEGIN { state = "pre"; replaced = 0 }
    state == "pre" {
      print
      if (NR == 1 && $0 == "---") state = "fm"
      else if (NR == 1) { state = "done" }
      next
    }
    state == "fm" {
      if ($0 == "---") {
        if (!replaced) print key ": " value
        print
        state = "done"
        next
      }
      if (match($0, "^" key ":")) {
        print key ": " value
        replaced = 1
        next
      }
      print
      next
    }
    { print }
  ' "$file" > "$tmp"
  mv "$tmp" "$file"
}

# fm_clear_scalar FILE KEY
# Remove a scalar field from frontmatter (no-op if absent).
fm_clear_scalar() {
  local file="$1"
  local key="$2"
  local tmp
  tmp=$(mktemp)
  awk -v key="$key" '
    BEGIN { state = "pre" }
    state == "pre" {
      print
      if (NR == 1 && $0 == "---") state = "fm"
      else if (NR == 1) state = "done"
      next
    }
    state == "fm" {
      if ($0 == "---") { state = "done"; print; next }
      if (match($0, "^" key ":")) next
      print
      next
    }
    { print }
  ' "$file" > "$tmp"
  mv "$tmp" "$file"
}

# ---- Body append -----------------------------------------------------------

# append_block FILE KIND BODY
# Append a "### KIND — ISO\n\nBODY\n\n---" block to the file. Adds a leading
# blank line if needed so the new block separates cleanly.
append_block() {
  local file="$1"
  local kind="$2"
  local body="$3"

  # Ensure the file ends with a newline before appending.
  if [[ -s "$file" ]] && [[ "$(tail -c 1 "$file")" != $'\n' ]]; then
    printf '\n' >> "$file"
  fi

  {
    printf '\n### %s — %s\n\n' "$kind" "$(iso_now)"
    printf '%s\n' "$body"
    printf '\n---\n'
  } >> "$file"
}

# ---- Misc --------------------------------------------------------------

# default_claim_id
# Best-effort identifier for who is claiming. Reads env hints from Conductor /
# cmux, falls back to whoami@host:branch.
default_claim_id() {
  if [[ -n "${CONDUCTOR_WORKSPACE_NAME:-}" ]]; then
    echo "conductor:${CONDUCTOR_WORKSPACE_NAME}"
    return
  fi
  if [[ -n "${CMUX_WORKSPACE_ID:-}" ]]; then
    echo "cmux:${CMUX_WORKSPACE_ID}"
    return
  fi
  local user host
  user=$(whoami 2>/dev/null || echo unknown)
  host=$(hostname -s 2>/dev/null || echo localhost)
  echo "${user}@${host}"
}

current_branch() {
  git rev-parse --abbrev-ref HEAD 2>/dev/null || echo ""
}

# find_doing_on_branch BACKLOG [BRANCH]
# Echo the absolute path of the single doing/ task on the given branch
# (default: current branch). Returns non-zero on 0 or >1 matches and
# prints a diagnostic to stderr.
find_doing_on_branch() {
  local backlog="$1"
  local branch="${2:-$(current_branch)}"
  local matches=()
  local f b
  for f in "$backlog"/doing/*.md; do
    [[ -f "$f" ]] || continue
    b=$(read_fm_scalar "$f" branch)
    [[ "$b" == "$branch" ]] && matches+=("$f")
  done
  if [[ ${#matches[@]} -eq 0 ]]; then
    echo "no doing/ task on branch '$branch' — pass a slug" >&2
    return 1
  fi
  if [[ ${#matches[@]} -gt 1 ]]; then
    echo "multiple doing/ tasks on branch '$branch' — pass a slug:" >&2
    printf '  %s\n' "${matches[@]}" >&2
    return 1
  fi
  echo "${matches[0]}"
}

# move_in_backlog BACKLOG FROM_ABS TO_ABS
# Uses git mv if FROM is a tracked file in a git repo; otherwise plain mv.
# Creates the destination directory as needed.
move_in_backlog() {
  local backlog="$1" from="$2" to="$3"
  local rel_from="${from#$backlog/}"
  local rel_to="${to#$backlog/}"
  mkdir -p "$(dirname "$to")"
  if git -C "$backlog" rev-parse --git-dir >/dev/null 2>&1 \
     && git -C "$backlog" ls-files --error-unmatch "$rel_from" >/dev/null 2>&1; then
    git -C "$backlog" mv "$rel_from" "$rel_to"
  else
    mv "$from" "$to"
  fi
}
