/**
 * Inbound email handler. Cloudflare Email Routing delivers ForwardableEmailMessage
 * here when an email matches our routing rule (e.g. catch-all on agent-*@yourdomain).
 *
 * Address shape: agent-<id>@<domain>
 *   - agent-pr-review-abc123@example.com    -> agent id "pr-review-abc123"
 *
 * V1: parse the agent id, write the message body to AGENT_INBOX KV at
 * `agent:<id>:last`. The agent's next session can read that slot and act on
 * it. Sending email out is V1.1.
 *
 * See docs/agent-email.md.
 */
import type { Env } from "./env.d.ts";
import { log } from "./helpers.ts";

const AGENT_ADDRESS_PATTERN = /^agent-([a-zA-Z0-9_-]+)@/;
const INBOX_TTL_SECONDS = 60 * 60 * 24 * 7;

export async function handleEmail(message: ForwardableEmailMessage, env: Env): Promise<void> {
  const match = message.to.match(AGENT_ADDRESS_PATTERN);
  if (!match) {
    log("warn", "email.no_agent_match", { to: message.to });
    await message.forward(`postmaster@${env.EMAIL_DOMAIN}`).catch(() => {});
    return;
  }

  const agentId = match[1]!;
  const body = await new Response(message.raw).text();

  const payload = JSON.stringify({
    from: message.from,
    to: message.to,
    subject: message.headers.get("subject") ?? "",
    received_at: new Date().toISOString(),
    raw: body,
  });

  await env.AGENT_INBOX.put(`agent:${agentId}:last`, payload, {
    expirationTtl: INBOX_TTL_SECONDS,
  });

  log("info", "email.stored", { agentId, from: message.from, bytes: body.length });
}
