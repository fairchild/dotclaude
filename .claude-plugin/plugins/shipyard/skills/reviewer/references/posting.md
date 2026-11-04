# Posting a review

Write the body to a file and post the file. A body assembled inline in a shell command loses
newlines, and a long one hits argument limits in cloud sessions.

## Why REST, not `gh pr`

`gh pr review`, `gh pr comment` and `gh pr edit` go through GitHub's GraphQL API. In a cloud
session the token often carries no GraphQL scope and those commands answer `403` with a message
about the viewer, which reads like a permission problem with the pull request rather than with the
transport. The REST endpoints below work with the same token. Use them everywhere, so the seat
behaves the same on a laptop and in a cloud environment.

## The review body

```text
## Review — <n> blocking, <n> deferrable, <n> nit

<one paragraph: what this pull request is for, and whether its shape does that>

### Findings

blocking — path/to/file.ts:112 — <problem and the evidence> — <proposed fix>
deferrable — path/to/other.py:40 — <problem and the evidence> — <proposed fix>
nit — path/to/third.md:8 — <problem> — <proposed fix>

VERDICT: changes-needed — at 0123456789abcdef0123456789abcdef01234567 — 1 blocking, 1 deferrable, 1 nit

### Checkpoint

- base: <40-char SHA>
- head: <40-char SHA>
- gate: `<command>` — <result>
- tests: `<command>` — <result>
- probes: <line mutated> → <test> stayed green / went red
- CI: <check name> <conclusion>, ...
- not verified: <what, and why not>
```

One `VERDICT:` line per head, in one place. The repository's config file names which venue that
is — a conversation comment or the body of a review carrying inline findings — and the verdict goes
in that one, not both. A watcher reads both venues, so a verdict duplicated across them is two
verdicts for one head.

Name no other commit on the `VERDICT:` line. A parser takes the SHA on it as the head the verdict
binds to, and a second SHA makes the verdict ambiguous rather than wrong, which is worse.

With no findings, keep the `### Findings` heading and write `none`. A parser that sees the heading
missing cannot tell a clean review from a truncated one.

## Commands

A conversation comment — the default venue:

```bash
gh api --method POST "repos/$SHIPYARD_REPO/issues/$PR/comments" -F body=@body.md
```

A review with inline line findings, when the repository's config file asks for them. The verdict
then goes in this body rather than in a conversation comment. `commit_id` must be the head you
reviewed, and every `comments[]` entry must name a path and line that exist at that SHA:

```bash
gh api --method POST "repos/$SHIPYARD_REPO/pulls/$PR/reviews" \
  -F commit_id="$HEAD" -F event=COMMENT -F body=@body.md \
  -F 'comments[][path]=src/thing.ts' -F 'comments[][line]=112' -F 'comments[][body]=blocking — ...'
```

`event=COMMENT` always. The seat does not approve and does not request changes through GitHub's
review state: the verdict line carries that, and a GitHub approval would read as merge authority
the seat does not have.

A reply in an existing thread, for giving an open finding its disposition — the numeric comment ID,
not the thread's node ID:

```bash
gh api --method POST "repos/$SHIPYARD_REPO/pulls/$PR/comments" -F in_reply_to="$COMMENT_ID" -F body=@reply.md
```

Resolving a thread is the one operation with no REST endpoint, so it goes through GraphQL
`resolveReviewThread` and may fail in a cloud session. When it does, reply in the thread naming the
fixing commit and say in the checkpoint that the thread is unresolved — a reply the author can see
beats a resolution the seat only believes happened.

## Reading state back

After posting, read the comment back and confirm its `VERDICT:` line carries the SHA you meant:

```bash
gh api --paginate "repos/$SHIPYARD_REPO/issues/$PR/comments" --jq '.[].body' | grep '^VERDICT:' | tail -1
gh api --paginate "repos/$SHIPYARD_REPO/pulls/$PR/reviews" --jq '.[].body' | grep '^VERDICT:' | tail -1
```

`--paginate` and `tail -1`, not `.[-1]` on one page: past thirty items the default page no longer
holds the last one, so an unpaginated read-back checks a body that is not the one you just posted
and reports success for it.

Read back the venue you posted to. A verdict is posted or it did not happen.
