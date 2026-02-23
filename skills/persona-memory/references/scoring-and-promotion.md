# Scoring and Promotion

`persona-memory` uses candidate events first, then promotes stable memory during consolidation.

## Confidence Levels

- `confirmed`: explicitly stated or clearly decided by user/team.
- `observed`: repeated pattern inferred from behavior.
- `inferred`: weak signal, needs more evidence.

## v1 Promotion Rules

1. Promote `confirmed` and `observed` by default.
2. Keep `inferred` as candidate unless explicitly promoted.
3. Skip duplicates by normalized content match (case-insensitive).
4. Route by type:
- `fact` -> `user-profile.md`
- `preference` -> `preferences.md`
- `decision` -> `decisions.md`
- `thread` -> `active-threads.md`
- `relationship` -> `relationships.md`

## Project-Aware Promotion

When `project_key` exists:
- also append to `blocks/projects/<project-key>.md`

## Deduping Heuristic (v1)

1. Normalize line (trim/lowercase, collapse spaces).
2. Compare against existing lines in target block.
3. If same normalized content exists, mark event as duplicate and do not re-add.

## Future Upgrades

- semantic dedupe via embeddings
- confidence calibration from user feedback
- time-decay and archival snapshots
