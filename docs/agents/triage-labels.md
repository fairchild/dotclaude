# Triage labels

The engineering skills speak in terms of five canonical triage roles. In this repo those roles live as values of a `status:` frontmatter field on each `backlog/*.md` file — there are no GitHub labels involved.

## Mapping

| Canonical role | `status:` value | Meaning |
|---|---|---|
| `needs-triage` | `needs-triage` | Captured but not yet evaluated |
| `needs-info` | `needs-info` | Waiting on more context before it's actionable |
| `ready-for-agent` | `ready-for-agent` | Fully specified; an AFK agent can pick it up cold |
| `ready-for-human` | `ready-for-human` | Needs Michael's hands |
| `wontfix` | `wontfix` | Will not be actioned — move the file to `backlog/done/` and keep `status: wontfix` |

When a skill says "apply the AFK-ready triage label", that means: set `status: ready-for-agent` in the file's frontmatter.

## Two axes, not one

There are two orthogonal states on a backlog file:

- **Location** — coarse pending/done axis. Top-level `backlog/` = pending, `backlog/done/` = done. The `backlog` skill defines this.
- **`status:` frontmatter** — finer-grained triage axis within pending. Defined here.

A file in `backlog/done/` is closed; the `status:` value records *how* it closed (typically `wontfix`, or simply omit `status:` for shipped work). A file at the top level of `backlog/` is open; `status:` says where it sits in the triage state machine.

## Listing by status

```bash
# Everything waiting on reporter info
grep -l "^status: needs-info$" backlog/*.md

# Everything AFK-ready
grep -l "^status: ready-for-agent$" backlog/*.md
```

(Or use `~/.claude/skills/backlog/scripts/status.sh` for the full listing.)
