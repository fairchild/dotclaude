---
priority: 3
arc: backlog-roadmap-dogfood
---

# Backlog dep validation — precommit hook + agent hint

## Problem Statement

Tasks under `backlog/` can declare `dependencies: { <slug>: "<reason>" }` in frontmatter. Today nothing validates that the slug actually resolves to a file anywhere in `backlog/{todo,inbox,doing,done,failed}/`. A typo or rename produces an `UNRESOLVABLE DEPS` finding only when `maintain` runs (which is operator-initiated and ad-hoc); the broken dep can sit invisibly for weeks.

Worse, the agent that *wrote* the bad dep has no signal. They committed, the commit succeeded, they moved on. The next worker that reads the task discovers the broken pointer.

## Goal

A `pre-commit` hook that, when a commit touches any `backlog/**/*.md` file, parses each touched file's `dependencies:` block and refuses the commit if any slug doesn't resolve. The rejection message names the missing slug AND tells the committing agent how to author it via `bash ~/.claude/skills/backlog/scripts/backlog.sh add <slug>` — so the agent sees the message, scaffolds the dependent task, and re-commits.

## Key decisions

| Decision | Choice | Rationale |
|---|---|---|
| Where the hook lives | `~/.claude/skills/backlog/hooks/validate-deps.sh` invoked by repo `.pre-commit-config.yaml` | Skill owns the validation logic; repo just opts in |
| What counts as "resolves" | Slug `<x>` is satisfied iff `backlog/**/<x>.md` exists in the working tree | Mirrors `backlog_deps_resolved` in `lib.sh` |
| Behavior on missing dep | Fail the commit with a structured message naming the slug + suggested `add` invocation | The agent reads the failure and acts on it |
| Self-dependency / circular checks | Out of scope for v1 | Cycle detection already lives in `maintain.md`; keep the hook narrow |
| Behavior when the dep is the same commit | Allow it — the dep file is staged in the same commit | Common pattern: `add` followup + close parent in one PR (the chronicle work just did this) |

## Phases

### Phase 1: Validator script

Write `~/.claude/skills/backlog/hooks/validate-deps.sh`:

- Reads file paths from argv (pre-commit passes the staged file list).
- For each `backlog/**/*.md` argument, extracts the `dependencies:` block (mirror the awk in `maintain.md`'s `UNRESOLVABLE DEPS` recipe).
- For each declared slug, check whether `backlog/**/<slug>.md` exists in the working tree OR in the index for this commit (so same-commit dep additions pass).
- On any miss, print a single line per miss:
  ```
  backlog: unresolved dep in <file>: <slug>
    → author it with: bash ~/.claude/skills/backlog/scripts/backlog.sh add <slug> [followup|plan|task-list|ideas]
  ```
- Exit non-zero if any miss surfaced.

**Acceptance:**
- [ ] Script runs against any `backlog/**/*.md` and exits 0 when all deps resolve
- [ ] Exits non-zero with a clear message when a dep is missing
- [ ] Same-commit dep additions (deps file is staged in this commit) pass

### Phase 2: Wire into pre-commit

Edit `.pre-commit-config.yaml` to add a local hook entry:

```yaml
- repo: local
  hooks:
    - id: backlog-dep-validation
      name: backlog: validate dependencies
      entry: bash ~/.claude/skills/backlog/hooks/validate-deps.sh
      language: system
      files: ^backlog/.*\.md$
      pass_filenames: true
```

**Acceptance:**
- [ ] `git commit` of a backlog file with an unresolved dep fails with the validator's message
- [ ] `git commit` of a backlog file with all deps resolved passes
- [ ] Non-backlog commits are unaffected

### Phase 3: Document

Add a short section to the backlog skill (probably `references/worker.md` near the dep mechanics, or `references/agents-schema.md` near the `dependencies:` field doc):

> Pre-commit dep validation: when this repo enables the `backlog-dep-validation` hook, commits that touch a backlog file are rejected if any declared `dependencies:` slug doesn't resolve. The failure message names the missing slug and suggests the `add` invocation. The committing agent should author the dependent task and re-commit.

**Acceptance:**
- [ ] Documented in one place an agent reading the skill would actually find
- [ ] Hook config is opt-in per repo (so projects without the hook are unaffected)

## Verification

```bash
# Phase 1 standalone:
echo '---
dependencies:
  ghost-slug: "missing dep"
---' > /tmp/test-task.md
bash ~/.claude/skills/backlog/hooks/validate-deps.sh /tmp/test-task.md
# Expect: exit 1, message naming ghost-slug

# Phase 2 wired:
# 1. Commit a backlog file referencing a real dep → passes
# 2. Commit a backlog file referencing a typo slug → fails with hook message
# 3. Commit a file outside backlog/ → unaffected
```

## Out of scope

- Cycle detection (lives in `maintain`).
- Validating dep *reasons* (the value side of the map — free text by design).
- Auto-creating the dependent task from the hook (the agent should do it, after reading the message — keeps the hook side-effect-free).

## References

- `~/.claude/skills/backlog/references/maintain.md` — `UNRESOLVABLE DEPS` bucket (the post-hoc version of this check)
- `~/.claude/skills/backlog/scripts/lib.sh:backlog_deps_resolved` — the resolution logic to mirror
- `~/.claude/skills/backlog/references/agents-schema.md` — `dependencies:` field schema
- Original ask: PR #177 review comment on `chronicle-auto-extractor-haiku-fix-followup.md` line 6

---
- 2026-05-25T22:41:13Z advanced to=doing claimer=fairchild@blue branch=codex-backlog-dep-validation
- 2026-05-25T22:46:24Z advanced to=done | PR=https://github.com/fairchild/dotclaude/pull/185
