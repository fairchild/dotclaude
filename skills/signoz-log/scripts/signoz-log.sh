#!/usr/bin/env bash
# signoz-log.sh - Send logs to SigNoz via OTLP HTTP
#
# Usage:
#   signoz-log.sh INFO "message"
#   signoz-log.sh ERROR "failed" "custom-service"
#
# From hooks (reads session context from stdin JSON):
#   signoz-log.sh INFO "session started"  # stdin: {"session_id":...,"cwd":...}
#
# Tailnet only — silently exits if la is unreachable.
# No set -e: this script must NEVER fail (it runs as a hook)

SIGNOZ_ENDPOINT="${SIGNOZ_ENDPOINT:-http://la:4318/v1/logs}"

# Read stdin if piped (hook JSON), otherwise empty
STDIN_DATA=""
if [ ! -t 0 ]; then
    STDIN_DATA=$(cat)
fi

# Pass everything via env to avoid shell interpolation inside python heredoc
export SL_SEVERITY="${1:-INFO}"
export SL_MESSAGE="${2:-}"
export SL_SERVICE="${3:-}"
export SL_STDIN="$STDIN_DATA"
export SL_ENDPOINT="$SIGNOZ_ENDPOINT"

/usr/bin/python3 << 'PYEOF'
import json, hashlib, os, subprocess, sys, time

def main():
    severity = os.environ.get("SL_SEVERITY", "INFO").upper()
    message = os.environ.get("SL_MESSAGE", "")
    service_override = os.environ.get("SL_SERVICE", "")
    endpoint = os.environ.get("SL_ENDPOINT", "http://la:4318/v1/logs")

    sev_map = {"INFO": (9, "INFO"), "WARN": (13, "WARN"), "ERROR": (17, "ERROR")}
    sev_num, sev_text = sev_map.get(severity, (9, "INFO"))

    # Parse hook stdin JSON for session context
    ctx = {}
    stdin_raw = os.environ.get("SL_STDIN", "")
    if stdin_raw.strip():
        try:
            ctx = json.loads(stdin_raw)
        except Exception:
            pass

    session_id = ctx.get("session_id", "")
    cwd = ctx.get("cwd", "")
    project = os.path.basename(cwd.rstrip("/")) if cwd else "unknown"
    hook_event = ctx.get("hook_event_name", "")
    service_name = service_override or project or "claude-agent"

    now_ns = str(int(time.time() * 1e9))
    trace_id = hashlib.md5(session_id.encode()).hexdigest() if session_id else ""
    span_id = os.urandom(8).hex()
    hostname = os.uname().nodename.split(".")[0]

    attrs = []
    for k, v in [("session.id", session_id), ("project", project),
                  ("cwd", cwd), ("hook.event", hook_event)]:
        if v:
            attrs.append({"key": k, "value": {"stringValue": v}})

    rec = {
        "timeUnixNano": now_ns,
        "observedTimeUnixNano": now_ns,
        "severityNumber": sev_num,
        "severityText": sev_text,
        "body": {"stringValue": message},
        "attributes": attrs,
        "spanId": span_id,
    }
    if trace_id:
        rec["traceId"] = trace_id

    payload = json.dumps({
        "resourceLogs": [{
            "resource": {
                "attributes": [
                    {"key": "service.name", "value": {"stringValue": service_name}},
                    {"key": "host.name", "value": {"stringValue": hostname}},
                ]
            },
            "scopeLogs": [{
                "scope": {"name": "claude-agent", "version": "1.0.0"},
                "logRecords": [rec],
            }],
        }]
    })

    # Fire and forget — background curl, 2s timeout
    subprocess.Popen(
        ["curl", "-s", "-o", "/dev/null",
         "--connect-timeout", "2", "--max-time", "2",
         "-X", "POST",
         "-H", "Content-Type: application/json",
         "-d", payload,
         endpoint],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

try:
    main()
except Exception:
    pass
PYEOF

exit 0
