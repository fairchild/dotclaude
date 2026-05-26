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

42 vitest tests pass — pure-function tests (egress matching, secret resolution, tool schemas, address parsing) plus Worker integration tests via `@cloudflare/vitest-pool-workers` (webhook signature verify against the real `/webhooks` route, `/healthz`, email handler with KV writes, egress fetch with header injection through mocked outbound, custom tool dispatch end-to-end including GitHub tools).

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
├── scripts/                  bootstrap, ops, smoke
└── docs/                     architecture + how-tos
```

## Two trust zones

Two kinds of credential, two homes:

| Key | Scope | Lives in | Used by |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Organization-wide | `~/.env` (or wherever `OPS_ENV_FILE` points) | Developer-side ops scripts only (`scripts/ops.ts`, `register.sh`, GH Action). **Never** the worker. |
| `ANTHROPIC_ENVIRONMENT_KEY` | One environment | `.dev.vars` (dev) / `wrangler secret` (prod) | The worker — authorizes `/work/*` endpoints |
| `ANTHROPIC_WEBHOOK_SIGNING_KEY` | One webhook subscription | `.dev.vars` (dev) / `wrangler secret` (prod) | The worker — verifies inbound webhook HMAC |
| `ANTHROPIC_ENVIRONMENT_ID` | Identifier | `.dev.vars` / wrangler vars | The worker |

The split matters: anything readable by the worker is readable by the agent's tool calls, which is exactly what the egress layer exists to police. Keeping the org key off the worker host is the same principle applied at the credential boundary.

## Local development

First-time setup writes the three env-scoped values into `.dev.vars` interactively:

```bash
bun run bootstrap                                 # walks you through env id + console-only keys
```

Then iterate:

```bash
bun run dev                                       # wrangler dev (port 8787)
bun run test                                      # vitest (42 tests)
bun run typecheck                                 # tsc --noEmit
```

### Local smoke test

In one terminal:
```bash
bun run dev
```

In another:
```bash
bun run smoke
```

`scripts/smoke.ts` signs a payload against the `ANTHROPIC_WEBHOOK_SIGNING_KEY` in your `.dev.vars`, posts it to the dev server, and asserts the response shape. Confirms wrangler boots cleanly, KV bindings resolve under miniflare, `standardwebhooks` verifies in the real workerd runtime, and `ctx.waitUntil` invokes `runSession` (you'll see a `session.runtime_error` log when its outbound call to the fake Anthropic API fails — that's expected and proves the code path ran).

## Platform operations

```bash
bun run ops env list                              # GET /v1/environments
bun run ops env create [name]                     # POST /v1/environments
bun run ops env show <id>                         # GET /v1/environments/<id>
bun run ops agent register [--dir agents/pr-review]
bun run ops session create --agent <id> --env-id <id> [--metadata @file.json]
bun run ops work stats --env-id <id>
```

Reads `ANTHROPIC_API_KEY` from `~/code/dotclaude/.env` → `~/.env` (or `$OPS_ENV_FILE`) at invocation. Never writes to `.dev.vars`.

## Quick deploy (scaffold only)

You can deploy V1 today; the worker accepts webhooks and routes email, but sessions will be claimed-then-stopped until the runner body lands. Useful for confirming the deploy path, secrets, KV bindings, and Email Routing setup.

```bash
cd managed-agents/cloudflare
bun install
wrangler login                                    # if not already
./scripts/setup.sh                                # creates KV namespaces, prints binding ids
```

Then, manually:
1. `bun run ops env create dotclaude` — creates a self-hosted environment, prints the env_id
2. In the Anthropic console: open the environment → **Generate environment key**
3. In the Anthropic console under Webhooks: subscribe `https://<your-worker>.workers.dev/webhooks` to session events; copy the signing key
4. `wrangler secret put ANTHROPIC_ENVIRONMENT_ID` (from step 1)
5. `wrangler secret put ANTHROPIC_ENVIRONMENT_KEY` (from step 2)
6. `wrangler secret put ANTHROPIC_WEBHOOK_SIGNING_KEY` (from step 3)
7. `wrangler deploy`
8. In the Cloudflare dashboard: enable Email Routing on a domain, point a catch-all (e.g. `agent-*@yourdomain`) at the worker's email handler

To deploy the PR review agent on top (see [`agents/pr-review/README.md`](./agents/pr-review/README.md) for full instructions):

```bash
bun run ops agent register                        # equivalent to ./agents/pr-review/register.sh
# paste agent_id and env_id into .github/workflows/dotclaude-pr-review.yml
# add the GitHub egress policy + token (see the pr-review README)
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
