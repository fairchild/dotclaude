# Worker Operations

Verb recipes for working tasks in the maildir-style backlog. `../SKILL.md` covers adding tasks; this doc is everything else. Pipeline declaration (how `advance` knows where to go): `pipeline.md`. Patterns and rationale (mental model, cleanup patterns, worker process sketch): `parallel-agents.md`.

## Rules

- **No backward verb.** A task that can't proceed gets `fail`ed (with reason) and may later be `retry`ed back to `todo/`. There is no "release" — pretending the work wasn't tried muddies the log.
- **Frontmatter and description above the divider are frozen after first commit** (one exception: `retry` may edit them, since retry IS a correction).
- **Commit after each log line.** That's what keeps `cat` and `git log` synchronized.
- **Single writer per claim.** The first `advance` (todo/ → doing/) is the lock; subsequent advances are by the same claimer.
- **Commit before the first advance.** Uncommitted files can't be `git mv`'d, and other agents can't see them.
- **Timeout is author-set, never claimer-extended.** Default `7d` if not declared. If the budget is wrong, `fail` with a reason — someone can `retry`.
- **Dependencies are parallel.** Task is takeable when every dep slug resolves under `done/`.

## Log line format

```
- {ISO ts} {kind} key=value ... [| free prose]
```

Kinds: `advanced`, `progress`, `cancelled`, `failed`, `rescued`, `retried`.

KV fields grep cleanly (`grep 'branch=feat/foo'`), free prose follows `|`, and long-form detail belongs in the commit body — the bullet is the index, git is the archive (`git show <sha>` retrieves the long form).

The `advanced` line carries `to=<dir>` always. On entry to the in-flight phase (from `todo/`), it also carries `claimer=<id>` and `branch=<name>` — those are the claim. Subsequent advances within the same claim omit them; the latest `advanced to=<in-flight>` or `rescued` line is the claim of record.

## Verbs

### advance

The one forward verb. Moves a task one step along the pipeline declared in `backlog/AGENTS.md` (default `todo → doing → done`; see `pipeline.md`).

Three phases of advance behave the same way mechanically — only the log line differs:

- **Entry** (todo/ → doing/): this is the claim. Stamp `claimer=` and `branch=`.
- **Intermediate hop** (e.g. doing/ → reviewing/): same claimer continues; no need to re-stamp.
- **Completion** (last in-flight → done/): the work shipped; PR URL goes in the optional `| PR=...` prose.

```bash
slug=backlog-maildir-plan
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Find current dir
src=$(find backlog -mindepth 2 -maxdepth 2 -name "${slug}.md" -type f | head -1)
[[ -z "$src" ]] && { echo "no such task: $slug" >&2; exit 1; }
curr=$(basename "$(dirname "$src")")

# Look up next dir from the declared pipeline (or default: todo → doing → done)
next=$(awk -v curr="$curr" '
  BEGIN { defaults["todo"]="doing"; defaults["doing"]="done" }
  /^## Pipeline/ { flag=1; next }
  flag && /[a-z]/ {
    parsed = 1; n = 0
    while (match($0, /[a-z][a-z0-9-]*/)) {
      arr[n++] = substr($0, RSTART, RLENGTH)
      $0 = substr($0, RSTART + RLENGTH)
    }
    for (i = 0; i < n; i++) if (arr[i] == curr && i+1 < n) { print arr[i+1]; exit }
    exit
  }
  END { if (!parsed && curr in defaults) print defaults[curr] }
' backlog/AGENTS.md 2>/dev/null)
[[ -z "$next" ]] && { echo "no next dir from $curr in pipeline" >&2; exit 1; }

dst="backlog/${next}/${slug}.md"
mkdir -p "backlog/${next}"
git mv "$src" "$dst"

# Resilience: ensure the body divider exists before appending
if [[ "$(grep -v '^[[:space:]]*$' "$dst" | tail -1)" != "---" ]]; then
  printf '\n---\n' >> "$dst"
fi

# Claim line only on entry from todo/
if [[ "$curr" == "todo" ]]; then
  branch=$(git rev-parse --abbrev-ref HEAD)
  claimer=${CONDUCTOR_WORKSPACE_NAME:+conductor:$CONDUCTOR_WORKSPACE_NAME}
  claimer=${claimer:-${CMUX_WORKSPACE_ID:+cmux:$CMUX_WORKSPACE_ID}}
  claimer=${claimer:-$(whoami)@$(hostname -s)}
  echo "- $ts advanced to=$next claimer=$claimer branch=$branch" >> "$dst"
  git add "$dst"
  git commit -m "advance($slug) → $next ($claimer @ $branch)"
else
  # Optional PR URL on completion
  pr_url=""
  [[ "$next" == "done" ]] && pr_url=$(gh pr view --json url -q .url 2>/dev/null || true)
  line="- $ts advanced to=$next"
  [[ -n "$pr_url" ]] && line+=" | PR=$pr_url"
  echo "$line" >> "$dst"
  git add "$dst"
  git commit -m "advance($slug) → $next${pr_url:+ PR=$pr_url}"
fi
```

**No-slug advance from todo/** (the original "take the next thing"): glob `todo/`, filter to tasks whose every dep is in `done/`, sort by `priority` (default 999) ascending then oldest mtime, advance the first.

### progress

```bash
slug=backlog-maildir-plan
note="auth prototype passing locally"
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
file=$(find backlog -mindepth 2 -maxdepth 2 -name "${slug}.md" -type f ! -path 'backlog/todo/*' ! -path 'backlog/done/*' ! -path 'backlog/failed/*' | head -1)
[[ -z "$file" ]] && { echo "$slug not in any in-flight dir" >&2; exit 1; }

echo "- $ts progress | $note" >> "$file"
git add "$file"
git commit -m "progress($slug) $note"
```

If the slug isn't known, find the in-flight file on the current branch via the latest `branch=` field:

```bash
b=$(git rev-parse --abbrev-ref HEAD)
for f in $(find backlog -mindepth 2 -maxdepth 2 -type f -name '*.md' ! -path 'backlog/todo/*' ! -path 'backlog/done/*' ! -path 'backlog/failed/*'); do
  last=$(grep -oE 'branch=[^ ]+' "$f" | tail -1 | cut -d= -f2)
  [[ "$last" == "$b" ]] && echo "$f"
done
```

`progress` does NOT reset the timeout clock — only `advanced` and `rescued` do. Progress notes are free; they're for incremental detail, not phase markers.

### cancel

Abandon (any in-flight → `done/`). Requires a reason. The `cancelled` log line discriminates from a normal advance-to-done.

```bash
slug=this-isnt-going-to-happen-plan
reason="superseded by the X redesign"
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
src=$(find backlog -mindepth 2 -maxdepth 2 -name "${slug}.md" -type f ! -path 'backlog/done/*' ! -path 'backlog/failed/*' | head -1)
[[ -z "$src" ]] && { echo "no such in-flight task: $slug" >&2; exit 1; }

git mv "$src" "backlog/done/${slug}.md"
echo "- $ts cancelled | $reason" >> "backlog/done/${slug}.md"
git add "backlog/done/${slug}.md"
git commit -m "cancel($slug) $reason"
```

### fail

Dead-letter: move any in-flight task to `backlog/failed/` with a reason. Use for anything that didn't complete: ran out of budget, blocked on external thing, agent decided it's out of scope, etc. The reason is the log line; operators may `retry` later.

```bash
slug=stuck-thing-plan
reason="blocked on legal review"
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
src=$(find backlog -mindepth 2 -maxdepth 2 -name "${slug}.md" -type f ! -path 'backlog/done/*' ! -path 'backlog/failed/*' | head -1)
[[ -z "$src" ]] && { echo "no such in-flight task: $slug" >&2; exit 1; }

mkdir -p backlog/failed
git mv "$src" "backlog/failed/${slug}.md"
echo "- $ts failed | $reason" >> "backlog/failed/${slug}.md"
git add "backlog/failed/${slug}.md"
git commit -m "fail($slug) $reason"
```

### rescue

Pick up an in-flight task whose claim has gone stale (timeout exceeded). In-place — no `git mv`. The staleness check refuses if the existing claim is still active, preventing accidental claim-stealing.

```bash
slug=backlog-maildir-plan
branch=$(git rev-parse --abbrev-ref HEAD)
claimer=${CONDUCTOR_WORKSPACE_NAME:+conductor:$CONDUCTOR_WORKSPACE_NAME}
claimer=${claimer:-${CMUX_WORKSPACE_ID:+cmux:$CMUX_WORKSPACE_ID}}
claimer=${claimer:-$(whoami)@$(hostname -s)}
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
file=$(find backlog -mindepth 2 -maxdepth 2 -name "${slug}.md" -type f ! -path 'backlog/todo/*' ! -path 'backlog/done/*' ! -path 'backlog/failed/*' | head -1)
[[ -z "$file" ]] && { echo "$slug not in any in-flight dir" >&2; exit 1; }

# Staleness check: refuse if the prior claim hasn't exceeded its budget
timeout=$(awk '/^---$/{n++; if(n==2) exit} n==1 && /^timeout:/ {sub(/^timeout:[[:space:]]*/, ""); print; exit}' "$file")
[[ -z "$timeout" ]] && timeout=7d
last=$(grep -E '^- [0-9TZ:-]+ (advanced|rescued) ' "$file" | tail -1 | awk '{print $2}')
[[ -z "$last" ]] && { echo "no prior claim line in $file" >&2; exit 1; }
n="${timeout%[smhdw]*}"; unit="${timeout: -1}"
case "$unit" in s) secs=$n;; m) secs=$((n*60));; h) secs=$((n*3600));; d) secs=$((n*86400));; w) secs=$((n*604800));; *) secs=604800;; esac
ep=$(date -j -u -f "%Y-%m-%dT%H:%M:%SZ" "$last" +%s 2>/dev/null || gdate -d "$last" +%s 2>/dev/null || true)
[[ -z "$ep" ]] && { echo "unparseable timestamp: $last" >&2; exit 1; }
(( $(date -u +%s) - ep > secs )) || { echo "claim still active (under $timeout); refusing rescue" >&2; exit 1; }

echo "- $ts rescued claimer=$claimer branch=$branch" >> "$file"
git add "$file"
git commit -m "rescue($slug) $claimer @ $branch"
```

After rescuing, read the file's full log and skip activities prior progress notes already completed. See `parallel-agents.md` for the activity-skipping pattern and the advance-prelude variant that bundles rescue with detection.

### retry

`failed/X.md` → `todo/X.md`. Requires a reason. **Does not work on `done/` tasks** — done is terminal; revisits go in a new task that references the old slug.

**Retry is the one place spec edits are permitted.** Retrying signals "this needs fixing to succeed" — often the spec itself was wrong (priority, timeout, dependencies, or the description's plan). Edit the file between the log append and the commit if a fix is required; the retry log line captures the why, the git diff captures the what. The log below the divider stays append-only as always.

```bash
slug=once-was-failed-plan
reason="external blocker resolved; raising timeout to 2w"
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
src="backlog/failed/${slug}.md"
[[ -f "$src" ]] || { echo "not in failed/: $slug" >&2; exit 1; }

git mv "$src" "backlog/todo/${slug}.md"
echo "- $ts retried | $reason" >> "backlog/todo/${slug}.md"

# Optional: edit "backlog/todo/${slug}.md" here to correct the spec —
# adjust timeout, add a missing dep, refine the description's approach.
# Only the spec (frontmatter + description above the divider) may change.

git add "backlog/todo/${slug}.md"
git commit -m "retry($slug) $reason"
```

A retried task whose dependencies have since moved (e.g., a dep is now in `failed/`) won't be takeable until the dep chain is healthy again. Auto-pick will quietly skip it; retry the deps first if you need them resolved.

### status

```bash
for pile in todo doing done failed; do
  printf "%s: %d\n" "$pile" "$(find backlog/$pile -name '*.md' -type f 2>/dev/null | wc -l | tr -d ' ')"
done
# Any intermediate in-flight dirs (not in the fixed set above)
for d in $(find backlog -mindepth 1 -maxdepth 1 -type d ! -name todo ! -name doing ! -name done ! -name failed); do
  printf "%s: %d\n" "$(basename "$d")" "$(find "$d" -name '*.md' -type f | wc -l | tr -d ' ')"
done
ls -lt backlog/doing/*.md 2>/dev/null | head -5
```

### groom

Advisory walk; never moves files (one exception: it may fail author-authorized TIMED OUT entries — see `parallel-agents.md`). Buckets and per-bucket checks: `maintain.md`.
