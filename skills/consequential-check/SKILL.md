---
name: consequential-check
description: Route a pull request to its owner when merging it is consequential — hard to undo, weakens security, costs money, makes a product decision, or could expose private data. Installs a CI workflow that asks a cheap decision model typed yes/no questions, escalates unsure answers to a stronger model, and labels the PR `consequential`; it never merges. Use when setting up merge routing for a repo, deciding whether a steward may merge a PR itself, or tuning the router from the owner's corrections.
license: Apache-2.0
metadata:
  status: experimental
  experimental_reason: "Not yet installed on a repository. The rubric, the per-question lines, and the 0.75 escalation threshold are starting values with no tuning data behind them."
---

# Consequential check

The router answers one question per pull request: does the owner need to be the one who merges
this? Everything else — review, CI, mergeability — stays where it is. A `consequential` label means
"the owner merges"; no label means the PR is eligible for whatever merge policy the repo already has.
The router never merges and never removes the label.

## How it decides

1. **A cheap decision model answers first.** It gets the diff, the title and body, and the rubric,
   and returns a probability for each of five questions: `hard_to_undo`, `weakens_security`,
   `costs_money`, `product_decision`, `exposes_private_data`. Each question has its own line, the
   probability at or above which it raises; security and private data raise at 0.3, the others at
   0.5–0.6.
2. **Unsure answers escalate.** An answer is unsure when neither yes nor no reaches 0.75 —
   `max(p, 1 - p) < 0.75`. Any unsure answer sends the whole question set to a stronger model, whose
   answers are final.
3. **No decision-model key means the stronger model answers alone.**
4. **No key at all, an unreadable or oversized diff, or a failed model call routes to the owner.**
   Nothing was judged, so the PR is labelled.

The thresholds live in `scripts/consequential.py` (`QUESTIONS`, `ESCALATE_BELOW`). The rubric in
`assets/rubric.md` is written as concrete situations, yes and no, per question; a model scores a
diff against examples more consistently than against "low/medium/high".

## Install on a repository

1. Copy `assets/consequential-check.yml` to `.github/workflows/`, and `scripts/consequential.py` and
   `assets/rubric.md` to `.github/consequential/`, on the default branch. The workflow runs both from
   the base commit, so a PR cannot edit its own judge.
2. Add `ANTHROPIC_API_KEY` as a secret. Add `DECISION_MODEL_API_KEY` and the `DECISION_MODEL`
   variable when a decision model is in use.
3. Edit the rubric's situations to fit the repo: its migrations, its deploy path, its billed services.
4. If a merge policy depends on the label (an auto-merge rule, a steward's standing permission), make
   that policy read the label after the check has run on the current head.

Pull requests from forks are skipped: they get no secrets and a read-only token. In a repo where
outside contributors open PRs, treat those as owner-merged by default.

## Tuning from the owner's replies

The workflow keeps one verdict comment on the PR, with each question's probability and the head it
judged. The owner confirms or corrects it with a single line:

```text
consequential: right
consequential: wrong costs_money adds a nightly job against a billed API
```

Those replies are the tuning data. Collect them across merged PRs:

```bash
gh api "repos/OWNER/REPO/issues/comments" --paginate \
  --jq '.[] | select(.body | test("^consequential: (right|wrong)")) | {pr: .issue_url, body}'
```

Read each wrong verdict against the verdict comment on the same PR. A miss that a rubric situation
would have caught becomes a new situation; a question that is repeatedly wrong in one direction gets
its line moved. Move `ESCALATE_BELOW` only when the escalation rate or the misses say so — it is a
number, nothing more.

**Pin the decision model once it is tuned.** Set `DECISION_MODEL` to the exact model id the replies
were collected against. A different model is a different router: re-check it against the collected
replies before switching.

## Checks

`scripts/consequential.py --self-test` covers the thresholds, the escalation path, and the
no-key route. It makes no model calls.
