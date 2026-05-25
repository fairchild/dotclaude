# pr-review

The first deployed agent on top of this runtime. Reviews pull requests in the dotclaude repo.

## What it does

Triggered on `pull_request` events (opened, synchronize, reopened). For each trigger, a session is created against our self-hosted environment with metadata identifying the PR. The agent:
1. Reads the PR's diff
2. Reads referenced files at the PR's head SHA
3. Applies the review heuristics in `system-prompt.md`
4. Posts review comments back via `gh pr review` / `gh api`

The agent uses only the generic runtime infrastructure — egress for GitHub token injection, the `http_get` custom tool when needed, the isolate's bash equivalent for `gh` calls. No GitHub-specific code lives in `runtime/`; everything specific to PR review is here.

## Files

- `agent.json` — the agent definition POSTed to `/v1/agents`
- `system-prompt.md` — review heuristics and output format
- `register.sh` — one-shot create/update of the agent
- (workflow lives at `.github/workflows/dotclaude-pr-review.yml`)

## Setup

Prerequisites: the runtime is deployed (see [`../../README.md`](../../README.md)), an Anthropic API key is available locally.

```bash
cd managed-agents/cloudflare/agents/pr-review
export ANTHROPIC_API_KEY=sk-ant-...
./register.sh                                      # prints agent_id on success
```

Then edit `.github/workflows/dotclaude-pr-review.yml` and paste the printed `agent_id` and the environment id from your deployed runtime. Add `ANTHROPIC_API_KEY` and `GH_PR_REVIEW_TOKEN` as repo secrets.

The GH token configuration also requires an egress policy and secret in the runtime — register one as follows (replace `<token>` with a GitHub PAT or app token scoped to `pull_request: write`):

```bash
wrangler secret put GITHUB_PR_TOKEN < <(echo -n "<token>")
wrangler kv key put --binding=EGRESS_POLICIES 'policy:github' '{
  "id": "github",
  "host": "api.github.com",
  "action": {
    "type": "inject_header",
    "header": "authorization",
    "value_template": "Bearer ${ref:GITHUB_PR_TOKEN}"
  }
}'
wrangler kv key put --binding=EGRESS_POLICIES 'policies:index' '["github"]'
```

## Manual trigger

To replay a review on a PR locally:

```bash
gh workflow run dotclaude-pr-review.yml -f pr=<number>
```
