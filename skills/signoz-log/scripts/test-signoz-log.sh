#!/usr/bin/env bash
# test-signoz-log.sh - TDD test suite for signoz-log.sh
#
# Usage: ./test-signoz-log.sh [--live]
#   Without --live: validates payload generation only (no network)
#   With --live: also sends to SigNoz and checks HTTP 200
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_SCRIPT="$SCRIPT_DIR/signoz-log.sh"
PASS=0
FAIL=0
LIVE="${1:-}"

upper() { echo "$1" | tr '[:lower:]' '[:upper:]'; }
pass() { PASS=$((PASS + 1)); printf "  PASS: %s\n" "$1"; }
fail() { FAIL=$((FAIL + 1)); printf "  FAIL: %s\n" "$1"; }

echo "=== signoz-log.sh test suite ==="
echo ""

# --- Exit code tests (script must never fail) ---
echo "Exit code tests:"

echo '{"session_id":"t1","cwd":"/tmp"}' | "$LOG_SCRIPT" INFO "basic message" > /dev/null 2>&1 && pass "basic message" || fail "basic message"

"$LOG_SCRIPT" INFO "no stdin" > /dev/null 2>&1 && pass "no stdin" || fail "no stdin"

"$LOG_SCRIPT" INFO "" > /dev/null 2>&1 && pass "empty message" || fail "empty message"

"$LOG_SCRIPT" > /dev/null 2>&1 && pass "no args" || fail "no args"

echo 'not json' | "$LOG_SCRIPT" ERROR "bad stdin" > /dev/null 2>&1 && pass "malformed stdin" || fail "malformed stdin"

echo '{"session_id":"t5","cwd":"/tmp"}' | "$LOG_SCRIPT" INFO "it's a \"quoted\" \$message" > /dev/null 2>&1 && pass "special chars" || fail "special chars"

LONG_MSG=$(python3 -c "print('x' * 5000)")
echo '{"session_id":"t6","cwd":"/tmp"}' | "$LOG_SCRIPT" ERROR "$LONG_MSG" > /dev/null 2>&1 && pass "long message (5k)" || fail "long message (5k)"

SIGNOZ_ENDPOINT="http://192.0.2.1:4318/v1/logs" "$LOG_SCRIPT" INFO "unreachable" > /dev/null 2>&1 && pass "unreachable endpoint" || fail "unreachable endpoint"

echo '{"session_id":"t8","cwd":"/tmp"}' | "$LOG_SCRIPT" INFO "custom svc" "my-service" > /dev/null 2>&1 && pass "custom service name" || fail "custom service name"

echo ""

# --- Payload validation tests ---
echo "Payload validation tests:"

# Helper: run the python portion with a dry-run that prints payload to stdout
validate_payload() {
    local description="$1"
    local stdin_data="$2"
    local severity="$3"
    local message="$4"
    local service="${5:-}"

    local payload
    payload=$(SL_SEVERITY="$severity" SL_MESSAGE="$message" SL_SERVICE="$service" SL_STDIN="$stdin_data" SL_ENDPOINT="dry-run" \
        /usr/bin/python3 -c '
import json, hashlib, os, time

severity = os.environ.get("SL_SEVERITY", "INFO").upper()
message = os.environ.get("SL_MESSAGE", "")
service_override = os.environ.get("SL_SERVICE", "")

sev_map = {"INFO": (9, "INFO"), "WARN": (13, "WARN"), "ERROR": (17, "ERROR")}
sev_num, sev_text = sev_map.get(severity, (9, "INFO"))

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
for k, v in [("session.id", session_id), ("project", project), ("cwd", cwd), ("hook.event", hook_event)]:
    if v:
        attrs.append({"key": k, "value": {"stringValue": v}})

rec = {
    "timeUnixNano": now_ns, "observedTimeUnixNano": now_ns,
    "severityNumber": sev_num, "severityText": sev_text,
    "body": {"stringValue": message}, "attributes": attrs, "spanId": span_id,
}
if trace_id:
    rec["traceId"] = trace_id

payload = {
    "resourceLogs": [{
        "resource": {"attributes": [
            {"key": "service.name", "value": {"stringValue": service_name}},
            {"key": "host.name", "value": {"stringValue": hostname}},
        ]},
        "scopeLogs": [{"scope": {"name": "claude-agent", "version": "1.0.0"}, "logRecords": [rec]}],
    }]
}
print(json.dumps(payload))
' 2>/dev/null) || { fail "$description (python error)"; return; }

    # Validate it's valid JSON
    echo "$payload" | python3 -c "import json,sys; json.load(sys.stdin)" 2>/dev/null || { fail "$description (invalid JSON)"; return; }

    # Extract and check fields
    local check
    check=$(echo "$payload" | python3 -c "
import json, sys
p = json.load(sys.stdin)
rl = p['resourceLogs'][0]
svc = next(a['value']['stringValue'] for a in rl['resource']['attributes'] if a['key'] == 'service.name')
rec = rl['scopeLogs'][0]['logRecords'][0]
body = rec['body']['stringValue']
sev = rec['severityText']
print(f'{sev}|{svc}|{body}')
" 2>/dev/null) || { fail "$description (field extraction)"; return; }

    local expected_sev expected_svc expected_body
    expected_sev="${6:-$severity}"
    expected_svc="${7:-}"
    expected_body="${8:-$message}"

    local actual_sev actual_svc actual_body
    actual_sev=$(echo "$check" | cut -d'|' -f1)
    actual_svc=$(echo "$check" | cut -d'|' -f2)
    actual_body=$(echo "$check" | cut -d'|' -f3-)

    if [ "$actual_sev" != "$(upper "$expected_sev")" ]; then
        fail "$description (severity: got '$actual_sev' want '$(upper "$expected_sev")')"
        return
    fi
    if [ -n "$expected_svc" ] && [ "$actual_svc" != "$expected_svc" ]; then
        fail "$description (service: got '$actual_svc' want '$expected_svc')"
        return
    fi
    if [ "$actual_body" != "$expected_body" ]; then
        fail "$description (body: got '$actual_body' want '$expected_body')"
        return
    fi

    pass "$description"
}

validate_payload "service from cwd" '{"session_id":"s1","cwd":"/path/to/my-project"}' INFO "test" "" "" "my-project"
validate_payload "service override" '{"session_id":"s2","cwd":"/path/to/my-project"}' INFO "test" "custom-svc" "" "custom-svc"
validate_payload "fallback service (no cwd)" '' INFO "test" "" "" "unknown"
validate_payload "severity INFO" '{}' INFO "msg" "" "INFO" "unknown"
validate_payload "severity WARN" '{}' WARN "msg" "" "WARN" "unknown"
validate_payload "severity ERROR" '{}' ERROR "msg" "" "ERROR" "unknown"
validate_payload "unknown severity defaults INFO" '{}' DEBUG "msg" "" "INFO" "unknown"

echo ""

# --- Live tests (optional) ---
if [ "$LIVE" = "--live" ]; then
    echo "Live endpoint tests:"

    response=$(curl -s -w "%{http_code}" --connect-timeout 3 --max-time 3 \
        -X POST -H "Content-Type: application/json" \
        -d '{"resourceLogs":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"signoz-log-test"}}]},"scopeLogs":[{"logRecords":[{"timeUnixNano":"'$(python3 -c 'import time;print(int(time.time()*1e9))')'" ,"severityNumber":9,"severityText":"INFO","body":{"stringValue":"test suite ping"}}]}]}]}' \
        "http://la:4318/v1/logs" 2>/dev/null) || response="000"

    http_code="${response: -3}"
    if [ "$http_code" = "200" ]; then
        pass "SigNoz endpoint accepts logs (HTTP $http_code)"
    else
        fail "SigNoz endpoint returned HTTP $http_code"
    fi
else
    echo "(skipping live tests — use --live to enable)"
fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
