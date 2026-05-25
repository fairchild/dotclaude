# Applying egress policies

Every outbound HTTP request a tool makes passes through [`runtime/egress/handler.ts`](../runtime/egress/handler.ts). On match against a policy in the `EGRESS_POLICIES` KV namespace, the handler injects a header from a secret in the `SECRETS` namespace. The agent never sees the secret value — it just sees its tool call succeed.

This is the security property worth understanding: anything the agent can read, it can be talked into exfiltrating. Holding secrets *outside* the agent's reach is what makes the difference between a leaky and a sealed sandbox.

## Policy shape

A policy is JSON stored at KV key `policy:<id>` in `EGRESS_POLICIES`. An index at `policies:index` lists all active policy ids.

```json
{
  "id": "stripe",
  "host": "api.stripe.com",
  "action": {
    "type": "inject_header",
    "header": "authorization",
    "value_template": "Bearer ${ref:STRIPE_LIVE_KEY}"
  }
}
```

`${ref:NAME}` placeholders resolve from the `SECRETS` namespace — the value at key `NAME`. Multiple refs in one template are fine; if any are missing, the egress fails closed with a 502 rather than send a partial header.

Optional `path_prefix` narrows the match:

```json
{
  "id": "github-issues",
  "host": "api.github.com",
  "path_prefix": "/repos/",
  "action": {
    "type": "inject_header",
    "header": "authorization",
    "value_template": "Bearer ${ref:GITHUB_TOKEN}"
  }
}
```

## Registering a policy

Two KV writes:

```bash
# the secret
wrangler secret put STRIPE_LIVE_KEY
# or, for non-secret values you want in the SECRETS namespace:
wrangler kv key put --binding=SECRETS STRIPE_LIVE_KEY 'sk_live_...'

# the policy
wrangler kv key put --binding=EGRESS_POLICIES 'policy:stripe' '{
  "id": "stripe",
  "host": "api.stripe.com",
  "action": {
    "type": "inject_header",
    "header": "authorization",
    "value_template": "Bearer ${ref:STRIPE_LIVE_KEY}"
  }
}'

# update the index
wrangler kv key put --binding=EGRESS_POLICIES 'policies:index' '["stripe"]'
```

After deploy, any tool call to `api.stripe.com` carries an `Authorization: Bearer <live key>` header automatically.

## Matching rules

- Host comparison is case-insensitive, exact match (no wildcards in V1).
- If `path_prefix` is set, the request path must start with it.
- First matching policy wins. Order in the index matters.
- No match = pass through unmodified (no headers injected).

## What's not here

- **Allow/deny lists.** V1 doesn't block egress; it only injects. A deny-by-default mode would be a small extension to `match.ts` — add an `action: { type: "deny" }` variant and check it before fetching.
- **Per-agent or per-session scoping.** All matches are global. Per-session scoping needs the policy lookup to take a session/agent id as part of the key.
- **Audit log.** The handler logs `egress.injected` / `egress.no_policy` / `egress.unresolved_secret` to Cloudflare Logs. For durable audit, pipe those to a Logpush destination.

## See also

- [`architecture.md`](./architecture.md) for where the egress layer sits in the flow
- [`adding-custom-tools.md`](./adding-custom-tools.md) — tools use `ctx.fetch` to route through here
