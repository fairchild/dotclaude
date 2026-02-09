#!/bin/bash
set -euo pipefail

mkdir -p ~/.claude/cadence
/usr/bin/python3 -c '
import json, os, sys, time

def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        return

    sid = data.get("session_id")
    if not sid:
        return

    cwd = data.get("cwd", "")
    project = os.path.basename(cwd.rstrip("/")) if cwd else "unknown"

    marker = os.path.expanduser(f"~/.claude/cadence/stop-{sid}")
    tmp = marker + ".tmp"
    payload = {
        "session_id": sid,
        "project_name": project,
        "cwd": cwd,
        "timestamp": int(time.time()),
    }

    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(payload, handle)

    os.replace(tmp, marker)

main()
'
