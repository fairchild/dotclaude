# Backend: maildir-shared

Storage mechanism for projects whose `backlog/AGENTS.md` declares `## Backend: maildir-shared`. Built for multi-worktree work — Conductor, parallel `git worktree`, anywhere two agents might claim the same task on different branches and not collide until merge.

For verb semantics, rules, and the worker loop, see `../worker.md`. The canonical implementation lives in `../../scripts/backlog-maildir-shared.sh` (invoke via `../../scripts/backlog.sh <verb>`). The recipes below document the mechanism — agents should prefer the script, which handles symlink self-healing, the O_EXCL atomic claim, and the per-shell noclobber differences in one tested place.

## When to pick this backend

- Multi-worktree project where agents work in parallel on different branches.
- Cross-worktree race ("two workers claim the same task on separate branches") would cost meaningful wasted work.
- You want `ls backlog/doing/` to mean *across all worktrees of this clone*, not just *on this branch*.

If you're a one-worktree-at-a-time project, `maildir-git` is simpler.

## Mental model

Git tracks *history truth* — the queue (`todo/`), completed work (`done/`), dead-letters (`failed/`). Those stay in the worktree, committed.

The git-common-dir tracks *coordination truth* — which tasks are actively claimed right now. In-flight dirs (`doing/`, `reviewing/`, etc.) live at `$(git rev-parse --git-common-dir)/backlog/`, shared across every worktree of the clone. The shared dir IS the lock register: a file exists there iff someone has claimed the task.

The worktree restores `ls backlog/doing/` inspectability via a symlink from `backlog/doing` to the shared dir. The symlink is gitignored, auto-created on demand, and resolves to the same shared location from every worktree.

## Layout

**Per worktree (git-tracked):**
```
backlog/
  todo/        committed
  done/        committed
  failed/      committed
  doing/       → symlink to $(common-dir)/backlog/doing/   (gitignored)
  reviewing/   → symlink to $(common-dir)/backlog/reviewing/   (gitignored; only if pipeline declares)
  AGENTS.md    committed; contains `## Backend: maildir-shared`
  CLAUDE.md    symlink to AGENTS.md
  ROADMAP.md   committed
```

**Shared (git-common-dir, not in any tree):**
```
$(common-dir)/backlog/
  doing/       in-flight files — the cross-worktree authoritative set
  reviewing/   (only if pipeline declares it)
```

**`.gitignore` at repo root** must exclude the symlinks:
```
backlog/doing
backlog/reviewing
```

(One line per in-flight dir name from the project's pipeline.)

## Symlink prelude

Every recipe begins with this idempotent helper. New worktrees self-heal — first verb invocation creates the symlinks if missing.

```bash
backlog_ensure_symlinks() {
  local common_dir; common_dir=$(git rev-parse --git-common-dir 2>/dev/null) || return 1
  local shared_root="${common_dir}/backlog"
  mkdir -p "${shared_root}"

  # In-flight dir names: pipeline minus todo/done, plus default doing if no pipeline
  local in_flight; in_flight=$(awk '
    /^## Pipeline/ { flag=1; next }
    flag && /[a-z]/ {
      parsed=1
      while (match($0, /[a-z][a-z0-9-]*/)) {
        d = substr($0, RSTART, RLENGTH)
        if (d != "todo" && d != "done") print d
        $0 = substr($0, RSTART + RLENGTH)
      }
      exit
    }
    END { if (!parsed) print "doing" }
  ' backlog/AGENTS.md 2>/dev/null)

  for d in $in_flight; do
    local shared="${shared_root}/${d}"
    local link="backlog/${d}"
    mkdir -p "$shared"
    if [[ ! -L "$link" ]]; then
      rm -rf "$link" 2>/dev/null
      ln -s "$shared" "$link"
    fi
  done
}
```

## Recipes

Each verb assumes `backlog_ensure_symlinks` has run. The worker dispatcher should call it once per session.

### advance

Three phases. Entry (todo → first in-flight) is the cross-worktree atomic claim. Intermediate hops (in-flight → in-flight) and completion (last in-flight → done) move the file in/out of shared.

```bash
slug=backlog-maildir-shared-plan
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
shared_root="$(git rev-parse --git-common-dir)/backlog"
backlog_ensure_symlinks

# Locate current dir. Look in worktree (todo/done/failed) and shared (in-flight).
src=""; curr=""
if [[ -f "backlog/todo/${slug}.md" ]]; then
  src="backlog/todo/${slug}.md"; curr="todo"
else
  for d in "${shared_root}"/*/; do
    if [[ -f "${d}${slug}.md" ]]; then
      src="${d}${slug}.md"
      curr="$(basename "${d%/}")"
      break
    fi
  done
fi
[[ -z "$src" ]] && { echo "no such task: $slug" >&2; exit 1; }

# Look up next dir from declared pipeline (same parser as maildir-git)
next=$(awk -v curr="$curr" '
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
' backlog/AGENTS.md 2>/dev/null)
[[ -z "$next" ]] && { echo "no next dir from $curr in pipeline" >&2; exit 1; }

# Decide destination: in-flight → shared; done/failed → worktree
if [[ "$next" == "done" || "$next" == "failed" ]]; then
  dst="backlog/${next}/${slug}.md"
  mkdir -p "backlog/${next}"
else
  dst="${shared_root}/${next}/${slug}.md"
  mkdir -p "${shared_root}/${next}"
fi

if [[ "$curr" == "todo" ]]; then
  # Entry: cross-worktree atomic claim via O_EXCL
  if ! ( set -o noclobber; cat "$src" > "$dst" ) 2>/dev/null; then
    echo "claim conflict: $slug already in flight (another worktree)" >&2
    exit 1
  fi
  git rm "$src"
  branch=$(git rev-parse --abbrev-ref HEAD)
  claimer=${CONDUCTOR_WORKSPACE_NAME:+conductor:$CONDUCTOR_WORKSPACE_NAME}
  claimer=${claimer:-${CMUX_WORKSPACE_ID:+cmux:$CMUX_WORKSPACE_ID}}
  claimer=${claimer:-$(whoami)@$(hostname -s)}
  # Resilience: ensure divider exists before appending
  if [[ "$(grep -v '^[[:space:]]*$' "$dst" | tail -1)" != "---" ]]; then
    printf '\n---\n' >> "$dst"
  fi
  echo "- $ts advanced to=$next claimer=$claimer branch=$branch" >> "$dst"
  git commit -m "advance($slug) → $next ($claimer @ $branch)"
elif [[ "$next" == "done" || "$next" == "failed" ]]; then
  # Exit: move from shared to worktree, commit
  mv "$src" "$dst"
  if [[ "$(grep -v '^[[:space:]]*$' "$dst" | tail -1)" != "---" ]]; then
    printf '\n---\n' >> "$dst"
  fi
  pr_url=""
  [[ "$next" == "done" ]] && pr_url=$(gh pr view --json url -q .url 2>/dev/null || true)
  line="- $ts advanced to=$next"
  [[ -n "$pr_url" ]] && line+=" | PR=$pr_url"
  echo "$line" >> "$dst"
  git add "$dst"
  git commit -m "advance($slug) → $next${pr_url:+ PR=$pr_url}"
else
  # Intermediate hop in shared — no commit (file isn't in any tree)
  mv "$src" "$dst"
  if [[ "$(grep -v '^[[:space:]]*$' "$dst" | tail -1)" != "---" ]]; then
    printf '\n---\n' >> "$dst"
  fi
  echo "- $ts advanced to=$next" >> "$dst"
fi
```

**No-slug advance from todo/** ("take the next thing"): glob `backlog/todo/`, subtract any slug already present in any shared in-flight dir (those are claimed), filter to tasks whose every dep is in `backlog/done/`, sort by `priority` + oldest mtime, advance the first.

```bash
# Available = todo \ shared_in_flight
shared_root="$(git rev-parse --git-common-dir)/backlog"
in_flight_slugs=$(find "$shared_root" -mindepth 2 -maxdepth 2 -name '*.md' -type f -exec basename {} .md \; 2>/dev/null | sort -u)
for f in backlog/todo/*.md; do
  [[ -f "$f" ]] || continue
  slug=$(basename "$f" .md)
  echo "$in_flight_slugs" | grep -qx "$slug" && continue   # already claimed elsewhere
  # ...priority + dep filtering as usual...
done
```

### progress

Append to the shared in-flight file. No commit — the file isn't in any worktree's git tree.

```bash
slug=backlog-maildir-shared-plan
note="O_EXCL claim path working across two simulated worktrees"
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
shared_root="$(git rev-parse --git-common-dir)/backlog"
backlog_ensure_symlinks

file=""
for d in "${shared_root}"/*/; do
  if [[ -f "${d}${slug}.md" ]]; then file="${d}${slug}.md"; break; fi
done
[[ -z "$file" ]] && { echo "$slug not in any in-flight dir" >&2; exit 1; }

echo "- $ts progress | $note" >> "$file"
```

If the slug isn't known, find the in-flight file by matching the latest `branch=` field:

```bash
b=$(git rev-parse --abbrev-ref HEAD)
shared_root="$(git rev-parse --git-common-dir)/backlog"
for f in "${shared_root}"/*/*.md; do
  [[ -f "$f" ]] || continue
  last=$(grep -oE 'branch=[^ ]+' "$f" | tail -1 | cut -d= -f2)
  [[ "$last" == "$b" ]] && echo "$f"
done
```

`progress` does NOT reset the timeout clock — only `advanced` and `rescued` do.

### cancel

Move from shared to worktree's `done/`, commit. Discriminated from advance-to-done by the `cancelled` log line.

```bash
slug=this-isnt-going-to-happen-plan
reason="superseded by the X redesign"
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
shared_root="$(git rev-parse --git-common-dir)/backlog"
backlog_ensure_symlinks

src=""
for d in "${shared_root}"/*/; do
  if [[ -f "${d}${slug}.md" ]]; then src="${d}${slug}.md"; break; fi
done
[[ -z "$src" ]] && { echo "no such in-flight task: $slug" >&2; exit 1; }

dst="backlog/done/${slug}.md"
mkdir -p backlog/done
mv "$src" "$dst"
echo "- $ts cancelled | $reason" >> "$dst"
git add "$dst"
git commit -m "cancel($slug) $reason"
```

### fail

Move from shared to worktree's `failed/`, commit. Same shape as cancel; different log line and destination.

```bash
slug=stuck-thing-plan
reason="blocked on legal review"
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
shared_root="$(git rev-parse --git-common-dir)/backlog"
backlog_ensure_symlinks

src=""
for d in "${shared_root}"/*/; do
  if [[ -f "${d}${slug}.md" ]]; then src="${d}${slug}.md"; break; fi
done
[[ -z "$src" ]] && { echo "no such in-flight task: $slug" >&2; exit 1; }

mkdir -p backlog/failed
dst="backlog/failed/${slug}.md"
mv "$src" "$dst"
echo "- $ts failed | $reason" >> "$dst"
git add "$dst"
git commit -m "fail($slug) $reason"
```

### rescue

Pick up an in-flight task whose claim has gone stale (timeout exceeded). In-place — file stays in the shared dir, log gets a `rescued` line. No commit (file isn't in tree).

```bash
slug=backlog-maildir-shared-plan
shared_root="$(git rev-parse --git-common-dir)/backlog"
backlog_ensure_symlinks

file=""
for d in "${shared_root}"/*/; do
  if [[ -f "${d}${slug}.md" ]]; then file="${d}${slug}.md"; break; fi
done
[[ -z "$file" ]] && { echo "$slug not in any in-flight dir" >&2; exit 1; }

# Staleness check (identical to maildir-git)
timeout=$(awk '/^---$/{n++; if(n==2) exit} n==1 && /^timeout:/ {sub(/^timeout:[[:space:]]*/, ""); print; exit}' "$file")
[[ -z "$timeout" ]] && timeout=7d
last=$(grep -E '^- [0-9TZ:-]+ (advanced|rescued) ' "$file" | tail -1 | awk '{print $2}')
[[ -z "$last" ]] && { echo "no prior claim line in $file" >&2; exit 1; }
n="${timeout%[smhdw]*}"; unit="${timeout: -1}"
case "$unit" in s) secs=$n;; m) secs=$((n*60));; h) secs=$((n*3600));; d) secs=$((n*86400));; w) secs=$((n*604800));; *) secs=604800;; esac
ep=$(date -j -u -f "%Y-%m-%dT%H:%M:%SZ" "$last" +%s 2>/dev/null || gdate -d "$last" +%s 2>/dev/null || true)
[[ -z "$ep" ]] && { echo "unparseable timestamp: $last" >&2; exit 1; }
(( $(date -u +%s) - ep > secs )) || { echo "claim still active (under $timeout); refusing rescue" >&2; exit 1; }

ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
branch=$(git rev-parse --abbrev-ref HEAD)
claimer=${CONDUCTOR_WORKSPACE_NAME:+conductor:$CONDUCTOR_WORKSPACE_NAME}
claimer=${claimer:-${CMUX_WORKSPACE_ID:+cmux:$CMUX_WORKSPACE_ID}}
claimer=${claimer:-$(whoami)@$(hostname -s)}
echo "- $ts rescued claimer=$claimer branch=$branch" >> "$file"
```

After rescuing, read the file's full log and skip activities prior progress notes already completed. See `../parallel-agents.md` for the activity-skipping pattern.

### retry

`failed/X.md` → `todo/X.md`. Both are in the worktree; shared dir not involved. Identical to maildir-git's recipe.

```bash
slug=once-was-failed-plan
reason="external blocker resolved; raising timeout to 2w"
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
src="backlog/failed/${slug}.md"
[[ -f "$src" ]] || { echo "not in failed/: $slug" >&2; exit 1; }

git mv "$src" "backlog/todo/${slug}.md"
echo "- $ts retried | $reason" >> "backlog/todo/${slug}.md"

# Optional: edit "backlog/todo/${slug}.md" here to correct the spec.

git add "backlog/todo/${slug}.md"
git commit -m "retry($slug) $reason"
```

### status

Lists per-state counts, plus the most-recent in-flight files. The in-flight set is in the shared dir; `ls backlog/doing/` (via the symlink) gives the same view from any worktree.

```bash
backlog_ensure_symlinks

# Terminal states in worktree
for pile in todo done failed; do
  printf "%s: %d\n" "$pile" "$(find backlog/$pile -name '*.md' -type f 2>/dev/null | wc -l | tr -d ' ')"
done

# In-flight states in shared dir (resolved via symlinks for inspectability)
shared_root="$(git rev-parse --git-common-dir)/backlog"
for d in "${shared_root}"/*/; do
  [[ -d "$d" ]] || continue
  name=$(basename "${d%/}")
  printf "%s: %d\n" "$name" "$(find "$d" -name '*.md' -type f | wc -l | tr -d ' ')"
done

# Most-recent in-flight (first in-flight dir from pipeline, by default doing/)
ls -lt backlog/doing/*.md 2>/dev/null | head -5
```

### groom

Buckets from `../maintain.md` apply unchanged when scanning in-flight (the symlink-traversed `find backlog/{doing,reviewing,...}/` works the same). One additional bucket specific to this backend:

#### `ORPHANED SHARED IN-FLIGHT`

A file in a shared in-flight dir whose claim branch no longer exists (in this clone) AND whose claimer's worktree path is gone. Indicates a worktree was deleted mid-claim. Surface for operator decision: `fail` (likely) or rescue if the work is still desired.

```bash
shared_root="$(git rev-parse --git-common-dir)/backlog"
worktree_paths=$(git worktree list --porcelain | awk '/^worktree /{print $2}')
existing_branches=$(git branch --list --all --format='%(refname:short)' | sort -u)

for d in "${shared_root}"/*/; do
  for f in "$d"*.md; do
    [[ -f "$f" ]] || continue
    branch=$(grep -oE 'branch=[^ ]+' "$f" | tail -1 | cut -d= -f2)
    [[ -z "$branch" ]] && continue
    if ! echo "$existing_branches" | grep -qx "$branch" && \
       ! echo "$existing_branches" | grep -qx "origin/$branch"; then
      echo "ORPHANED SHARED IN-FLIGHT: $f (branch=$branch gone)"
    fi
  done
done
```

Suggested action: `fail` with reason `"orphaned: worktree/branch gone"`. Operator can `retry` if the work is still wanted.

## Migration from maildir-git

Run this once per project, on a single worktree:

```bash
common_dir=$(git rev-parse --git-common-dir)
shared_root="${common_dir}/backlog"
mkdir -p "$shared_root"

# 1. Move any existing in-flight files into the shared dir
for d in $(find backlog -mindepth 1 -maxdepth 1 -type d ! -name todo ! -name done ! -name failed -printf '%f\n'); do
  src_dir="backlog/$d"
  dst_dir="$shared_root/$d"
  mkdir -p "$dst_dir"
  for f in "$src_dir"/*.md; do
    [[ -f "$f" ]] || continue
    git rm "$f"
    mv "$f" "$dst_dir/$(basename "$f")" 2>/dev/null || true
  done
  rmdir "$src_dir" 2>/dev/null || true
done

# 2. Compute in-flight dir names from pipeline declaration (default: doing)
in_flight=$(awk '
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
' backlog/AGENTS.md)

# 3. Update .gitignore at repo root
for d in $in_flight; do
  if ! grep -qxF "backlog/$d" .gitignore 2>/dev/null; then
    echo "backlog/$d" >> .gitignore
  fi
done

# 4. Create symlinks
for d in $in_flight; do
  mkdir -p "${shared_root}/${d}"
  rm -rf "backlog/${d}" 2>/dev/null
  ln -s "${shared_root}/${d}" "backlog/${d}"
done

# 5. Update backlog/AGENTS.md to declare ## Backend: maildir-shared
# (manual edit, or use a sed if reliable for your file shape)

# 6. Stage and commit
git add .gitignore backlog/AGENTS.md
# Plus any committed git rm from step 1
git commit -m "chore(backlog): migrate to maildir-shared backend"
```

Reversible via `git revert` for the metadata + symlink removal. The files in `$shared_root` move back into `backlog/<dir>/` and re-add to git if the revert is needed.

## Race semantics

The O_EXCL create is the lock. Two agents simultaneously calling `advance` for the same slug both attempt to `cat "$src" > "$dst"` with noclobber set; the kernel admits exactly one. The loser sees a "claim conflict" message and exits non-zero.

No separate lockfile — the file IS the lock. When the work completes (`done`, `cancel`, or `fail`), the file leaves the shared dir and the slug becomes claimable again (only via `retry` from `failed/`, since `done/` is terminal).

Cross-machine coordination is *not* handled — the shared dir lives in one clone's `.git/`. A different machine's clone has a different common-dir and won't see this clone's claims. For cross-machine coordination, a different backend (e.g. an `issues`-style one routing through a remote tracker) would be needed.
