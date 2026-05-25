# cloudflare — self-hosted environment for Claude managed agents on Cloudflare Workers

A self-contained Cloudflare Worker scaffolded to implement Anthropic's [self-hosted sandbox protocol](https://platform.claude.com/docs/en/managed-agents/self-hosted-sandboxes). The webhook surface, egress layer, custom tool registry, and per-agent email handler are wired and tested; the per-session agent loop body lands in V1.1 once the protocol's tool-delivery surface is verified against the live beta API and the Cloudflare Worker Loader binding shape is confirmed.

The layout mirrors [`cloudflare/claude-managed-agents`](https://github.com/cloudflare/claude-managed-agents) where scopes overlap (see [Cross-walk to upstream](#cross-walk-to-upstream)). Things outside V1 scope (microVM sandbox, dashboard, D1, snapshots, browser/image tools, VPC) are absent rather than stubbed.

## V1 status

| Piece | Status |
|---|---|
| `runtime/index.ts` — `fetch` + `email` entry exports | ✅ wired |
| `runtime/webhooks.ts` — Standard Webhooks signature verify, dispatch | ✅ wired |
| `runtime/anthropic.ts` — Work API client | ⚠️ `stop` endpoint is documented; the rest are inferred from SDK behavior and need verification |
| `runtime/heartbeat.ts` — per-session claim + keepalive | ⚠️ structural seam in place; poll-after-webhook has known issues (see file comments) |
| `runtime/isolate/runner.ts` — per-session sandbox | ⚠️ scaffold only — logs and returns without executing tool calls |
| `runtime/egress/*` — KV-backed credential injection | ✅ wired + tested |
| `runtime/tools/*` — registry + echo/http_get + pr_diff/pr_files/pr_post_review | ✅ wired + tested |
| `runtime/email-handler.ts` — per-agent inbound mail | ✅ wired + tested |
| `agents/pr-review/` — agent definition, system prompt, trigger workflow | ✅ wired (will execute once `runner.ts` lands) |

24 vitest tests pass against the deterministic surface (egress matching, secret resolution, tool schemas, address parsing).

## Layout

```
cloudflare/
├── README.md                 (you are here)
├── package.json
├── tsconfig.json
├── wrangler.jsonc
├── worker-configuration.d.ts
├── .dev.vars.example
├── runtime/                  the Cloudflare Worker source
│   ├── index.ts              fetch() + email() exports
│   ├── env.d.ts
│   ├── webhooks.ts           Standard Webhooks signature verify + dispatch
│   ├── anthropic.ts          fetch wrapper over the Environments Work API
│   ├── heartbeat.ts          claim + keep-alive loop for a single work item
│   ├── helpers.ts
│   ├── email-handler.ts      per-agent email routing entry
│   ├── isolate/              per-session sandbox (V1 scaffold)
│   ├── egress/               KV-backed policy + secret store
│   └── tools/                custom tool registry + generic + GitHub tools
├── agents/
│   └── pr-review/            the first deployed agent
├── tests/                    vitest covering the deterministic surface
├── scripts/                  setup helpers
└── docs/                     architecture + how-tos
```

## Quick deploy (scaffold only)

You can deploy V1 today; the worker accepts webhooks and routes email, but sessions will be claimed-then-stopped until the runner body lands. Useful for confirming the deploy path, secrets, KV bindings, and Email Routing setup.

```bash
cd managed-agents/cloudflare
bun install
wrangler login                                    # if not already
./scripts/setup.sh                                # creates KV namespaces, prints binding ids
```

Then, manually:
1. In the Anthropic console: create a self-hosted environment, generate the environment key
2. `wrangler secret put ANTHROPIC_ENVIRONMENT_ID`
3. `wrangler secret put ANTHROPIC_ENVIRONMENT_KEY`
4. `wrangler secret put ANTHROPIC_WEBHOOK_SIGNING_KEY`
5. `wrangler deploy`
6. In the Anthropic console: add `https://<your-worker>.workers.dev/webhooks` as a webhook subscription for session events
7. In the Cloudflare dashboard: enable Email Routing on a domain, point a catch-all (e.g. `agent-*@yourdomain`) at the worker's email handler

To deploy the PR review agent on top (see [`agents/pr-review/README.md`](./agents/pr-review/README.md) for full instructions):

```bash
cd agents/pr-review
./register.sh                                     # POST agent.json, prints agent_id
# paste agent_id and env_id into .github/workflows/dotclaude-pr-review.yml
# add the GitHub egress policy + token (see the pr-review README)
```

## Local development

```bash
cp .dev.vars.example .dev.vars
# fill in real values for ANTHROPIC_ENVIRONMENT_KEY etc.
bun run dev                                       # wrangler dev
bun run test                                      # vitest
bun run typecheck                                 # tsc --noEmit
```

## Docs

- [Architecture](./docs/architecture.md) — the work-queue protocol and how the Worker implements it
- [Isolate vs VM sandboxes](./docs/isolate-vs-vm-sandboxes.md) — when to pick which (V1 ships isolate path; runner is scaffold)
- [Adding custom tools](./docs/adding-custom-tools.md) — the `{schema, handler}` pattern
- [Applying egress policies](./docs/applying-egress-policies.md) — header injection by reference name
- [Agent email](./docs/agent-email.md) — per-agent inbound routing
- [Securing access](./docs/securing-access.md) — Cloudflare Access in front of the worker

## Cross-walk to upstream

[`cloudflare/claude-managed-agents`](https://github.com/cloudflare/claude-managed-agents) is the full-feature upstream we model on. Where we have a file with the same role, the name matches. The mirror is structural — upstream's files implement behavior our scaffold doesn't yet match.

| Upstream | Ours | Status |
|---|---|---|
| `src/index.ts` | `runtime/index.ts` | wired |
| `src/webhooks.ts` | `runtime/webhooks.ts` | wired |
| `src/anthropic.ts` | `runtime/anthropic.ts` | partial (only `stop` verified) |
| `src/heartbeat.ts` | `runtime/heartbeat.ts` | scaffold |
| `src/isolate/runner.ts` | `runtime/isolate/runner.ts` | scaffold |
| `src/isolate/adapter.ts` | `runtime/isolate/adapter.ts` | wired (used by V1.1 runner body) |
| `src/egress/*` | `runtime/egress/*` | wired |
| `src/email-handler.ts` | `runtime/email-handler.ts` | wired |
| `src/tools/custom-tools.ts` | `runtime/tools/custom-tools.ts` | wired |
| `src/microvm/*` | — | out of V1 |
| `src/api/*` | — | no admin API |
| `frontend/*` | — | no dashboard |
| `migrations/*` | — | no D1 |
| `Dockerfile` | — | no microVM |
| — | `runtime/tools/github.ts` + `agents/pr-review/` | our addition: the first deployed agent and its tools |

## License

Apache 2.0 — consistent with the rest of dotclaude.
