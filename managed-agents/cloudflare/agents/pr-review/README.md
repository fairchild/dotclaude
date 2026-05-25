# pr-review

The first deployed agent on top of this runtime. Reviews pull requests in the dotclaude repo.

> **V1 status:** the agent definition, system prompt, and trigger workflow ship complete and the GitHub tools (`pr_diff`, `pr_files`, `pr_post_review`) are wired through the runtime's tool registry. The end-to-end review path can't run yet because the runtime's per-session agent loop is a scaffold (see [`../../runtime/isolate/runner.ts`](../../runtime/isolate/runner.ts)). When that lands, this agent's tool calls dispatch through to the GitHub API via the egress layer.

## What it does

Triggered on `pull_request` events (opened, synchronize, reopened). For each trigger, a session is created against the self-hosted environment with metadata identifying the PR. The agent:
1. Calls `pr_diff` to read the unified diff
2. Calls `pr_files` if it needs per-file context
3. Applies the review heuristics in `system-prompt.md`
4. Calls `pr_post_review` once with verdict + body + optional inline comments

GitHub-specific code lives in two places:
- This agent definition (`system-prompt.md` tells the agent what to look for and how to call the tools)
- [`../../runtime/tools/github.ts`](../../runtime/tools/github.ts) (the three tool implementations)

No shell, no `gh` CLI. Tools hit `api.github.com` directly; the egress layer injects the auth header by reference name so the agent never sees the token.

## Files

- `agent.json` — agent definition POSTed to `/v1/agents`
- `system-prompt.md` — review heuristics and tool-call instructions
- `register.sh` — create/update the agent against Anthropic's API
- (workflow lives at `.github/workflows/dotclaude-pr-review.yml`)

## Setup

Prerequisites: the runtime is deployed (see [`../../README.md`](../../README.md)), an Anthropic API key is available locally.

```bash
cd managed-agents/cloudflare/agents/pr-review
export ANTHROPIC_API_KEY=sk-ant-...
./register.sh                                      # prints agent_id on success
```

Then edit `.github/workflows/dotclaude-pr-review.yml` and paste the printed `agent_id` and the environment id from your deployed runtime. Add these as repo secrets/vars:
- `ANTHROPIC_API_KEY` (secret) — used by the workflow to create sessions
- `PR_REVIEW_AGENT_ID` (var) — output of `register.sh`
- `MANAGED_AGENTS_ENVIRONMENT_ID` (var) — your self-hosted env id

Wire the GitHub token through the egress layer so the agent's tools can authenticate. From the runtime directory:

```bash
cd managed-agents/cloudflare
wrangler secret put GITHUB_PR_TOKEN < <(printf '%s' "<token>")
# or for non-secret KV values:
wrangler kv key put --binding=SECRETS GITHUB_PR_TOKEN '<token>'

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

Use a PAT or GitHub App installation token with `pull_requests: write` and `contents: read` on the dotclaude repo.

## Manual trigger

To replay a review on a PR:

```bash
gh workflow run dotclaude-pr-review.yml -f pr=<number>
```
