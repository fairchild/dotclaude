---
name: consequential-check
description: Install a GitHub Actions check that fails, and labels the pull request `consequential`, when its owner should be the one to merge it (hard to undo, weakens security, costs money, product decision, private data). Use when setting up merge routing, deciding whether an agent may merge a pull request itself, or tuning the router from the owner's corrections.
license: Apache-2.0
metadata:
  status: experimental
  experimental_reason: "Not yet installed on a repository. The rubric, the per-question lines, and the 0.1 escalation margin are starting values with no tuning data behind them, and the lines were set for a Claude model before Jev decided."
---

# Consequential check

The check answers one question per pull request: does the owner need to be the one who merges
this? Review, tests and mergeability stay where they are. It is green when a model judged the
current head's diff and raised nothing. Every other state means the owner merges: a failed check, a
cancelled one, a missing one, or a green one on an older head.

**The rule for an agent**, on a repository that has the check: merge only when it is green on the
current head, and never remove the `consequential` label.

A raised pull request gets the `consequential` label and a comment that says why. The check never
merges, approves, or removes the label.

**Overlap.** Claude Approvals with a custom classifier (`.claude/classifiers/`) routes approvals
from a pull request's diff on Team and Enterprise plans, and judges its policy from the default
branch. Where a repo has it, use it. This skill is for repos without it, and for the
Jev-against-benchmark comparison data it records.

## How it decides

1. **One model decides.** Jev (TypeSafe's decision model, which returns probabilities rather than
   text) decides when `TYPESAFE_API_KEY` is set. Without that key a cheap Claude model decides
   (`BENCHMARK_MODEL`, Haiku by default). The decider reads the diff and the rubric and returns a
   probability for each of five questions: `hard_to_undo`, `weakens_security`, `costs_money`,
   `product_decision`, `exposes_private_data`. Each question has its own line, the probability at
   or above which it raises; security and private data raise at 0.3, the others at 0.5–0.6.
2. **A verdict too close to call goes to Opus.** An answer is uncertain when it lies within
   `ESCALATE_MARGIN` (0.1) of its question's line. Uncertain answers matter only when they could
   change the verdict: any of them while no question is raised, or every raised question. Then
   Opus (`STRONG_MODEL`) answers the whole set. If none of its answers could change its own
   verdict, they are final. If one could, or Opus cannot be asked (no Anthropic key, a failed
   call), no model decided and the owner merges.
3. **Beside Jev, the cheap Claude model answers once as a benchmark.** It runs when Jev decides and
   `ANTHROPIC_API_KEY` is set. It gives a one-line reason per question, which Jev does not, and
   numbers to compare with Jev's over many pull requests. It never decides and its uncertainty
   never escalates. When the two land on opposite sides of a question's line, the run says so in a
   warning, the job summary and the comment.
4. **Whatever leaves the diff unjudged goes to the owner.** A pull request from a fork, no key, a
   diff that is empty or too large (over 400,000 characters, or over Jev's context when Jev
   decides), a decider that did not answer. No other model steps in for the decider.

The reason beside a raised question comes from a model on the same side of the line: Opus when it
answered, otherwise the benchmark. When Jev raises a question the benchmark does not, the comment
says "no reason given" and names the disagreement.

**Only the diff is judged.** The title and body are the author's account of the change, and neither
reaches a model. That cuts both ways. A description cannot talk a verdict down, and a consequence
stated only in the title or body ("this ships on merge", "needs the paid tier") is not judged. The
models also cannot see whether the owner already asked for a change, so a pull request that adds or
changes a user-facing feature raises `product_decision` even when an issue asked for exactly that.
The diff is the author's text too; the prompt tells every model to weigh it as data and never
follow instructions in it.

**What a run writes** is public on a public repository: the comment, the job summary and the
`consequential-verdict` artifact. Secret-shaped strings are redacted from the diff before a model
reads it and from a model's reasons before they are written. A failed model call is reported as a
fixed phrase, or the exception's class and HTTP status, never its text, so no key and no response
body is written. The class and status are then all there is to debug a failed call from.

Thresholds live in `scripts/consequential.py` (`QUESTIONS`, `ESCALATE_MARGIN`). The rubric in
`assets/rubric.md` is concrete situations, yes and no, per question; a model scores a diff against
examples more consistently than against "low/medium/high".

## Install on a repository

1. Copy `assets/consequential-check.yml` to `.github/workflows/`, and `scripts/consequential.py` and
   `assets/rubric.md` to `.github/consequential/`, on the default branch. The workflow triggers on
   `pull_request_target`, so GitHub runs it from the default branch, whatever branch a pull request
   targets, and a pull request cannot edit its own judge. Its checkout takes the script and rubric
   from the default branch too and runs no pull request code. Keep it that way: do not give the
   checkout a `ref`, and do not add a step that checks out or runs the head.
2. On a public repository, allow the event. GitHub blocks `pull_request_target` in public
   repositories by default from 2026-12-02, and a blocked run never starts. Under Settings →
   Actions → Policies, add a policy that targets `.github/workflows/consequential-check.yml` and
   allows the `pull_request_target` event
   ([GitHub's docs](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target#default-policy-for-pull_request_target)).
   Without it the check is never green and every pull request is the owner's to merge. Private
   repositories are not affected.
3. Add `TYPESAFE_API_KEY` and `ANTHROPIC_API_KEY` as secrets, and set the `JEV_MODEL` variable to
   a pinned Jev version (the script defaults to one). With only the Anthropic key, Haiku decides
   and Opus settles close calls. With only the Jev key, there are no reasons and every close call
   goes to the owner.
4. Edit the rubric's situations to fit the repo: its migrations, its deploy path, its billed services.
5. Make whatever merges without the owner wait for the check: an agent's standing permission, an
   auto-merge rule. As a required status check it also blocks the owner on a raised pull request,
   so give the owner a bypass or leave it out of the ruleset and have agents read it.

**Clearing a raise.** The label outlives the push that earned it: once a head is raised, later
heads fail the check even when their own verdict is no. The owner clears it by merging, or by
removing the label and re-running the check, which judges the current head again.

**What a run costs.** At most three model calls. The check runs on every push and on every edit to
the title, body or base branch. An edit to the title changes nothing a model reads, but a run
skipped for it would report success and replace a failing check, so it judges again.

## Tuning from the owner's replies

The workflow keeps one verdict comment on the pull request, edited in place, with every model's
probability per question and the head it judged. When the verdict is consequential, the comment
opens with each question that raised or was too close to call. The `consequential-verdict` artifact
on each run holds the same answers as JSON (`questions.<id>.jev`, `.benchmark`, `.strong`, `.final`,
`.uncertain`); `decided_by` is null when no model decided. The owner confirms or corrects the
verdict with a single line:

```text
consequential: right
consequential: wrong costs_money adds a nightly job against a billed API
```

Those replies are the tuning data. Collect them across merged pull requests:

```bash
gh api "repos/OWNER/REPO/issues/comments" --paginate \
  --jq '.[] | select(.body | test("^consequential: (right|wrong)")) | {pr: .issue_url, body}'
```

A wrong "no" on a pull request whose diff carries text aimed at the judge (a comment arguing the
change is safe, say) is worth reading as attempted prompt injection.

Read each wrong verdict against the verdict comment on the same pull request. A miss that a rubric
situation would have caught becomes a new situation; a question that is repeatedly wrong in one
direction gets its line moved. Move `ESCALATE_MARGIN` only when the share of verdicts that go to
Opus or to the owner, or the misses, say so.

**Pin the decision model once it is tuned.** Set `JEV_MODEL` to the exact version the replies were
collected against; `jev-latest` moves with each release. A different model is a different router:
re-check it against the collected replies before switching.

`scripts/consequential.py --self-test` runs offline, with no model calls.
