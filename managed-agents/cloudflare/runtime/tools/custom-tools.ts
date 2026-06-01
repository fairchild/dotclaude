/**
 * Tool surface registered with the runtime. Two kinds of entries:
 *   - Generic, protocol-illustrative tools (echo, http_get) - useful templates
 *     for new tools and exercise the egress fetch on arbitrary hosts.
 *   - GitHub tools (pr_diff, pr_files, pr_post_review) - purpose-built for
 *     the pr-review agent, kept here so the registry stays a single import
 *     for the runtime. See runtime/tools/github.ts.
 *
 * See docs/adding-custom-tools.md for the {schema, handler} pattern.
 */
import { z } from "zod";
import { defineTool, type ToolDefinition } from "./tool-registry.ts";
import { urlSchema } from "./schemas.ts";
import { githubTools } from "./github.ts";

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

export const customTools: ToolDefinition[] = [echo, httpGet, ...githubTools];
