# Securing access

The worker exposes two surfaces:

| Surface | Authn |
|---|---|
| `POST /webhooks` | Standard Webhooks HMAC signature, verified in `runtime/webhooks.ts` |
| `email()` | Cloudflare Email Routing — only mail Cloudflare delivered reaches the handler |

`/healthz` is unauthenticated and returns `{ok: true}` for liveness checks.

That's the whole authenticated surface in V1. There's no admin API and no dashboard, so there's no broader access-control problem to solve at the worker boundary.

## When to add Cloudflare Access

If you grow this into a multi-tenant deployment, an admin dashboard, or simply want defense in depth on the webhook surface:

1. Put the worker behind a Cloudflare Access application
2. Add a policy that allows Anthropic's webhook source (by service token or IP) for `/webhooks`
3. Add a separate policy for human admin access

Reference: [Cloudflare Access docs](https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/).

## What to verify on each deploy

- `ANTHROPIC_WEBHOOK_SIGNING_KEY` is set as a secret — never committed to source
- `ANTHROPIC_ENVIRONMENT_KEY` is set as a secret — Bearer auth for `/work` endpoints. Distinct from your org API key; the API key never goes on the worker host.
- KV writes for `SECRETS` use values you'd be comfortable with the agent *referencing by name* — the values themselves don't leak through `${ref:...}` substitution, but a leaked KV namespace exposes them all at once
- `EMAIL_DOMAIN` matches the domain Email Routing is enabled on

## Threat model in two lines

The agent is treated as adversarial input. Any secret the agent can read, it can be talked into exposing — so the egress layer holds them outside the agent's reach, and the agent only ever knows reference names.

The webhook surface is treated as a trusted-after-verification call from Anthropic. The signing key is the only thing keeping it that way; rotate it on a key-rotation cadence appropriate for your security posture.

## See also

- [`architecture.md`](./architecture.md) — the trust boundaries between the Worker, the isolate, and outbound HTTP
- [Standard Webhooks spec](https://www.standardwebhooks.com/)
