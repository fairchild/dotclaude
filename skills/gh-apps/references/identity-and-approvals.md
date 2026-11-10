# Identity and approvals

What a post on GitHub proves about who made it, and when a bot's approval counts toward a
required review. Findings come from one test on a throwaway private repository on 10 Nov 2026,
with a private app named `yard-surveyor` and a default branch that required one approval and
code-owner review. Each claim is marked:

- **observed**: seen in that test or in a repository's own data
- **documented**: read in GitHub's documentation, not tested
- **untested**: expected, not yet checked

## Four ways to post

| How the post is made | Shown as | App mark | Approval counts | Satisfies a code owner |
|---|---|---|---|---|
| Typed on github.com | the user | none | yes | yes, if listed |
| `gh` CLI or a personal token | the user | none | yes | yes, if listed |
| An app acting for a user (user-to-server token) | the user, with the app's badge on the avatar | the app's name | yes (untested) | yes, if listed (untested) |
| An app as itself (installation token) | `slug[bot]` | `user.type` is `Bot` | only with `contents: write` | never |

The first two rows cannot be told apart (observed). An agent on a laptop using the owner's `gh`
login looks exactly like the owner. Telling them apart takes a separate login for agents, not a
field.

## Fields a script reads

- **Issues and pull requests**: `performed_via_github_app` names the app that created the item
  (observed). It is null for anything typed on the site or posted with the CLI or a personal
  token.
- **Reviews**: `user.type == "Bot"` and a login ending in `[bot]` (observed). On the bot's
  reviews `performed_via_github_app` printed empty and `author_association` was `NONE`, so test
  `user.type` for reviews, not the app field.
- **Issue comments**: `performed_via_github_app` is in the documented schema; whether it is filled
  for a comment posted by an app acting for a user is untested.

## The mark is one-way

A present mark means an app posted. An absent mark means a person or a CLI login, and nothing in
the data separates those two (observed). In one repository's history, items with no app recorded
were agent-written by their titles; the likely source was agents using the owner's `gh` login.

## Vendor integrations post as you

Claude's and Codex's GitHub integrations both attributed their posts to the user account that
connected them, with their app's mark (observed). Neither gives a separate bot identity. For a bot
identity, register your own app and post with an installation token.

## When a bot's approval counts

GitHub counts approvals from "reviewers with write permissions"
([docs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches#require-pull-request-reviews-before-merging));
the docs do not say whether a bot qualifies. The test settled it (observed):

| Step | PR adding CODEOWNERS | PR touching an owned folder | PR touching a plain file |
|---|---|---|---|
| Bot approves; app has `contents: read` | blocked | blocked | blocked |
| App raised to `contents: write`, no new review | clean | clean | clean |
| CODEOWNERS merged to the default branch | merged | blocked | clean |

So `pull_requests: write` alone records the approval and does not count it. Raising the app to
`contents: write` makes the same approval count, with no new review posted. The price is that an
app whose approval counts can also push; separation from whoever merges rests on who holds the
private key and on a rule that sends every change to the default branch through a pull request.

## A bot never satisfies a code owner

Once CODEOWNERS was on the default branch, the bot's approval stopped being enough for the owned
folder and stayed enough for the plain file (observed). That gives two tiers GitHub enforces:
paths a bot may approve, and paths that always need a person listed in CODEOWNERS.

The pull request author cannot approve their own pull request, so if agents open pull requests
under the owner's account, the owner's approval can never gate them.

## Machine accounts

GitHub's terms allow one free machine account besides a personal account, used only for automation
(documented). The [Terms of Service](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service#b-account-terms),
section B, describe it as "used exclusively for performing automated tasks". A second agent
identity has to be an app, a paid account, or a shared machine account told apart by the app mark.

## How to check

Ruleset shape used in the test: one required approval, code-owner review on.

```bash
gh api -X POST repos/OWNER/REPO/rulesets --input - <<'JSON'
{"name": "require-review", "target": "branch", "enforcement": "active",
 "conditions": {"ref_name": {"include": ["~DEFAULT_BRANCH"], "exclude": []}},
 "rules": [{"type": "pull_request", "parameters": {
   "required_approving_review_count": 1, "require_code_owner_review": true,
   "dismiss_stale_reviews_on_push": false, "require_last_push_approval": false,
   "required_review_thread_resolution": false}}]}
JSON
```

Read-outs after the bot approves:

```bash
gh api repos/OWNER/REPO/pulls/N/reviews --jq '.[] | [.user.login, .user.type, .state] | @tsv'
gh pr view N -R OWNER/REPO --json mergeStateStatus,reviewDecision
```

`mergeStateStatus` reads `BLOCKED` or `CLEAN`. Rulesets also carry
`require_extra_approval_for_unattributed_changes` by default; it applies only when Copilot opens
the pull request, so it does not explain a blocked bot approval.

## Still open

All untested; record a result here as observed, with the date.

- **Narrowed token.** With the app holding `contents: write`, does a token minted with
  `token --permissions pull_requests:write` still produce a counting approval? If so, a reviewer
  can be handed a token that approves and cannot push. This is the most useful open question.
- **Issue comments.** Do comments posted by an app acting for a user carry
  `performed_via_github_app`?
- **App acting for a user.** Does its approval count as that user's, and satisfy a code owner?
  Expected yes.
- **Requiring the bot specifically.** The test rule asked for one approval from someone other than
  the author, which either the bot or the owner satisfies.
- **Cloud sessions.** Can a cloud agent session post as the bot? The key lives on one machine, and
  cloud sessions may reach GitHub through a proxy with its own credentials.
