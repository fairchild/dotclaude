# Worker Operations

Verb recipes for working tasks in the maildir-style backlog. `../SKILL.md` covers adding tasks; this doc is everything else. Design patterns and rationale (mental model, cleanup patterns, worker process sketch): `parallel-agents.md`.

## Rules

- **Frontmatter and description above the divider are frozen after first commit** (one exception: `reopen` may edit them, since reopen IS a correction).
- **Commit after each log line.** That's what keeps `cat` and `git log` synchronized.
- **Single writer per claim.** The `git mv` is the lock; bullets are documentation.
- **Commit before claiming.** Uncommitted files can't be `git mv`'d, and other agents can't see them.
- **Timeout is author-set, never claimer-extended.** Default `7d` if not declared. If the budget is wrong, release with a reason.
- **Dependencies are parallel.** Task is takeable when every dep slug resolves under `done/`.

## Log line format

```
- {ISO ts} {kind} key=value ... [| free prose]
```

Kinds: `started`, `recovered`, `progress`, `completed`, `released`, `cancelled`, `failed`, `reopened`.

KV fields grep cleanly (`grep 'branch=feat/foo'`), free prose follows `|`, and long-form detail belongs in the commit body — the bullet is the index, git is the archive (`git show <sha>` retrieves the long form).

## Verbs

### take

Optional preamble: release any timed-out tasks first, so the failure-recovery and the take are one operation. Skip if a separate janitor is running on a schedule. See `parallel-agents.md` for the full pattern.

```bash
slug=backlog-maildir-plan
branch=$(git rev-parse --abbrev-ref HEAD)
claimer=${CONDUCTOR_WORKSPACE_NAME:+conductor:$CONDUCTOR_WORKSPACE_NAME}
claimer=${claimer:-${CMUX_WORKSPACE_ID:+cmux:$CMUX_WORKSPACE_ID}}
claimer=${claimer:-$(whoami)@$(hostname -s)}
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
file="backlog/doing/${slug}.md"

git mv "backlog/todo/${slug}.md" "$file"

# Resilience: ensure the body divider exists before appending. A task added
# via SKILL.md will already have it, but a hand-edited or imported task
# might not. Who writes the divider doesn't matter — it just needs to be
# present before the log starts.
if [[ "$(grep -v '^[[:space:]]*$' "$file" | tail -1)" != "---" ]]; then
  printf '\n---\n' >> "$file"
fi

echo "- $ts started claimer=$claimer branch=$branch" >> "$file"
git add "$file"
git commit -m "take($slug) $claimer @ $branch"
```

**No-slug take:** glob `todo/`, filter to tasks whose every dep is in `done/`, sort by `priority` (default 999) ascending then oldest mtime, take the first. Agent does this with Glob+Read.

### recover

Pick up a `doing/` task whose claim has gone stale (timeout exceeded). In-place — no `git mv` — so kanban flow stays right-to-left. Inlined staleness check refuses if the existing claim is still active, preventing accidental claim-stealing.

```bash
slug=backlog-maildir-plan
branch=$(git rev-parse --abbrev-ref HEAD)
claimer=${CONDUCTOR_WORKSPACE_NAME:+conductor:$CONDUCTOR_WORKSPACE_NAME}
claimer=${claimer:-${CMUX_WORKSPACE_ID:+cmux:$CMUX_WORKSPACE_ID}}
claimer=${claimer:-$(whoami)@$(hostname -s)}
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
file="backlog/doing/${slug}.md"
[[ -f "$file" ]] || { echo "not in doing/: $slug" >&2; exit 1; }

# Staleness check: refuse if the prior claim hasn't exceeded its budget
timeout=$(awk '/^---$/{n++; if(n==2) exit} n==1 && /^timeout:/ {sub(/^timeout:[[:space:]]*/, ""); print; exit}' "$file")
[[ -z "$timeout" ]] && timeout=7d
started=$(grep -E '^- [0-9TZ:-]+ (started|recovered) ' "$file" | tail -1 | awk '{print $2}')
[[ -z "$started" ]] && { echo "no prior claim line in $file" >&2; exit 1; }
n="${timeout%[smhdw]*}"; unit="${timeout: -1}"
case "$unit" in s) secs=$n;; m) secs=$((n*60));; h) secs=$((n*3600));; d) secs=$((n*86400));; w) secs=$((n*604800));; *) secs=604800;; esac
ep=$(date -j -u -f "%Y-%m-%dT%H:%M:%SZ" "$started" +%s 2>/dev/null || gdate -d "$started" +%s 2>/dev/null || true)
[[ -z "$ep" ]] && { echo "unparseable timestamp: $started" >&2; exit 1; }
(( $(date -u +%s) - ep > secs )) || { echo "claim still active (under $timeout); refusing recover" >&2; exit 1; }

echo "- $ts recovered claimer=$claimer branch=$branch" >> "$file"
git add "$file"
git commit -m "recover($slug) $claimer @ $branch"
```

After recovering, read the file's full log and skip activities prior progress notes already completed. See `parallel-agents.md` for the activity-skipping pattern and the take-prelude variant that bundles recover with detection.

### progress

```bash
slug=backlog-maildir-plan
note="auth prototype passing locally"
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "- $ts progress | $note" >> "backlog/doing/${slug}.md"
git add "backlog/doing/${slug}.md"
git commit -m "progress($slug) $note"
```

If the slug isn't known, find the doing/ file on the current branch via the latest `branch=` field:

```bash
b=$(git rev-parse --abbrev-ref HEAD)
for f in backlog/doing/*.md; do
  last=$(grep -oE 'branch=[^ ]+' "$f" | tail -1 | cut -d= -f2)
  [[ "$last" == "$b" ]] && echo "$f"
done
```

### complete

```bash
slug=backlog-maildir-plan
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
pr_url=$(gh pr view --json url -q .url 2>/dev/null || true)

git mv "backlog/doing/${slug}.md" "backlog/done/${slug}.md"
echo "- $ts completed${pr_url:+ PR=$pr_url}" >> "backlog/done/${slug}.md"
git add "backlog/done/${slug}.md"
git commit -m "complete($slug)${pr_url:+ PR=$pr_url}"
```

### release

Give a claimed task back to `todo/`. Requires a reason.

```bash
slug=backlog-maildir-plan
reason="blocked on legal review"
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

git mv "backlog/doing/${slug}.md" "backlog/todo/${slug}.md"
echo "- $ts released | $reason" >> "backlog/todo/${slug}.md"
git add "backlog/todo/${slug}.md"
git commit -m "release($slug) $reason"
```

### cancel

Abandon (todo or doing → `done/`). Requires a reason. The `cancelled` log line discriminates from completion.

```bash
slug=this-isnt-going-to-happen-plan
reason="superseded by the X redesign"
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
src=$(find backlog/todo backlog/doing -name "${slug}.md" -type f | head -1)

git mv "$src" "backlog/done/${slug}.md"
echo "- $ts cancelled | $reason" >> "backlog/done/${slug}.md"
git add "backlog/done/${slug}.md"
git commit -m "cancel($slug) $reason"
```

### fail

Dead-letter: move a task to `backlog/failed/` when retries are exhausted or recovery is hopeless. Requires a reason. Operators investigate `failed/` and decide whether to `reopen` (move back to todo/) or `cancel` (mark terminal in done/).

```bash
slug=stuck-thing-plan
reason="exhausted 3 retries after timeouts"
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
src=$(find backlog/todo backlog/doing -name "${slug}.md" -type f | head -1)
[[ -z "$src" ]] && { echo "no such task: $slug" >&2; exit 1; }

mkdir -p backlog/failed
git mv "$src" "backlog/failed/${slug}.md"
echo "- $ts failed | $reason" >> "backlog/failed/${slug}.md"
git add "backlog/failed/${slug}.md"
git commit -m "fail($slug) $reason"
```

### reopen

`done/X.md` or `failed/X.md` → `todo/X.md`. Requires a reason.

**Reopen is the one place spec edits are permitted.** Reopening signals "this needs fixing to succeed" — often the spec itself was wrong (priority, timeout, dependencies, or the description's plan). Edit the file between the log append and the commit if a fix is required; the reopen log line captures the why, the git diff captures the what. The log below the divider stays append-only as always.

```bash
slug=once-was-finished-plan
reason="edge case Y discovered; raising timeout to 2w"
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
src=$(find backlog/done backlog/failed -name "${slug}.md" -type f | head -1)
[[ -z "$src" ]] && { echo "not in done/ or failed/: $slug" >&2; exit 1; }

git mv "$src" "backlog/todo/${slug}.md"
echo "- $ts reopened | $reason" >> "backlog/todo/${slug}.md"

# Optional: edit "backlog/todo/${slug}.md" here to correct the spec —
# adjust timeout, add a missing dep, refine the description's approach.
# Only the spec (frontmatter + description above the divider) may change.

git add "backlog/todo/${slug}.md"
git commit -m "reopen($slug) $reason"
```

A reopened task whose dependencies have since moved (e.g., a dep is now in `failed/`) won't be takeable until the dep chain is healthy again. Auto-pick will quietly skip it; reopen the deps first if you need them resolved.

### status

```bash
for pile in todo doing done failed; do
  printf "%s: %d\n" "$pile" "$(find backlog/$pile -name '*.md' -type f 2>/dev/null | wc -l | tr -d ' ')"
done
ls -lt backlog/doing/*.md 2>/dev/null | head -5
```

### groom

Advisory walk; never moves files (one exception: it may release author-authorized TIMED OUT entries — see `parallel-agents.md`). Buckets and per-bucket checks: `grooming.md`.
