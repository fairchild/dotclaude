# Backend: gitea

Storage for projects whose `backlog/AGENTS.md` declares `## Backend: gitea` — work lives as issues on a self-hosted [Gitea](https://about.gitea.com/) instance (a GitHub-compatible forge). This is the `github-issues` backend retargeted at Gitea: identical verb semantics, worklog format, and branch-based claim resolution; only the transport changes (`tea api` instead of `gh`) and the identity/auth seam (a named git remote + a `tea` login instead of `gh`'s ambient auth).

Verb semantics: `../worker.md`. Implementation: `../../scripts/backlog-gitea.sh`.

## When to pick this backend

- Your code already lives on a self-hosted Gitea (homelab, air-gapped, or a team that left GitHub) and the issues there are the real queue.
- Multi-machine work needs a shared in-flight set without a public GitHub repo.
- You want the same label/comment protocol as the `github-issues` backend, on infrastructure you control.

For local-only single-machine work, `maildir-git` is simpler; for multi-worktree on one machine, `maildir-shared`. If the work lives on GitHub, use `github-issues` — Gitea and GitHub backends don't federate (a task lives in exactly one tracker).

## The non-hardcoded identity seam

The instance URL and token live in two machine-local, never-committed places, so the skill never hardcodes either:

| Value | Where it lives | Committed? |
|---|---|---|
| server URL + token | `tea`'s login config (`~/.config/tea/config.yml`), set once via `tea login add` | No |
| owner/repo + host | a named git remote (default `gitea`) in `.git/config` | No |
| which remote / which login | `## Gitea` `remote:` / `login:` in `backlog/AGENTS.md` | Names only — nothing server-specific |

`tea api` reads the URL and token from the resolved login, so the script issues authenticated requests without ever seeing the secret. This is the same trick `github-issues` uses — it never names the GitHub repo because `gh` derives identity from `origin` — taken one step further: even the host stays out of the committed tree.

**Resolution precedence** (in `resolve_gitea`):
- owner/repo — `GITEA_REPO` env → `## Gitea repo:` → parsed from the `gitea` remote URL
- login — `GITEA_LOGIN_OVERRIDE` env → `## Gitea login:` → tea discovers it from the remote's host
- remote — `## Gitea remote:` → `gitea`

**Wiring a machine** (once):

```bash
git remote add gitea http://your-gitea:3000/<owner>/<repo>.git
tea login add --name homelab --url http://your-gitea:3000 --token <token>
# generate the token in Gitea: Settings → Applications → Generate New Token
# (scopes: read/write repository + issue)
```

`tea` is Gitea's official CLI — install from <https://gitea.com/gitea/tea/releases> or `brew tap gitea/tea https://gitea.com/gitea/homebrew-tea.git && brew install tea`. (The tap is hosted on gitea.com, not GitHub.) `tea api` and label add/remove need **tea ≥ 0.14**.

---

# The protocol

Gitea issues *are* the queue — the repo's open issues are the backlog, holistically. Anything open is takeable; non-conformant issues get triaged when a worker encounters them. There's no marker label gating membership. The local repo holds only `backlog/AGENTS.md` + `backlog/ROADMAP.md`.

## State mapping

The pipeline declared in `backlog/AGENTS.md` (default `todo → doing → done`) is the state machine. Each in-flight stage maps to a label; `advance` walks the issue stage by stage, closing it at `done`.

| State    | open/closed | labels                  |
|----------|-------------|-------------------------|
| todo     | open        | no in-flight label      |
| doing    | open        | `doing` label           |
| done     | closed      | no `failed` label       |
| failed   | closed      | `failed` label          |

Extra in-flight stages (`todo → doing → reviewing → done`) get an extra label, same as `github-issues`. Label names default to the state name and are configurable via `## Pipeline` + `## Labels` (set at setup with `--pipeline=` / `--label-<state>=` / `--failed-label=`).

**Gitea has no `completed` vs `not planned` close reason.** `cancel` and ordinary `done` both just close the issue; the worklog line (`cancelled` vs `advanced to=done`) is the sole discriminator — which `status` already keys on.

## Identifiers, worklog, claim resolution

Identical to `github-issues`: tasks are referenced by issue number (`take 42` / `take #42`); every transition is one comment shaped `- <ISO-8601 ts> <verb> [args] | <trail>`; the **branch** is the claim identity (earliest `advanced to=<first-stage>` since the last `retried`, overridden by a later `rescued`). See `github-issues.md` for the full worklog table and resolution rules — the bytes are the same; only the API posting them differs.

## Operating directly via `tea`

The protocol is operable without the skill. Substitute your configured label names if you changed them.

**Add a task:**
```bash
tea api -X POST /repos/{owner}/{repo}/issues -d '{"title":"rewrite-auth-middleware","body":"...\n\n---"}'
```

**Claim it:**
```bash
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ); BR=$(git branch --show-current)
tea api -X POST /repos/{owner}/{repo}/issues/42/comments \
  -d "{\"body\":\"- $TS advanced to=doing claimer=jane@laptop branch=$BR\"}"
tea issues edit 42 --add-labels doing
# verify you won: earliest `advanced to=doing` since the last `retried`,
# overridden by any later `rescued` — if that line's branch= isn't yours, back off.
tea api /repos/{owner}/{repo}/issues/42/comments | jq -r 'sort_by(.created_at)|.[].body'
```

**Progress / done / cancel / fail** mirror the `github-issues` recipes — post a comment, mutate labels, and `tea issues close 42` (no reason argument). `{owner}`/`{repo}` in a `tea api` path are filled from the current repo context; the script passes explicit paths instead.

---

# The script (one implementation of the protocol)

`backlog-gitea.sh` automates the patterns — priority-ranked auto-pick, race-resolution at claim time, status counts. Everything below the transport is copied from `github-issues.sh` because it operates on comment-body strings + `lib.sh` helpers.

## Transport

Every data operation goes through one chokepoint, `gitea_api <METHOD> <path>` → `tea api -X <METHOD> <auth> <path>`, where `<auth>` is `--login <name>` (if declared) or `--remote gitea` (tea matches the remote's host to a login). `gitea_api_list` paginates (Gitea caps `limit` at 50 — walking pages is mandatory for correctness). Labels are applied/removed by id (the remove endpoint takes an id, not a name) via a cached name→id map; label *creation* is check-then-create (Gitea has no upsert).

## How each verb interacts with `tea`

| Verb | calls |
|---|---|
| `setup` | requires a `gitea` remote (parses owner/repo from it) + a working tea login (smoke-reads `/repos/{owner}/{repo}`); creates one label per in-flight stage + `failed`; writes AGENTS.md (`## Gitea` carries only remote/login names — never the host/token) + ROADMAP skeleton + commits. Flags: `--remote=`, `--login=`, `--pipeline=`, `--label-<state>=`, `--failed-label=`, `--claim-label=` |
| `add` | `POST /repos/{o}/{r}/issues` → prints the new issue's `html_url` |
| `take` | rank open, unlabelled issues (`?state=open&type=issues`, jq by body `priority:` + recency) or validate an explicit number → post `advanced to=<first>` comment → add the stage label → re-read worklog; if the winning `branch=` isn't ours, exit with `claim conflict on #N` |
| `advance` | reads `.state` + labels; todo → `take`; intermediate → post + swap labels; to `done` → post `advanced to=done [\| PR=<url>]` (PR via `gh pr view` if available), remove label, `PATCH {"state":"closed"}` |
| `progress` | find the issue this branch claimed (scan open in-flight issues, match by `claim_winner_branch`) → post `progress` comment |
| `cancel` / `fail` | post `cancelled`/`failed` comment, remove the in-flight label, (`fail` adds `failed`), `PATCH {"state":"closed"}` |
| `rescue` | assert open; require a prior claim line; compare last-activity timestamp against the body's `timeout:`; post `rescued`; re-verify |
| `retry` | require the `failed` label; remove it; `PATCH {"state":"open"}`; post `retried` |
| `status` | one paginated `?state=all&type=issues`; jq buckets every issue into canonical state names |
| `maintain` | advisory message |

## Gotchas (Gitea ≠ GitHub)

- **Pagination is mandatory** — Gitea list endpoints cap at `limit=50`; `gitea_api_list` walks pages. Forgetting this silently drops issues past the first page.
- **`type=issues`** on list endpoints — Gitea returns PRs too otherwise.
- **Labels by id for removal** — `DELETE /issues/{n}/labels/{id}` needs the numeric id; the script caches the repo's labels and resolves name→id. Adding accepts names on Gitea ≥ 1.20 but the script uses ids both ways for symmetry.
- **No close reason** — `PATCH {"state":"closed"}`; the worklog verb discriminates cancel vs done.
- **Auth header** is `Authorization: token <T>`, but `tea api` handles that — the script never builds it.

## What this backend deliberately doesn't do

- **Cross-tracker federation** — a task lives in one tracker; mixing gitea with maildir-* or github-issues for one project is out of scope.
- **Gitea-native PR discovery** — `advance` best-effort reads a PR url via `gh pr view` (useful when code is on GitHub but the backlog is on Gitea); discovering a *Gitea* PR for the current branch is out of scope for v1, so the `PR=` trail is simply omitted when empty.
- **Offline queueing** — if `tea`/the instance is unreachable, verbs fail loudly; there's no local cache.

## Migration (sketch — not yet implemented)

From maildir-* to gitea: for each `todo/` file `POST` an issue (title=slug, body=spec); for `doing/` also post the claim comment + add the label; for `done/` replay the worklog lines as comments + close. The replay is load-bearing — claimer/branch/timestamp metadata must survive. Keep the old tree under `.backlog-archive/` rather than deleting.

## Test coverage

`scripts/test-gitea.sh` runs the verbs offline against an embedded mock `tea` — the full cycle (setup → add → take → progress → advance→done), the branch-based claim conflict, fail/retry, rescue's timeout refusal, and the pagination loop (a server whose page cap is below the requested limit). It's kept out of `scripts/test.sh` so gitea tests don't run on maildir-only changes.

A mock validates the script against its own assumptions about the API, not against Gitea. The real-instance assumptions — label color format, label-by-id add/remove on 1.26, `tea api` auth resolution, `type=issues` PR exclusion — need a one-time live smoke, tracked in `backlog/todo/gitea-backend-test-harness-followup.md`.
