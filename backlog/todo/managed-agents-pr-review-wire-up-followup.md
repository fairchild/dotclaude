---
priority: 2
---

# managed-agents/cloudflare — wire pr-review for a real PR run

## Problem Statement

The pr-review agent is fully scaffolded (`agents/pr-review/agent.json` + `system-prompt.md` + `register.sh` + `.github/workflows/dotclaude-pr-review.yml`), but it has never reviewed a real PR because three connections are missing. Each was discovered during V1.1's L4 validation and is documented but not done.

The V1 PR (#187) ships verified protocol + V1.1 agent loop. This task finishes Tier 3 of the verification ladder — the actual deployed agent posting a real review.

## What needs to happen

**1. Fix the `tools` shape in `agents/pr-review/agent.json`.** It currently uses string names:

```json
"tools": ["pr_diff", "pr_files", "pr_post_review", "http_get"]
```

`/v1/agents` returns `400: tools[0]: must be an object`. Replace with the verified shape:

```json
"tools": [
  { "type": "custom", "name": "pr_diff", "description": "…", "input_schema": { … } },
  { "type": "custom", "name": "pr_files", "description": "…", "input_schema": { … } },
  { "type": "custom", "name": "pr_post_review", "description": "…", "input_schema": { … } },
  { "type": "custom", "name": "http_get", "description": "…", "input_schema": { … } }
]
```

The schemas live in `runtime/tools/github.ts` (Zod) and `runtime/tools/custom-tools.ts` (`http_get`). Convert each to a JSON Schema. Consider a small helper in `scripts/ops.ts agent register` that generates the JSON Schema from the Zod definitions so the source of truth stays in one place.

**2. Set up the GitHub egress policy on the deployed worker.** Generate a PAT (or App installation token) with `pull_requests: write` and `contents: read` on `fairchild/dotclaude`. Push via `bun run push-keys` extended to accept a `GITHUB_PR_TOKEN`, then write the egress policy:

```bash
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

**3. Configure the GH Action workflow.** In `fairchild/dotclaude` repo settings:
- Secret: `ANTHROPIC_API_KEY`
- Vars: `PR_REVIEW_AGENT_ID` (from step 1's register output), `MANAGED_AGENTS_ENVIRONMENT_ID` (`env_01KabR6oarLjCHEJHRnpbEbg`)

**4. Open a test PR and observe the full flow.** The workflow fires on `pull_request` open/sync; session created → webhook to worker → poll → reconcile (or stream) → dispatch `pr_diff` → dispatch `pr_files` → reason → dispatch `pr_post_review` → review comment lands.

## Acceptance criteria

- A real PR in dotclaude receives an automated review from the agent
- `bun run verify` continues to pass against the deployed worker
- The egress logs (visible in `wrangler tail`) show `egress.injected` for `api.github.com` calls
- The agent's response uses the verdict format from `agents/pr-review/system-prompt.md` (✅/💬/🛑 first line)

## Pointers

- `managed-agents/cloudflare/agents/pr-review/` — agent + workflow
- `managed-agents/cloudflare/runtime/tools/github.ts` — tool implementations + Zod schemas
- `managed-agents/cloudflare/docs/applying-egress-policies.md` — policy mechanics
- `managed-agents/cloudflare/README.md` — Tier 3 verification section
