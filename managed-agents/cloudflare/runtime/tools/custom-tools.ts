/**
 * Generic, protocol-illustrative custom tools. These exist to demonstrate
 * the registration pattern - real deployments swap them for domain-specific
 * tools. The pr-review agent (agents/pr-review/) is a separate layer that
 * consumes this infrastructure rather than baking GitHub specifics here.
 *
 * See docs/adding-custom-tools.md.
 */
import { z } from "zod";
import { defineTool, type ToolDefinition } from "./tool-registry.ts";
import { urlSchema } from "./schemas.ts";

const echo = defineTool({
  name: "echo",
  description: "Return the input verbatim. Smoke-tests the tool wiring.",
  schema: z.object({ message: z.string() }),
  handler: async (input) => ({ message: input.message }),
});

const httpGet = defineTool({
  name: "http_get",
  description:
    "Fetch a URL with HTTP GET and return the response body as text. Outbound traffic passes through the egress layer - if a policy is configured for the host, credentials inject automatically.",
  schema: z.object({
    url: urlSchema,
    max_bytes: z.number().int().positive().max(1_000_000).default(100_000),
  }),
  handler: async (input, ctx) => {
    const res = await ctx.fetch(input.url, { method: "GET" });
    const text = await res.text();
    const truncated = text.length > input.max_bytes ? text.slice(0, input.max_bytes) : text;
    return {
      status: res.status,
      content_type: res.headers.get("content-type") ?? "",
      body: truncated,
      truncated: text.length > input.max_bytes,
    };
  },
});

export const customTools: ToolDefinition[] = [echo, httpGet];
