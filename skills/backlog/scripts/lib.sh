#!/usr/bin/env bash
# Shared helpers for the backlog backend scripts. Sourced, not run.

backlog_now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

backlog_claimer() {
  if [[ -n "${CONDUCTOR_WORKSPACE_NAME:-}" ]]; then
    echo "conductor:$CONDUCTOR_WORKSPACE_NAME"
  elif [[ -n "${CMUX_WORKSPACE_ID:-}" ]]; then
    echo "cmux:$CMUX_WORKSPACE_ID"
  else
    echo "$(whoami)@$(hostname -s)"
  fi
}

backlog_branch() { git rev-parse --abbrev-ref HEAD 2>/dev/null; }

# Read backend declaration from backlog/AGENTS.md. Empty if unset.
backlog_backend() {
  awk '
    /^## Backend/ { flag=1; next }
    flag && /maildir-shared/ { print "maildir-shared"; exit }
    flag && /maildir-git/ { print "maildir-git"; exit }
    flag && /^## / { exit }
  ' backlog/AGENTS.md 2>/dev/null | head -1
}

# Next dir after $1 in the pipeline declared in AGENTS.md.
# Default pipeline: todo -> doing -> done.
backlog_next_dir() {
  local curr="$1"
  awk -v curr="$curr" '
    BEGIN { defaults["todo"]="doing"; defaults["doing"]="done" }
    /^## Pipeline/ { flag=1; next }
    flag && /[a-z]/ {
      parsed=1; n=0
      while (match($0, /[a-z][a-z0-9-]*/)) {
        arr[n++]=substr($0, RSTART, RLENGTH)
        $0=substr($0, RSTART + RLENGTH)
      }
      for (i=0; i<n; i++) if (arr[i]==curr && i+1<n) { print arr[i+1]; exit }
      exit
    }
    END { if (!parsed && curr in defaults) print defaults[curr] }
  ' backlog/AGENTS.md 2>/dev/null
}

# In-flight dir names from pipeline (excluding todo/done). Default: doing.
backlog_inflight_dirs() {
  awk '
    /^## Pipeline/ { flag=1; next }
    flag && /[a-z]/ {
      parsed=1
      while (match($0, /[a-z][a-z0-9-]*/)) {
        d=substr($0, RSTART, RLENGTH)
        if (d != "todo" && d != "done") print d
        $0=substr($0, RSTART + RLENGTH)
      }
      exit
    }
    END { if (!parsed) print "doing" }
  ' backlog/AGENTS.md 2>/dev/null
}

# Parse timeout from frontmatter (e.g. "3d") to seconds. Defaults to 7d.
backlog_timeout_seconds() {
  local file="$1"
  local t
  t=$(awk '/^---$/{n++; if(n==2) exit} n==1 && /^timeout:/ {sub(/^timeout:[[:space:]]*/, ""); print; exit}' "$file")
  [[ -z "$t" ]] && t=7d
  local n="${t%[smhdw]*}" unit="${t: -1}"
  case "$unit" in
    s) echo "$n" ;;
    m) echo "$((n*60))" ;;
    h) echo "$((n*3600))" ;;
    d) echo "$((n*86400))" ;;
    w) echo "$((n*604800))" ;;
    *) echo 604800 ;;
  esac
}

# Parse an ISO timestamp into epoch seconds (GNU date or BSD date).
backlog_epoch() {
  local ts="$1"
  date -j -u -f "%Y-%m-%dT%H:%M:%SZ" "$ts" +%s 2>/dev/null \
    || gdate -d "$ts" +%s 2>/dev/null
}

# Ensure body divider exists before appending log lines.
backlog_ensure_divider() {
  local file="$1"
  if [[ "$(grep -v '^[[:space:]]*$' "$file" | tail -1)" != "---" ]]; then
    printf '\n---\n' >> "$file"
  fi
}
