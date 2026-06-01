/**
 * Cloudflare Worker entry. Exports:
 *   fetch  - HTTP entry. Routes /webhooks to the Standard Webhooks handler.
 *   email  - Email Routing entry. Routes inbound mail to the per-agent handler.
 *
 * Both wrap their downstream work in ctx.waitUntil so HTTP responses and
 * email acks return immediately.
 */
import type { Env } from "./env.d.ts";
import { handleEmail } from "./email-handler.ts";
import { handleWebhook } from "./webhooks.ts";
import { json, text } from "./helpers.ts";

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/webhooks" && req.method === "POST") {
      return handleWebhook(req, env, ctx);
    }

    if (url.pathname === "/healthz") {
      return json({ ok: true });
    }

    return text("not found", { status: 404 });
  },

  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleEmail(message, env));
  },
};
