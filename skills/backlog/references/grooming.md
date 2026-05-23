# Grooming

Groom is an **advisory prompt** the agent runs against the backlog. It surfaces work that probably needs attention; nothing moves automatically — the operator decides what to act on.

## When to groom

- After merging a PR that resolved a task
- Start of a session, before `take`
- Weekly hygiene
- Whenever `doing/` feels suspicious

## The prompt

When the user asks to groom the backlog, walk each bucket below and print what you find. End with a counts-only "OK" line for everything else.

### `MERGED BUT NOT MOVED` (safe to auto-fix)

A file in `doing/` whose log has a `completed` line. The work was marked complete but the `git mv` to `done/` never ran — strict invariant violation, unambiguous.

```bash
for f in backlog/doing/*.md; do
  [[ -f "$f" ]] || continue
  grep -q '^- .*completed' "$f" && echo "MERGED BUT NOT MOVED: $f"
done
```

Suggested fix: run the `complete` recipe on that slug. Safe because the completed line is the proof. (A doing/ file whose *branch* shipped but never wrote a `completed` line will surface in `TIMED OUT` once the budget expires — same suggested action.)

### `TIMED OUT`

A file in `doing/` where `now - latest_started > timeout`. The task itself declared the budget — or inherits the `7d` skill-level default if no `timeout:` is in frontmatter.

```bash
now=$(date -u +%s)
for f in backlog/doing/*.md; do
  [[ -f "$f" ]] || continue
  timeout=$(awk '/^---$/{n++; if(n==2) exit} n==1 && /^timeout:/ {sub(/^timeout:[[:space:]]*/, ""); print; exit}' "$f")
  [[ -z "$timeout" ]] && timeout=7d  # skill-level default
  started=$(grep -E '^- [0-9TZ:-]+ (started|recovered) ' "$f" | tail -1 | awk '{print $2}')
  [[ -z "$started" ]] && continue
  # Parse timeout: 4h, 3d, 2w
  n="${timeout%[smhdw]*}"; unit="${timeout: -1}"
  case "$unit" in s) secs=$n;; m) secs=$((n*60));; h) secs=$((n*3600));; d) secs=$((n*86400));; w) secs=$((n*604800));; *) continue;; esac
  started_epoch=$(date -j -u -f "%Y-%m-%dT%H:%M:%SZ" "$started" +%s 2>/dev/null || gdate -d "$started" +%s 2>/dev/null || true)
  [[ -z "$started_epoch" ]] && continue
  [[ $((now - started_epoch)) -gt $secs ]] && echo "TIMED OUT: $f (claimed $started, budget $timeout)"
done
```

Groom may auto-release entries in this bucket — the timeout was author-authorized (or the documented default), so enforcing it is contract-keeping.

Suggested action: `release` with a `timeout: ...` reason. See `references/parallel-agents.md` for the take-prelude vs janitor patterns.

### `UNRESOLVABLE DEPS`

A file in `todo/` or `doing/` referencing a `dependencies:` slug that doesn't exist anywhere in the tree. Usually a typo or rename.

```bash
for f in backlog/todo/*.md backlog/doing/*.md; do
  [[ -f "$f" ]] || continue
  # Extract dep slugs from block-form dependencies:
  deps=$(awk '/^---$/{n++; if(n==2) exit} n==1 && /^dependencies:[[:space:]]*$/ {block=1; next} block && /^[[:space:]]/ {sub(/^[[:space:]]+/, ""); sub(/:.*/, ""); print} block && !/^[[:space:]]/ {block=0}' "$f")
  for d in $deps; do
    if ! find backlog -name "${d}.md" -type f | grep -q .; then
      echo "UNRESOLVABLE DEPS: $f → $d"
    fi
  done
done
```

Suggested fix: edit the file and either fix the slug or remove the dep.

### `CYCLES`

The dependency graph (across `todo/` and `doing/`) has a cycle. Auto-pick refuses to schedule anything in a cycle.

Sketch: for each file in `todo/` + `doing/`, treat its `dependencies:` map as outgoing edges to those slugs. Run DFS from each unvisited node, marking nodes *in-stack* on entry and *done* on exit; an edge to an *in-stack* node is a back-edge — report it as `a → b → c → a`.

For ≤20 active tasks the agent does this in head. For larger graphs, write the edges to scratch and walk explicitly.

### `OK`

Everything else. Print counts only:

```bash
todo=$(find backlog/todo -name '*.md' -type f | wc -l | tr -d ' ')
doing=$(find backlog/doing -name '*.md' -type f | wc -l | tr -d ' ')
echo "OK: $todo in todo/, $doing in doing/ (after subtracting items surfaced above)"
```

## Operator Loop

Run the prompt; act on each bucket via its suggested action above. Groom itself never moves files (one exception: it may release author-authorized TIMED OUT entries — see `references/parallel-agents.md`).
