---
priority: 4
arc: backlog-pluggable-backends
---

# Followup: live-instance smoke for the gitea backend

## Context

The gitea backend (`scripts/backlog-gitea.sh`) shipped with an offline mock harness — `scripts/test-gitea.sh` exercises the full verb cycle, branch-based claim conflict, fail/retry, rescue's timeout refusal, and the pagination loop (27 assertions, no network). What it can't prove is real-Gitea behavior: a mock validates the script against its own assumptions about the API, not against the API.

This followup is the one thing only a live instance settles — run the backend once against the real homelab Gitea and confirm the assumptions hold.

## Steps

1. Configure a tea login + a throwaway Gitea repo (`tea login add ...`; `git remote add gitea ...`). See `references/backends/gitea.md` for the wiring.
2. `backlog.sh setup --backend=gitea --login=<name>`, then run a full cycle: add → take → progress → advance→done; a second issue fail→retry; cross-check each against the Gitea web UI.
3. Confirm the four real-API assumptions:
   - label create accepts `#fbca04` (or adjust `ensure_label`'s color format),
   - label add-by-id / remove-by-id work on Gitea 1.26,
   - `tea api` auth resolves via `--login` and via `--remote gitea` host-match,
   - `type=issues` actually excludes PRs from `pick_takeable`/`status`.
4. Note any divergence found and fix the backend; record the confirmed-good tea version.

## Acceptance

- One documented live run, green, against the real instance.
- Any API-shape fix folded back into `scripts/backlog-gitea.sh`.

## Out of scope

- Cross-backend tests (one harness over all backends) — premature; the verb surface is stable.

---
