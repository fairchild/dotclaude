# Agent email

Cloudflare Email Routing delivers inbound mail to the Worker's `email()` export. We parse the local-part of the destination address to recover the agent id, then write the message to the `AGENT_INBOX` KV namespace under `agent:<id>:last`.

This is one of the things the platform integration gives you nearly for free: every agent gets its own inbox without you running an SMTP server.

## Address shape

```
agent-<id>@<EMAIL_DOMAIN>
```

`<id>` is `[a-zA-Z0-9_-]+`. The `EMAIL_DOMAIN` var is set in `wrangler.jsonc`. Examples:
- `agent-pr-review-abc123@example.com` → agent id `pr-review-abc123`
- `agent-skill_audit-v2@example.com` → agent id `skill_audit-v2`

Anything else gets forwarded to `postmaster@<EMAIL_DOMAIN>` (or silently dropped if forwarding fails).

## Setup

1. **Enable Email Routing** on a domain you control in the Cloudflare dashboard
2. **Add a routing rule** with destination `agent-*@yourdomain` pointing to the worker:
   - Dashboard → Email → Email Routing → Routing rules
   - Custom address `agent-*` → Send to a Worker → pick `managed-agents-cloudflare`
   - Or use a catch-all if you want everything under that domain to route here
3. **Set `EMAIL_DOMAIN`** in `wrangler.jsonc` to your domain so non-matching mail forwards correctly

## How an agent reads its inbox

V1 is receive-only. An agent reads its slot via the (custom) `read_inbox` tool — not shipped in V1; the simplest version:

```ts
defineTool({
  name: "read_inbox",
  description: "Read the latest email sent to this agent.",
  schema: z.object({ agent_id: z.string() }),
  handler: async (input, ctx) => {
    const raw = await ctx.env.AGENT_INBOX.get(`agent:${input.agent_id}:last`);
    return raw ? JSON.parse(raw) : null;
  },
});
```

The inbox slot uses a 7-day TTL; a richer implementation would keep a list of recent messages per agent.

## What's not here

- **Sending mail.** The Email binding (`SEND_EMAIL` / Email Workers) lets us send too — not wired in V1. Adding it means a `send_email` custom tool plus a binding entry in `wrangler.jsonc`.
- **Multi-message inbox.** V1 keeps only the most recent message per agent. A list-based model with a small cap (last N messages) is the obvious next step.
- **Inbound classification.** No spam filtering beyond what Email Routing applies upstream. If the agent acts on inbound mail, it needs to defend against prompt injection in the message body.

## See also

- [`architecture.md`](./architecture.md) — `email()` runs alongside `fetch()` as a peer entry point
- [Cloudflare Email Workers docs](https://developers.cloudflare.com/email-routing/email-workers/)
