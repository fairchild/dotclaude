---
name: consequential-check
description: Install a CI workflow that labels a pull request `consequential` when its owner should merge it (hard to undo, weakens security, costs money, product decision, private data). Use when setting up merge routing, deciding whether an agent may merge a PR itself, or tuning the router from the owner's corrections.
license: Apache-2.0
metadata:
  status: experimental
  experimental_reason: "Not yet installed on a repository. The rubric, the per-question lines, and the 0.1 escalation margin are starting values with no tuning data behind them, and the lines were set for a Claude model before Jev decided."
---

# Consequential check

The router answers one question per pull request: does the owner need to be the one who merges
this? Everything else — review, CI, mergeability — stays where it is. A `consequential` label means
"the owner merges"; no label means the PR is eligible for whatever merge policy the repo already has.
The router never merges and never removes the label.

**Overlap.** Claude Approvals with a custom classifier (`.claude/classifiers/`) routes approvals
from a PR's diff on Team and Enterprise plans, and judges its policy from the default branch. Where
a repo has it, use it. This skill is for repos without it, and for the Jev-against-benchmark
comparison data it records.

## How it decides

1. **Jev decides.** Jev (TypeSafe's decision model, which returns probabilities rather than text)
   gets the diff and each question with the rubric's yes and no situations as its criteria. It
   returns a probability for each of five questions: `hard_to_undo`, `weakens_security`,
   `costs_money`, `product_decision`, `exposes_private_data`. Each question has its own line, the
   probability at or above which it raises; security and private data raise at 0.3, the others at
   0.5–0.6.
2. **A cheap Claude model answers beside it, as a benchmark.** It sees the same diff and the whole
   rubric, answers the same five questions with a one-line reason each, and never decides. The
   verdict waits at most `SHADOW_WAIT_SECONDS` for it; a slower or failed benchmark is recorded as
   "shadow unavailable". Its answers sit next to Jev's so the two can be compared over many PRs;
   when they land on opposite sides of a question's line, the run says so in a warning, the job
   summary and the PR comment.
3. **Answers that could flip the verdict escalate.** An answer is uncertain when it lies within
   `ESCALATE_MARGIN` (0.1) of its own question's line. Uncertain answers escalate only when they
   could change the verdict: any of them while no question is raised, or when every raised question
   is itself uncertain. An escalation sends the whole question set to a stronger model, whose
   answers are final. The benchmark's uncertainty never escalates.
4. **No Jev key, a diff too large for Jev's context, or a failed Jev call** means the benchmark
   model decides, escalating the same way. The comment says which.
5. **No key at all, an unreadable or oversized diff, or a failed final model call routes to the
   owner.** Nothing was judged, so the PR is labelled.

Jev gives probabilities, not reasons, so the "why" beside each raised question comes from the
stronger model when it answered, otherwise from the benchmark, and only from a model on the same
side of the line.

**Only the diff is judged.** The title and body are the author's argument for the change and an
author's text can only argue a verdict down, so neither reaches a model. The diff is the author's
text too; the prompt tells every model to weigh it as data and never follow instructions in it.
Keys are scrubbed from everything written (`--self-test` covers it).

Thresholds live in `scripts/consequential.py` (`QUESTIONS`, `ESCALATE_MARGIN`). The rubric in
`assets/rubric.md` is concrete situations, yes and no, per question; a model scores a diff against
examples more consistently than against "low/medium/high".

## Install on a repository

1. Copy `assets/consequential-check.yml` to `.github/workflows/`, and `scripts/consequential.py` and
   `assets/rubric.md` to `.github/consequential/`, on the default branch. The workflow triggers on
   `pull_request_target`, so GitHub reads it from the base branch and a PR cannot edit its own
   judge; it checks out the script and rubric from the base commit and runs no PR code. Keep it
   that way: do not add a step that checks out or runs the head.
2. Add `TYPESAFE_API_KEY` and `ANTHROPIC_API_KEY` as secrets, and set the `JEV_MODEL` variable to
   a pinned Jev version (the script defaults to one).
3. Edit the rubric's situations to fit the repo: its migrations, its deploy path, its billed services.
4. If a merge policy depends on the label (an auto-merge rule, an agent's standing permission), make
   that policy read the label after the check has run on the current head.

Pull requests from forks are skipped, and a skipped job leaves no label, so a policy that reads "no
label means eligible" lets them through. Treat fork PRs as owner-merged.

## Tuning from the owner's replies

The workflow keeps one verdict comment on the PR, edited in place, with every model's probability per
question and the head it judged. When the verdict is consequential, the comment opens with each
raised question and its one-line reason. The `consequential-verdict` artifact on each run holds the
same answers as JSON (`questions.<id>.jev`, `.benchmark`, `.strong`, `.final`). The owner confirms or
corrects the verdict with a single line:

```text
consequential: right
consequential: wrong costs_money adds a nightly job against a billed API
```

Those replies are the tuning data. Collect them across merged PRs:

```bash
gh api "repos/OWNER/REPO/issues/comments" --paginate \
  --jq '.[] | select(.body | test("^consequential: (right|wrong)")) | {pr: .issue_url, body}'
```

A wrong "no" on a PR whose diff carries text aimed at the judge (a comment arguing the change is
safe, say) is worth reading as attempted prompt injection.

Read each wrong verdict against the verdict comment on the same PR. A miss that a rubric situation
would have caught becomes a new situation; a question that is repeatedly wrong in one direction gets
its line moved. Move `ESCALATE_MARGIN` only when the escalation rate or the misses say so.

**Pin the decision model once it is tuned.** Set `JEV_MODEL` to the exact version the replies were
collected against; `jev-latest` moves with each release. A different model is a different router:
re-check it against the collected replies before switching.

`scripts/consequential.py --self-test` runs offline, with no model calls.
