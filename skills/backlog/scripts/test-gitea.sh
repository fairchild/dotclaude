#!/usr/bin/env bash
# Offline behavioral tests for the gitea backend. A mock `tea` (embedded below,
# in Python) simulates the subset of Gitea's REST API that backlog-gitea.sh
# drives via `tea api`, backed by a JSON state file. No network, no real Gitea.
#
# Kept separate from test.sh on purpose — gitea tests needn't run when only
# maildir code changed, same as the github-issues/jira backends. Coverage: the
# full verb cycle, branch-based claim conflict, fail/retry, rescue's timeout
# refusal, and the pagination loop (the one bug a naive mock wouldn't catch —
# a server whose page cap is below the requested limit).
#
# What it does NOT cover: real Gitea response shapes (label color format,
# label-by-id semantics, timezone serialization) and `tea api` auth resolution.
# Those need a live-instance smoke — see references/backends/gitea.md.
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BL="$script_dir/backlog.sh"

command -v python3 >/dev/null 2>&1 || { echo "python3 required for the gitea mock" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq required by the gitea backend" >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bin"
export MOCK_TEA_STATE="$WORK/state.json"
export PATH="$WORK/bin:$PATH"

# --- embedded mock `tea` (only `tea api` is implemented) --------------------
cat > "$WORK/bin/tea" <<'PYEOF'
#!/usr/bin/env python3
import json, os, re, sys, urllib.parse
STATE = os.environ["MOCK_TEA_STATE"]
def load():
    if not os.path.exists(STATE):
        return {"labels": [], "next_label": 1, "issues": [], "next_issue": 1, "clock": 0}
    with open(STATE) as f: return json.load(f)
def save(s):
    with open(STATE, "w") as f: json.dump(s, f)
def tick(s):
    s["clock"] += 1
    return "2026-06-07T00:%02d:%02dZ" % (s["clock"] // 60, s["clock"] % 60)
def out(obj, code=0):
    if obj is not None: sys.stdout.write(json.dumps(obj))
    sys.exit(code)
def err(msg, code=1):
    sys.stderr.write(msg + "\n"); sys.exit(code)
def parse_api(argv):
    method, endpoint, data = "GET", None, None
    skip = {"-l","--login","-R","--remote","-r","--repo","-H","--header","-o","--output"}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ("-X","--method"): i+=1; method=argv[i]
        elif a in ("-d","--data"): i+=1; data=argv[i]
        elif a in skip: i+=1
        elif a in ("-i","--include"): pass
        elif a.startswith("/") or a.startswith("http"): endpoint=a
        i += 1
    return method, endpoint, data
def page_slice(items, qs):
    limit = int(qs.get("limit", ["30"])[0])
    cap = int(os.environ.get("MOCK_PAGE_CAP", "0"))   # simulate MAX_RESPONSE_ITEMS < limit
    if cap: limit = min(limit, cap)
    page = int(qs.get("page", ["1"])[0])
    start = (page - 1) * limit
    return items[start:start + limit]
def find_issue(s, n):
    for it in s["issues"]:
        if it["number"] == int(n): return it
    return None
def main():
    if not sys.argv[1:] or sys.argv[1] != "api":
        err("mock tea: only `api` implemented (got: %s)" % " ".join(sys.argv[1:]))
    method, ep, data = parse_api(sys.argv[2:])
    if ep is None: err("mock tea: no endpoint")
    body = json.loads(data) if data else None
    path, _, query = ep.partition("?")
    qs = urllib.parse.parse_qs(query)
    s = load()
    m = re.match(r"^/repos/[^/]+/[^/]+(?P<rest>/.*)?$", path)
    if not m: err("mock tea: unrecognized path %s" % path, 1)
    rest = m.group("rest") or ""
    if rest == "" and method == "GET":
        out({"full_name": "mock/repo"})
    if rest == "/labels":
        if method == "GET": out(page_slice(s["labels"], qs))
        if method == "POST":
            lab = {"id": s["next_label"], "name": body["name"],
                   "color": body.get("color",""), "description": body.get("description","")}
            s["next_label"] += 1; s["labels"].append(lab); save(s); out(lab)
    if rest == "/issues":
        if method == "GET":
            st = qs.get("state", ["open"])[0]
            items = [i for i in s["issues"] if st == "all" or i["state"] == st]
            out(page_slice(items, qs))
        if method == "POST":
            n = s["next_issue"]; s["next_issue"] += 1
            issue = {"number": n, "title": body["title"], "body": body.get("body",""),
                     "state": "open", "labels": [], "comments": [],
                     "html_url": "http://mock/issues/%d" % n, "updated_at": tick(s)}
            s["issues"].append(issue); save(s)
            out({k: issue[k] for k in ("number","title","body","state","html_url")})
    mi = re.match(r"^/issues/(?P<n>\d+)(?P<sub>/.*)?$", rest)
    if mi:
        n = mi.group("n"); sub = mi.group("sub") or ""
        issue = find_issue(s, n)
        if issue is None: err("mock tea: 404 no issue %s" % n, 1)
        if sub == "" and method == "GET": out(issue)
        if sub == "" and method == "PATCH":
            if "state" in body: issue["state"] = body["state"]; issue["updated_at"] = tick(s)
            save(s); out(issue)
        if sub == "/comments":
            if method == "GET": out(page_slice(issue["comments"], qs))
            if method == "POST":
                c = {"id": s["clock"]+1, "body": body["body"], "created_at": tick(s)}
                issue["comments"].append(c); save(s); out(c)
        if sub == "/labels" and method == "POST":
            for lid in body["labels"]:
                lab = next((l for l in s["labels"] if l["id"] == lid), None)
                if lab and not any(x["id"] == lid for x in issue["labels"]):
                    issue["labels"].append({"id": lab["id"], "name": lab["name"]})
            save(s); out(issue["labels"])
        ml = re.match(r"^/labels/(?P<id>\d+)$", sub)
        if ml and method == "DELETE":
            lid = int(ml.group("id"))
            issue["labels"] = [x for x in issue["labels"] if x["id"] != lid]
            save(s); out(None)
    err("mock tea: unhandled %s %s" % (method, ep), 1)
if __name__ == "__main__": main()
PYEOF
chmod +x "$WORK/bin/tea"

# advance->done best-effort `gh pr view` — stub to keep it offline/deterministic
printf '#!/usr/bin/env bash\nexit 1\n' > "$WORK/bin/gh"
chmod +x "$WORK/bin/gh"

# state query helper: evaluate a python expr with `issues`/`s` in scope
q() { python3 - "$@" <<'PY'
import json, os, sys
s = json.load(open(os.environ["MOCK_TEA_STATE"]))
issues = s["issues"]
def issue(n): return [x for x in issues if x["number"] == n][0]
print(eval(sys.argv[1]))
PY
}

pass=0; fail=0
ck() { if eval "$2"; then echo "  PASS: $1"; pass=$((pass+1)); else echo "  FAIL: $1"; fail=$((fail+1)); fi; }

new_repo() {
  rm -rf "$WORK/repo" "$MOCK_TEA_STATE"
  mkdir -p "$WORK/repo"; cd "$WORK/repo"
  git init -q; git config user.email t@t.t; git config user.name t
  git remote add gitea http://mock:3000/acme/widgets.git
  git checkout -q -b main 2>/dev/null || true
}

echo "=== setup ==="
new_repo
"$BL" setup --backend=gitea >/dev/null 2>&1
ck "AGENTS.md written"           '[[ -f backlog/AGENTS.md ]]'
ck "backend is gitea"            'grep -q "gitea" backlog/AGENTS.md'
ck "## Gitea names the remote"   'grep -qE "^remote: gitea" backlog/AGENTS.md'
ck "no host leaked into AGENTS"  '! grep -qE "mock:3000|http://mock" backlog/AGENTS.md'
ck "doing + failed labels made"  '[[ "$(q "len(s[\"labels\"])")" == 2 ]]'

echo "=== add / status ==="
url1=$("$BL" add "first-task" 2>/dev/null)
"$BL" add "second-task" >/dev/null 2>&1
ck "add returns html_url"        '[[ "$url1" == http://mock/issues/1 ]]'
ck "two open issues exist"       '[[ "$(q "len(issues)")" == 2 ]]'
s=$("$BL" status 2>/dev/null)
ck "status todo:2"               'grep -q "^todo: 2" <<<"$s"'
ck "status doing:0"              'grep -q "^doing: 0" <<<"$s"'

echo "=== take / progress / advance->done ==="
"$BL" take 1 >/dev/null 2>&1
ck "take added doing label"      '[[ "$(q "any(l[\"name\"]==\"doing\" for l in issue(1)[\"labels\"])")" == True ]]'
ck "take posted claim comment"   '[[ "$(q "any(\"advanced to=doing\" in c[\"body\"] for c in issue(1)[\"comments\"])")" == True ]]'
"$BL" progress "wip note" >/dev/null 2>&1
ck "progress comment on claim"   '[[ "$(q "any(\"progress | wip note\" in c[\"body\"] for c in issue(1)[\"comments\"])")" == True ]]'
"$BL" advance 1 >/dev/null 2>&1
ck "#1 closed after done"        '[[ "$(q "issue(1)[\"state\"]")" == closed ]]'
ck "#1 doing label removed"      '[[ "$(q "len(issue(1)[\"labels\"])")" == 0 ]]'
ck "advance->done logged"        '[[ "$(q "any(\"advanced to=done\" in c[\"body\"] for c in issue(1)[\"comments\"])")" == True ]]'
s=$("$BL" status 2>/dev/null)
ck "status done:1"               'grep -q "^done: 1" <<<"$s"'
ck "status todo:1"               'grep -q "^todo: 1" <<<"$s"'

echo "=== claim conflict (branch is the identity) ==="
git checkout -q -b feat-a
"$BL" take 2 >/dev/null 2>&1
ck "feat-a claimed #2"           '[[ "$(q "any(\"branch=feat-a\" in c[\"body\"] for c in issue(2)[\"comments\"])")" == True ]]'
git checkout -q -b feat-b
conflict_out=$("$BL" take 2 2>&1); conflict_rc=$?
ck "feat-b take exits nonzero"   '[[ $conflict_rc -ne 0 ]]'
ck "conflict names winner"       'grep -q "won by branch=feat-a" <<<"$conflict_out"'

echo "=== fail / retry ==="
"$BL" fail 2 "blocked upstream" >/dev/null 2>&1
ck "#2 closed + failed label"    '[[ "$(q "issue(2)[\"state\"]==\"closed\" and any(l[\"name\"]==\"failed\" for l in issue(2)[\"labels\"])")" == True ]]'
ck "status failed:1"             'grep -q "^failed: 1" <<<"$("$BL" status 2>/dev/null)"'
"$BL" retry 2 "unblocked" >/dev/null 2>&1
ck "#2 reopened, failed cleared" '[[ "$(q "issue(2)[\"state\"]==\"open\" and len(issue(2)[\"labels\"])==0")" == True ]]'
ck "retried logged"              '[[ "$(q "any(\"retried | unblocked\" in c[\"body\"] for c in issue(2)[\"comments\"])")" == True ]]'

echo "=== rescue refuses a fresh claim ==="
"$BL" take 2 >/dev/null 2>&1
rescue_out=$("$BL" rescue 2 2>&1); rescue_rc=$?
ck "rescue refuses active claim" '[[ $rescue_rc -ne 0 ]] && grep -q "claim still active" <<<"$rescue_out"'

echo "=== pagination (server page cap below requested limit) ==="
new_repo
MOCK_PAGE_CAP=20 "$BL" setup --backend=gitea >/dev/null 2>&1
for i in $(seq 1 25); do MOCK_PAGE_CAP=20 "$BL" add "task-$i" >/dev/null 2>&1; done
s=$(MOCK_PAGE_CAP=20 "$BL" status 2>/dev/null)
ck "status counts all 25 (page 2 not dropped)" 'grep -q "^todo: 25" <<<"$s"'
MOCK_PAGE_CAP=20 "$BL" take 23 >/dev/null 2>&1   # a second-page issue
ck "take claims a second-page issue"            '[[ "$(q "any(l[\"name\"]==\"doing\" for l in issue(23)[\"labels\"])")" == True ]]'

echo
echo "=== summary ==="
echo "passed: $pass"
echo "failed: $fail"
[[ $fail -eq 0 ]]
