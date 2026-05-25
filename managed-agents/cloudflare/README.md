# cloudflare — self-hosted environment for Claude managed agents on Cloudflare Workers

A self-contained Cloudflare Worker that implements Anthropic's [self-hosted sandbox protocol](https://platform.claude.com/docs/en/managed-agents/self-hosted-sandboxes). It claims work items from a Claude environment, executes tool calls in a sandboxed isolate, and posts results back. Outbound network from tools passes through an egress layer that injects credentials by reference name — agent code never sees secret values. Per-agent email arrives through Cloudflare Email Routing.

The layout mirrors [`cloudflare/claude-managed-agents`](https://github.com/cloudflare/claude-managed-agents) where the scopes overlap (see [Cross-walk to upstream](#cross-walk-to-upstream) below). Things outside V1 scope (microVM sandbox, dashboard, D1, snapshots, browser/image tools, VPC) are absent rather than stubbed.

## What it deploys

A single Cloudflare Worker with:
- `POST /webhooks` — receives Anthropic session-status webhook deliveries, verifies the Standard Webhooks signature, dispatches into the work-claim loop
- `email()` — receives inbound mail from Cloudflare Email Routing, parses the agent ID from the local-part, stores the message
- An isolate runner that spawns a per-session sandbox via Cloudflare Worker Loader (with an in-process fallback for V1 smoke testing)
- A KV-backed egress layer (`SECRETS`, `EGRESS_POLICIES` namespaces) that injects authorization headers when a rule matches the outbound host

The first deployed agent on top of this infrastructure is a PR reviewer for the dotclaude repo. The agent definition and its trigger live in [`agents/pr-review/`](./agents/pr-review).

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
│   ├── isolate/              per-session sandbox via Worker Loader
│   ├── egress/               KV-backed policy + secret store
│   └── tools/                custom tool registry + generic examples
├── agents/
│   └── pr-review/            the first deployed agent
├── tests/                    vitest covering deterministic parts
├── scripts/                  setup helpers
└── docs/                     architecture + how-tos
```

## Quick deploy

```bash
cd managed-agents/cloudflare
bun install
wrangler login                                    # if not already
./scripts/setup.sh                                # creates KV namespaces, prints binding ids
```

Then, manually:
1. In the Anthropic console: create a self-hosted environment, generate the environment key
2. `wrangler secret put ANTHROPIC_ENVIRONMENT_KEY`
3. `wrangler secret put ANTHROPIC_WEBHOOK_SIGNING_KEY`
4. `wrangler deploy`
5. In the Anthropic console: add `https://<your-worker>.workers.dev/webhooks` as a webhook subscription for session events
6. In the Cloudflare dashboard: enable Email Routing on a domain, point a catch-all (e.g. `agent-*@yourdomain`) at the worker's email handler

To deploy the PR review agent on top:
```bash
cd agents/pr-review
./register.sh                                     # POST agent.json to /v1/agents, prints agent_id
# paste agent_id and env_id into .github/workflows/dotclaude-pr-review.yml
```

## Local development

```bash
cp .dev.vars.example .dev.vars
# fill in real values for ANTHROPIC_ENVIRONMENT_KEY etc.
bun run dev                                       # wrangler dev
bun run test                                      # vitest
```

## Docs

- [Architecture](./docs/architecture.md) — the work-queue protocol and how the Worker implements it
- [Isolate vs VM sandboxes](./docs/isolate-vs-vm-sandboxes.md) — when to pick which (we ship isolate in V1)
- [Adding custom tools](./docs/adding-custom-tools.md) — the `{schema, handler}` pattern
- [Applying egress policies](./docs/applying-egress-policies.md) — header injection by reference name
- [Agent email](./docs/agent-email.md) — per-agent inbound routing
- [Securing access](./docs/securing-access.md) — Cloudflare Access in front of the worker

## Cross-walk to upstream

[`cloudflare/claude-managed-agents`](https://github.com/cloudflare/claude-managed-agents) is the full-feature upstream we model on. Where we have a file with the same role, the name matches.

| Upstream | Ours | Notes |
|---|---|---|
| `src/index.ts` | `runtime/index.ts` | Same role |
| `src/webhooks.ts` | `runtime/webhooks.ts` | Same protocol |
| `src/anthropic.ts` | `runtime/anthropic.ts` | Subset of endpoints |
| `src/heartbeat.ts` | `runtime/heartbeat.ts` | Same idea |
| `src/isolate/*` | `runtime/isolate/*` | Same names, smaller surface |
| `src/egress/*` | `runtime/egress/*` | All five files |
| `src/email-handler.ts` | `runtime/email-handler.ts` | Receive-only in V1 |
| `src/tools/custom-tools.ts` | `runtime/tools/custom-tools.ts` | Two generic examples |
| `src/microvm/*` | — | Out of V1 |
| `src/api/*` | — | No admin API |
| `frontend/*` | — | No dashboard |
| `migrations/*` | — | No D1 |
| `Dockerfile` | — | No microVM |
| — | `agents/pr-review/` | Our addition: the actually-deployed first agent |

## License

Apache 2.0 — consistent with the rest of dotclaude.
