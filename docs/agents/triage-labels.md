# Triage labels

The engineering skills (`triage`, `to-issues`, `to-prd`) speak in terms of five canonical triage roles. In this repo those roles don't live as labels — the `backlog` skill encodes triage state in **directory location**, with `priority:` frontmatter as the in-bucket sort key.

## Mapping

| Canonical role | In this repo |
|---|---|
| `needs-triage` | File in `backlog/todo/` with no explicit `priority:` (defaults to 999 — sorts last). Run `scripts/backlog.sh maintain` to walk the bucket and assign priorities. |
| `needs-info` | File in `backlog/todo/` whose body notes what's missing. No separate state — it stays in `todo/` until the gap is filled. A future iteration could split this out, but the current model keeps it as a body-content concern. |
| `ready-for-agent` | File in `backlog/todo/` with declared `priority:` and a body specific enough for a fresh session to execute it cold. This is the canonical AFK-ready state — pickable by `take` or `worker`. |
| `ready-for-human` | File in `backlog/todo/` whose body explicitly asks for human hands. No frontmatter field; convention is to call it out in the title or first line. |
| `wontfix` | `scripts/backlog.sh fail <slug> "wontfix: <reason>"` — moves the file to `backlog/failed/`. The `failed` log line carries the reason. |

When a skill says "apply the AFK-ready triage label", that means: ensure the file is in `backlog/todo/`, has a declared `priority:`, and the body is executable cold. There's no field to flip.

## One axis, not two

The earlier version of this doc described a `status:` frontmatter axis layered on top of location. That model is gone — the `backlog` skill collapsed it. **Position in the pipeline IS the state**:

- `todo/` — open, not yet claimed
- `doing/` — claimed, in flight
- `done/` — closed (the `cancelled` log line distinguishes cancellation from completion)
- `failed/` — dead-letter (used for `wontfix` too)

Within `todo/`, `priority:` (1 = highest, default 999) is the only ordering mechanism. `maintain` is the verb for triage work — walking the bucket, assigning priorities, surfacing items that need info, deciding what to `fail`.

## Listing by triage state

```bash
scripts/backlog.sh status                                  # counts per state + recent in-flight
ls backlog/todo/                                            # everything open
grep -l "^priority: [12]$" backlog/todo/*.md                # high-priority open items
grep -L "^priority:" backlog/todo/*.md                      # items with no priority (needs-triage)
grep -l "^arc: " backlog/todo/*.md                          # items linked to a ROADMAP arc
ls backlog/failed/                                          # wontfix / dead-letter
```
