#!/usr/bin/env bash
# Backlog dispatch entrypoint. Detects backend from backlog/AGENTS.md and
# delegates to the matching implementation. The `setup` subcommand is special:
# it runs here because AGENTS.md doesn't exist yet.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
. "$script_dir/lib.sh"

usage() {
  cat <<EOF
backlog — task tracker shaped like a maildir

Usage:
  backlog setup [--backend=maildir-git|maildir-shared]
  backlog add <slug> [category]
  backlog take [slug]
  backlog advance <slug>
  backlog progress <note>
  backlog cancel <slug> <reason>
  backlog fail <slug> <reason>
  backlog rescue <slug>
  backlog retry <slug> <reason>
  backlog status
  backlog groom

Backend is read from backlog/AGENTS.md (## Backend section). Default: maildir-git.
See ~/.claude/skills/backlog/SKILL.md for the full surface.
EOF
}

cmd="${1:-}"
shift || true

if [[ "$cmd" == "" || "$cmd" == "-h" || "$cmd" == "--help" ]]; then
  usage; exit 0
fi

# `setup` runs in the entrypoint — AGENTS.md doesn't exist yet.
if [[ "$cmd" == "setup" ]]; then
  backend="maildir-git"
  for arg in "$@"; do
    case "$arg" in
      --backend=*) backend="${arg#--backend=}" ;;
    esac
  done
  case "$backend" in
    maildir-git|maildir-shared) ;;
    *) echo "unknown backend: $backend (expected maildir-git or maildir-shared)" >&2; exit 1 ;;
  esac
  impl="$script_dir/backlog-${backend}.sh"
  [[ -x "$impl" ]] || { echo "missing impl: $impl" >&2; exit 1; }
  exec "$impl" setup "$@"
fi

# Every other verb dispatches by declared backend.
backend="$(backlog_backend)"
[[ -z "$backend" ]] && backend="maildir-git"

impl="$script_dir/backlog-${backend}.sh"
[[ -x "$impl" ]] || { echo "unknown backend '$backend' — no $impl" >&2; exit 1; }

exec "$impl" "$cmd" "$@"
