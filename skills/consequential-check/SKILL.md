---
name: consequential-check
description: Route a pull request to its owner when merging it is consequential — hard to undo, weakens security, costs money, makes a product decision, or could expose private data. Installs a CI workflow in which a decision model (TypeSafe's Jev) answers typed yes/no questions, a cheap Claude model answers the same questions as a benchmark, unsure answers escalate to a stronger model, and the PR is labelled `consequential`; it never merges. Use when setting up merge routing for a repo, deciding whether an agent may merge a PR itself, or tuning the router from the owner's corrections.
license: Apache-2.0
metadata:
  status: experimental
  experimental_reason: "Not yet installed on a repository. The rubrics, their per-question lines, the 0.1 escalation margin and the 60,000-character part size are starting values with no tuning data behind them, and the lines were set for a Claude model before Jev decided."
---

# Consequential check

The router answers one question per pull request: does the owner need to be the one who merges
this? Everything else — review, CI, mergeability — stays where it is. A `consequential` label means
"the owner merges"; no label means the PR is eligible for whatever merge policy the repo already has.
The router never merges and never removes the label.

## How it decides

1. **Jev decides.** Jev (TypeSafe's decision model, which returns probabilities rather than text)
   gets the diff and each of the rubric's questions, with that question's yes and no situations as
   its criteria, and returns a probability per question. The rubric defines the questions: each
   `## <id>` section has an `Ask:` line and a `Raise at:` line, the probability at or above which it
   raises. The default `assets/rubric.md` asks five (`hard_to_undo`, `weakens_security`,
   `costs_money`, `product_decision`, `exposes_private_data`; security and private data raise at
   0.3, the others at 0.5–0.6). `assets/rubric-stop-and-ask.md` asks one question per class of a
   stop-and-ask list (`visibility`, `spend`, `deletion`, `legal`, `gate`, `product`, `agents`), for a
   repository whose agents follow one and whose replay set is labelled with those classes.
2. **A cheap Claude model answers beside it, as a benchmark.** It sees the same pull request and the
   whole rubric, answers the same five questions with a one-line reason each, and never decides.
   Once Jev has answered, the verdict waits at most `SHADOW_WAIT_SECONDS` for it; a slower or failed
   benchmark is recorded as "shadow unavailable" and the verdict, label and comment go ahead.
   Its answers are recorded next to Jev's so the two models can be compared over many PRs. When they
   land on opposite sides of a question's line, the run says so: a warning annotation, a line in the
   job summary and a line in the PR comment.
3. **Answers that could flip the verdict escalate.** An answer is uncertain when it lies within
   `ESCALATE_MARGIN` (0.1) of its own question's line. Uncertain answers escalate only when they
   could change the verdict: any of them while no question is raised, or when every raised question
   is itself uncertain. A confident raise settles the verdict, so uncertain answers beside it do not
   escalate. An escalation sends the whole question set to a stronger model, whose answers are
   final, so one model stands behind each verdict. The benchmark's uncertainty never escalates.
4. **No Jev key, a part too large for Jev's context, or a failed Jev call** means the benchmark
   model decides, escalating the same way: the behaviour before Jev was added. The comment says
   which.
5. **No key at all, an unreadable diff, a diff of more than `MAX_PARTS` (30) parts, or a failed
   final model call routes to the owner.** Nothing was judged, so the PR is labelled.

**Only the diff is judged.** The title and body are the author's argument for the change, and an
author's text can only argue a verdict down, so neither reaches a model. The diff is the author's
text too, comments and strings included; the prompt tells every model to weigh it as data and never
follow instructions in it.

**Large diffs are judged in parts.** The workflow reads the diff from git (`base...head`, as GitHub
shows it), not from the API, which refuses very large diffs. A diff over `PART_CHARS` (60,000
characters, sized to fit Jev's context) is split by file into parts, whole files packed in order and
a file larger than a part cut at line ends with its header repeated. Each part is judged on its own,
up to six at once, and each question takes its highest probability across the parts, so size alone
never sends a PR to the owner. A raise names the part it came from. A part that cannot be judged
sends the whole PR to the owner.

Jev gives probabilities, not reasons, so the "why" beside each raised question comes from the
stronger model when it answered, otherwise from the benchmark, but only from a model on the same
side of the line. When the benchmark disagrees, the why says that Jev raised the question and the
benchmark disagreed. With no Anthropic key there is no reason to show, and the comment says so.

Keys are sent only when they are 16 or more printable ASCII characters with no whitespace; a
shorter value is a placeholder and is neither sent nor used to scrub. Before anything is serialized,
every string value in the verdict loses any run of eight or more characters taken from either key, so a
whole key, a prefix or a fragment never reaches the comment, the summary or the artifact. The
benchmark runs on a daemon thread, so the process exits once the verdict is written.

The questions and their lines live in the rubric; `ESCALATE_MARGIN`, `PART_CHARS` and `MAX_PARTS`
live in `scripts/consequential.py`. A rubric is written as concrete situations, yes and no, per
question; a model scores a diff against examples more consistently than against "low/medium/high".
The script refuses a rubric with a section missing its ask, its line or either list of situations.

## Install on a repository

1. Copy `assets/consequential-check.yml` to `.github/workflows/`, and `scripts/consequential.py` and
   one of the rubrics (as `rubric.md`) to `.github/consequential/`, on the default branch. The
   workflow runs both from the base commit, so a PR cannot edit its own judge. It fetches the full
   history so git can read the diff; a head commit that is no longer on its branch cannot be read,
   and that PR routes to the owner until the next push.
2. Add `TYPESAFE_API_KEY` and `ANTHROPIC_API_KEY` as secrets, and set the `JEV_MODEL` variable to
   a pinned Jev version (the script defaults to one).
3. Edit the rubric's questions and situations to fit the repo: its migrations, its deploy path, its
   billed services. Where a deterministic check already covers a question (a guard on gate
   configuration, say), delete that question: a guard beats a model.
4. If a merge policy depends on the label (an auto-merge rule, an agent's standing permission), make
   that policy read the label after the check has run on the current head.

Pull requests from forks are skipped: they get no secrets and a read-only token. In a repo where
outside contributors open PRs, treat those as owner-merged by default.

## Tuning from the owner's replies

The workflow keeps one verdict comment on the PR, edited in place, with every model's probability per
question and the head it judged. When the verdict is consequential, the comment opens with why: each
raised question with its one-line reason. The `consequential-verdict` artifact on each run holds the
same answers as JSON (`questions.<id>.jev`, `.benchmark`, `.strong`, `.final`), so a comparison of
Jev and the benchmark across PRs needs no new model calls. The owner confirms or corrects it with a single line:

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
safe, say) is worth reading as attempted prompt injection, and is worth a case in the replay set.

Read each wrong verdict against the verdict comment on the same PR. A miss that a rubric situation
would have caught becomes a new situation; a question that is repeatedly wrong in one direction gets
its line moved. Move `ESCALATE_MARGIN` only when the escalation rate or the misses say so — it is a
number, nothing more.

**Pin the decision model once it is tuned.** Set `JEV_MODEL` to the exact version the replies were
collected against; `jev-latest` moves with each release. A different model is a different router: re-check it against the collected
replies before switching.

## What it costs

Every verdict records its model cost: the comment and the job summary end with the total and each
model's share, the artifact holds `cost_usd` and per-model `usage` (tokens and dollars), and the
step's outputs include `cost_usd` and `parts`. A PR judged in parts costs the sum of its parts.
Total the spend over recent runs before making the check required:

```bash
gh run list --workflow consequential-check.yml --limit 200 --json databaseId --jq '.[].databaseId' |
  while read -r id; do gh run download "$id" -n consequential-verdict -D "runs/$id" 2>/dev/null; done
jq -s '{runs: length, usd: (map(.cost_usd // 0) | add), parts: (map(.parts // 1) | add)}' runs/*/verdict.json
```

The prices are in `PRICES` in the script; check them against the providers' current price lists.

## Checks

`scripts/consequential.py --self-test` covers loading questions from a rubric (and refusing a broken
one, and loading every shipped rubric), the thresholds, Jev deciding with the benchmark beside it,
the disagreement highlight, escalation only when an answer could flip the verdict, the bounded
benchmark wait, every fallback (no Jev key, a part too large for Jev, a failed Jev call, no key at
all), a prompt that carries no title or body, splitting a large diff into parts and combining their
verdicts, a part that fails, the part limit, reading the diff from git past a moved base with no
diff driver run, keys kept out of everything written, the comment, and the cost per model and in
total. It makes no model calls.
