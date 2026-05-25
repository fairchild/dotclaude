---
priority: 3
arc: backlog-pluggable-backends
dependencies:
  github-issues-backend-plan: "lands the labels this would parameterize"
---

# Followup: convention-first github-issues backend (parameterize labels + lead docs with protocol)

## Field signal

Originated from a real install — `fairchild/workspaces` ran `backlog setup --backend=github-issues` (skill HEAD `e5e632a`, 2026-05-25). Reported via the `backlog-labels-align` agent through the cross-agent inbox; full thread archived at `.agents/inbox/gh-issues-design/archive/20260525T093200-triage-labels-fit.md`.

The friction wasn't a name collision — it was **semantic mismatch with an existing in-house vocabulary**. The workspaces repo has a documented label scheme at `docs/agents/triage-labels.md` (lanes, states, gates, dimensions) and live automation (`sync-execution-state.py`, managed PR reviewer) that drives it. The skill's `doing` is semantically their `claimed`; there's no name conflict (no existing `doing` label), but the skill speaking a different word from the rest of the repo is the friction.

Operator direction after seeing the report (2026-05-25): **don't fork the script**. The workspaces project is the flagship; the backlog skill needs to be usable there alongside the Matt Pocock skills without local divergence. The path forward is the upstream parameterization PLUS a reframing of the docs to make the conventions inspection-obvious, so the skill becomes a nice-to-have convenience over a documented protocol — not the only way to participate.

## The bigger framing

The current backend reference doc and the AGENTS.md template are *skill-centric*: "use the `backlog` skill (add / take / advance / ...) — verbs dispatch to `gh issue` under the hood." That puts the skill at the center and the protocol behind it.

The operator's framing inverts this: the **protocol is the contract**, the skill is one implementation of it. A human operator or a Matt Pocock agent should be able to read `backlog/AGENTS.md`, understand the state machine + worklog convention, and operate directly via `gh issue` calls without ever invoking the skill. The skill is a convenience for the operations that benefit from it (auto-pick, claim race resolution, status counts); ad-hoc operations (open this issue, label it `claimed`, comment with `- TS advanced to=doing branch=foo`) should be just as legitimate.

Two corollaries:

1. **Configuration belongs at the project level**, in `backlog/AGENTS.md` (and optionally surfaced in the repo's root `AGENTS.md` so agents inheriting from there see it). The label names, the worklog comment format, the state mapping — all of these should be documented in the project's own files, not buried in the skill's reference doc.

2. **The protocol must be expressible in real patterns**. The state mapping table, the worklog line shape, the claim resolution rules — these should be readable enough that someone inspecting actual issues + comments can reconstruct the system without reading any skill source.

## Proposal

### Part 1 — Parameterize the label names

Add an optional `## Labels` section to `backlog/AGENTS.md` that the script reads:

```markdown
## Labels

claim: claimed
failed: dead-letter
```

Mechanism:

- `lib.sh` gains `backlog_label <role>` reader (analogous to `backlog_backend`) — returns the configured name or the role's default (`doing` for claim, `failed` for failed).
- `backlog-github-issues.sh` substitutes `$(backlog_label claim)` / `$(backlog_label failed)` everywhere it currently hardcodes the bare names.
- `cmd_setup` writes the static label set using the configured names (so `gh label create` picks up the project's vocabulary).

Backwards-compatible: projects without the section get current behavior unchanged.

### Part 2 — Reframe AGENTS.md template + reference doc to lead with the protocol

`cmd_setup`'s AGENTS.md template (and the backend reference doc) currently lead with "Use the `backlog` skill" then describe state as backend internals. Reframe to lead with the **protocol**, then mention the skill as one implementation:

Sketch of the new `backlog/AGENTS.md` template:

```markdown
# backlog/

Task state lives in GitHub Issues on **${repo}**. The repo's open issues are
the backlog — anything open is takeable.

## State mapping

| State    | open/closed | labels             |
|----------|-------------|--------------------|
| todo     | open        | no `claim` label   |
| doing    | open        | `claim` label      |
| done     | closed      | no `failed` label  |
| failed   | closed      | `failed` label     |

(Label names default to `doing` / `failed`; configurable via `## Labels` below.)

## Worklog

Every state transition and progress note is one comment on the issue, formatted:

    - <ISO-8601 ts> <verb> [args] | <trail>

| Verb                   | Args                                                     |
|------------------------|----------------------------------------------------------|
| `advanced to=doing`    | `claimer=<who>` `branch=<branch>`                        |
| `advanced to=done`     | optional `\| PR=<url>`                                    |
| `progress`             | trail = `\| <note>`                                       |
| `cancelled`            | trail = `\| <reason>`                                     |
| `failed`               | trail = `\| <reason>`                                     |
| `rescued`              | `claimer=<who>` `branch=<branch>`                        |
| `retried`              | trail = `\| <reason>`                                     |

## Claim resolution

The branch is the claim identity. Walking comments chronologically:
- `retried` resets the contest (no winner)
- `advanced to=doing` sets the winner only if currently empty (first-wins)
- `rescued` overrides the current winner (deliberate timeout takeover)

The earliest `advanced to=doing` since the most recent `retried`, optionally overridden by a later `rescued`, is the canonical claimer of the issue.

## Operating

These conventions are operable directly via `gh issue` — open an issue, add the claim label, post the right comment. The `backlog` skill (`add / take / advance / progress / cancel / fail / rescue / retry / maintain / status`) is a convenience layer that automates the common patterns (auto-pick, race-resolution at claim time, status counts) but isn't required for any of them.

## Backend

`github-issues` — see the `backlog` skill's `references/backends/github-issues.md` for the script's behavior.

## Labels

(Optional — defaults shown.)

    claim: doing
    failed: failed

## Pipeline

`todo → doing → done` (intermediate stages aren't supported yet).
```

The backend reference doc gets a parallel pass — lead with the protocol, then describe how the script implements it. The script's verbs become "here's how `take` implements the claim protocol," not the source of truth for what claiming means.

## Acceptance

- **Label parameterization**
  - `## Labels` section in `backlog/AGENTS.md` is read by `lib.sh`; absence yields current defaults (`doing`, `failed`).
  - `cmd_setup --backend=github-issues` creates labels named per the configured values.
  - All verbs operate on the configured names.
- **Convention-first docs**
  - `cmd_setup`'s AGENTS.md template leads with the state machine + worklog protocol; the skill is mentioned as one implementation, not the entry point.
  - `references/backends/github-issues.md` likewise leads with the protocol, then describes the script.
  - The protocol is detailed enough that a human or another agent could operate the system manually via `gh issue` calls without reading the skill source.
- **Smoke test**
  - Setup a scratch repo with custom labels (`claim: claimed`, `failed: dead-letter`).
  - Walk a task through `add → take → progress → advance` via the skill.
  - Then manually open an issue, add the `claimed` label, post the right `advanced to=doing` comment, and verify the skill's `status` / `current_claim` see it correctly.

## Out of scope

- **Intermediate pipeline stages** (`claimed → review → mergeable → done`). Separate concern. The workspaces operator may prototype option B locally; that informs a future upstream task, not this one.
- **Participant vs owner mode** (skill as one of several label writers). Doc-only mention here; deferred until intermediate stages need code support.
- **Maildir backends.** Their state lives in directory names, not labels — parameterizing is a different shape, already covered by the pipeline parser in `lib.sh`.

## Phases

1. `backlog_label` reader in `lib.sh` with default fallback. Test the parser against fixture AGENTS.md files (no section, partial, full).
2. Substitute hardcoded `"doing"` / `"failed"` in `backlog-github-issues.sh`. Hits: `cmd_setup` (label creation), `cmd_take`/`cmd_rescue` (add claim), `cmd_advance` (remove claim), `cmd_fail`/`cmd_retry` (add/remove failed), `cmd_status` (label-based bucket queries), `pick_takeable` (filter), `current_claim` (filter).
3. Rewrite the AGENTS.md template in `cmd_setup` to be protocol-first.
4. Rewrite `references/backends/github-issues.md` to be protocol-first.
5. Manual smoke test: scratch repo, custom labels, walk a task, then a manual `gh issue` operation that the skill recognizes.

## Why this stays one task

The label parameterization and the doc reframing are tightly coupled — landing the parameterization without the doc reframing leaves the system feeling skill-centric ("I configured my labels but I still need the skill to do anything"), and reframing the docs without parameterization leaves projects with existing vocabularies forced to either rename their labels or hold off. Both shipped together is the smallest unit that delivers the operator's stated goal: "obvious on inspection, skill as nice-to-have."

---
- 2026-05-25T17:14:32Z advanced to=doing claimer=fairchild@blue branch=c-austin-v12
- 2026-05-25T17:21:19Z advanced to=done | PR=https://github.com/fairchild/dotclaude/pull/181
