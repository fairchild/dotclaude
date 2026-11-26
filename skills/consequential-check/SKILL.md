---
name: consequential-check
description: Install a GitHub Actions check that fails, and labels the pull request `consequential`, when its owner should be the one to merge it (hard to undo, weakens security, costs money, product decision, private data). Use when setting up merge routing, deciding whether an agent may merge a pull request itself, checking before a push how a change will be judged, working through the owner's queue of flagged pull requests, or tuning the router from the owner's corrections.
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
current head and the pull request carries no `consequential` label, and never remove that label.
Both of these print `true` then, and only then:

```bash
gh pr checks NUMBER --json name,event,bucket --jq \
  '[.[] | select(.name == "consequential-check" and .event == "pull_request_target") | .bucket] == ["pass"]'
gh pr view NUMBER --json labels --jq '[.labels[].name | ascii_downcase] | any(. == "consequential") | not'
```

`gh pr checks` gives the latest run of each check on the head. `statusCheckRollup` also keeps the
earlier ones, where a stale pass can sit beside a newer failure. The `event` filter passes over a
job of the same name that a pull request adds in a workflow of its own.

A pull request gets the `consequential` label when a model raised a question or could not call
one, with a comment that says why. A run that judged nothing (a fork, an outage, a missing key)
fails with a comment and no label, so the next run can still pass. The check never merges,
approves, or removes the label.

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
   decides), a rubric that lost a question's `Yes:` or `No:` list, a decider that did not answer.
   No other model steps in for the decider.

The reason beside a raised question comes from a model on the same side of the line: Opus when it
answered, otherwise the benchmark. When Jev raises a question the benchmark does not, the comment
says "no reason given" and names the disagreement.

**Only the diff is judged.** The title and body are the author's account of the change, and neither
reaches a model. That cuts both ways. A description cannot talk a verdict down, and a consequence
stated only in the title or body ("this ships on merge", "needs the paid tier") is not judged. The
models also cannot see whether the owner already asked for a change, so a pull request that adds or
changes a user-facing feature raises `product_decision` even when an issue asked for exactly that.
The diff is the author's text too. Every model is told to weigh it as data and never follow
instructions in it, and a Claude model reads it alone in the user message, apart from the questions
and rubric in the system prompt.

**What a run writes** is public on a public repository: the comment, the job summary and the
`consequential-verdict` artifact. Secret-shaped strings are redacted from the diff before a model
reads it and from a model's reasons before they are written. A failed model call is reported as a
fixed phrase, or the exception's class, its HTTP status and Anthropic's request id, never its text,
so no key and no response body is written. A Claude model's refusal is reported with its category
(`cyber`, say). Those are all there is to debug a failed call from.

The lines, the margin and the effort the Claude models answer at live in `scripts/consequential.py`
(`QUESTIONS`, `ESCALATE_MARGIN`, `CLAUDE_EFFORT`). The rubric in `assets/rubric.md` is concrete
situations, yes and no, per question; a model scores a diff against examples more consistently than
against "low/medium/high".

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
5. Make whatever merges without the owner wait for the check, which GitHub lists as
   `consequential-check`: an agent's standing permission, an auto-merge rule. As a required status
   check it also blocks the owner on a raised pull request, so give the owner a bypass or leave it
   out of the ruleset and have agents read it.
6. Open a pull request that changes only a comment. The check should pass and leave one verdict
   comment that names the head. A run that fails before its first step is the block from step 2.
   A comment that says "nothing judged" names what was missing.

**Clearing a raise.** The label outlives the push that earned it: once a head is raised, later
heads fail the check even when their own verdict is no, and the comment on such a head says the
label is why. The owner clears it by merging, or by
removing the label and re-running the check, which judges the current head again; the review queue
below does both with one button. The owner can also add the label by hand. Label changes do not start a run, so the check shows a hand-added
label only from its next run; that is why the agent rule reads the label as well as the check.

**What a run costs.** At most three model calls, not counting the retries of one that failed on an
overloaded or unreachable service. The check runs on every push and on every edit to the title,
body or base branch. An edit to the title changes nothing a model reads, but a run skipped for it
would report success and replace a failing check, so it judges again.

## The owner's review queue

A raise the owner clears by merging teaches the router nothing: the merge says the change was
acceptable, not whether the flag was wanted. `scripts/server.py` shows the labelled pull requests
one at a time on a local page and asks one question of each, so an answer costs a keystroke or two:

```bash
uv run --script scripts/server.py --repo OWNER/REPO --open
```

The page shows one pull request, the questions that raised or were too close to call, and their
reasons. **Glad this was flagged?** `y` or `n`. On yes, which reason was why: `1`–`9` tick a
reason, `a` ticks all of them, `o` adds one the check did not give. `Enter` saves and shows the
next; `Shift`+`Enter` saves and merges; `s` skips for now. The page is a plain form, so each
shortcut has a button or a field that does the same, and nothing is picked until the owner picks
it.

On save the server, as the owner:

- posts the reply the tuning step below collects, with the answer as a data line;
- changes the label. Glad: `consequential:confirmed` goes on beside `consequential`. Not glad:
  `consequential` comes off and `consequential:overruled` goes on, so the label no longer fails a
  later head that raises nothing. The check is not run again for that head, because it would raise
  it again; the head stays red, and the owner's to merge;
- merges, when asked, pinned to the head the page showed. A head that moved since the page loaded
  is refused, and so is a merge while any check other than this one is failing or still running:
  an owner's token can merge past a failing check without GitHub objecting, so the server reads
  the checks first (`--merge-despite CHECK` names another that fails by design).

An answered pull request stays in a list below, with a merge button, until it merges or its head
moves. A later head the check flags again is asked about again, with the earlier answer shown, once the
check has judged that head: until then the page counts it as waiting on the check.

A pull request whose current head raised nothing, and fails only for the label an earlier head
left, is listed apart. Its Clear label button takes the label off and runs the check again.

A run that judged nothing (a fork, an outage, a missing key) leaves no label, so it is not in the
queue; its failed check and its comment are where it shows.

Every answer, how long it took and what was done about it is appended to
`$XDG_STATE_HOME/consequential-check/decisions.jsonl` (`--state PATH`) before anything is done on
GitHub. `--on-record CMD` also pipes each record, as JSON, to a command, for a store somewhere
else. `--summary` prints how the answers fall per reason: how often each was shown, was why, was
not why, and was an unwanted flag.

`--demo` serves made-up pull requests with no network, to try the page. `--dry-run` reads the real
queue and only says what each action would do. The owner runs the server under their own GitHub
sign-in (`GH_TOKEN`, `GITHUB_TOKEN` or `gh auth token`): each answer is their label and each merge
is their merge. An agent runs it only with `--demo` or `--dry-run`. The page is served on
127.0.0.1, only to the link printed at start, which carries a random token: the page and every
action need it, so another process on the machine cannot fetch the page and act. It refuses to be
framed. A verdict is read only from the check's bot account and an answer only from the owner's,
but a workflow in the same repository posts as that bot too, so the reasons on a card are what the
check's comment says now, not proof of what the check wrote.

A repo with its own gate, comment format or merge rules passes `--adapter FILE`, a Python file
that swaps any of four small parts without editing the server: `dialects` (how a verdict comment
reads and what the reply to it looks like), `forge` (where pull requests are read and acted on),
`store` (where answers are kept) and `policy` (what an answer does). The server's docstring has the
signatures.

## Tuning from the owner's replies

The workflow keeps one verdict comment on the pull request, edited in place, with every model's
probability per question and the head it judged. When the verdict is consequential, the comment
opens with each question that raised or was too close to call. The comment ends with the same
answers as one JSON line in an HTML comment (`consequential-check-data`), which the review queue
reads, and the `consequential-verdict` artifact on each run holds them too (`questions.<id>.jev`,
`.benchmark`, `.strong`, `.final`, `.uncertain`); `decided_by` is null when no model decided. The
owner confirms or corrects the verdict with a single line, typed by hand or posted by the review
queue:

```text
consequential: right
consequential: right because hard_to_undo; other: also drops the audit index
consequential: wrong costs_money adds a nightly job against a billed API
```

A reply from the queue carries the answer as data too (`consequential-decision`): the head, the
reasons shown and the ones ticked.

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
Opus or to the owner, or the misses, say so. `CLAUDE_EFFORT` starts at `medium`, the level
Anthropic's guides start both default Claude models at. `low` costs less per run: before keeping
it, replay the corrected pull requests at it ("Run it by hand" below) and see that the verdicts
hold.

**Pin the decision model once it is tuned.** Set `JEV_MODEL` to the exact version the replies were
collected against; `jev-latest` moves with each release. A different model is a different router:
re-check it against the collected replies before switching.

## Run it by hand

To see the verdict before a push, for one pull request without installing anything, or to replay a
corrected one against a changed rubric or model, run the script from this skill or the copy a
repository keeps in `.github/consequential/`:

```bash
scripts/consequential.py --local
```

```bash
scripts/consequential.py --pr NUMBER
```

`--local` judges the working tree, committed or not, against its merge base with the default
branch (`--base REF` for another): the diff a pull request would show. It reads the rubric as the
workflow does, from the copy installed on the base, so a change cannot argue with its own rubric;
a repo without one gets the skill's default. `--pr` reads an open pull request's diff with `gh`.
Both print each question's probability against its line and whether the check would pass, and
write nothing to GitHub. `--json` prints the verdict a run would upload, and `--exit-code` exits 3
when the check would fail, for a pre-push hook. Untracked files are not in the diff until added.
The workflow's own form still works by hand: `--rubric FILE --diff-file FILE`.

It needs `uv` and makes the same model calls as a run. A preview is close, not exact: the check
judges the pushed head, and a model's answer moves a few hundredths between runs.

**Where a key is looked for.** The workflow's form reads `TYPESAFE_API_KEY` and `ANTHROPIC_API_KEY`
and nothing else: an install's keys are the ones its owner set. `--local` and `--pr` look further,
because a key may be nowhere the process can see. A cloud session's network proxy can write the
`Authorization` header itself and leave the variable a placeholder or unset, and a workstation may
keep the key in a file. For each provider they try, in order, moving on when a call is refused or
fails for a reason that could be the key's:

1. the variable above;
2. the network proxy, with a placeholder key, when `HTTPS_PROXY` is set and the variable is not;
3. the provider's other variable names (`JEV_API_KEY`, `TYPESAFE_KEY`; `CLAUDE_API_KEY`);
4. dotenv files (`.env`, `.env.local`, `.dev.vars`) in the working directory, the repo root,
   `~/.config/consequential-check/` and the home directory;
5. a one-line key file: `~/.config/typesafe/api_key`, `~/.config/anthropic/api_key`.

Places 3 to 5 are read only after a refusal, or when there was nothing to try first. The verdict
names where the accepted key came from and what was refused before it, by variable name or path
and never by value. A model that declined or gave an unusable answer is not asked again with
another key. The model that decides does not change with the key: where a Jev key is found and
none is accepted, nothing is judged, as in a run. The proxy alone is only a guess at a Jev key, so
where it holds none and an Anthropic key is set, the cheap Claude model decides, as in an install
without Jev.

`scripts/consequential.py --self-test` and `scripts/server.py --self-test` run offline: no model
calls, and GitHub stood in for by a local server.
