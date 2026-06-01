# Adding custom tools

A tool is the triple `{name, schema, handler}` defined via `defineTool` in [`runtime/tools/tool-registry.ts`](../runtime/tools/tool-registry.ts). The agent calls the tool by name; the schema validates input; the handler runs in the parent Worker (not the isolate) so bindings stay on the trusted side.

## The pattern

```ts
import { z } from "zod";
import { defineTool } from "./tool-registry.ts";

export const myTool = defineTool({
  name: "get_weather",
  description: "Look up the current weather for a city by name.",
  schema: z.object({
    city: z.string().min(1),
    units: z.enum(["metric", "imperial"]).default("metric"),
  }),
  handler: async (input, ctx) => {
    // ctx.env: full Worker Env (bindings, secrets)
    // ctx.fetch: egress-routed fetch. Use this for outbound HTTP.
    const res = await ctx.fetch(
      `https://api.weather.example/${input.city}?units=${input.units}`,
    );
    return await res.json();
  },
});
```

Then add it to the `customTools` array in [`runtime/tools/custom-tools.ts`](../runtime/tools/custom-tools.ts):

```ts
export const customTools: ToolDefinition<unknown, unknown>[] = [
  echo,
  httpGet,
  myTool as ToolDefinition<unknown, unknown>,
];
```

That's it. The tool is now dispatchable from any agent that lists it in its `tools` allowlist.

## Conventions

**Schema everything.** Use Zod even for trivial inputs — a parsed type is cheaper than three error branches.

**Use `ctx.fetch`, not global `fetch`.** Outbound HTTP through `ctx.fetch` flows through the egress layer; credentials inject automatically when a policy matches.

**Return JSON-serializable values.** Results post back to Anthropic as the `content` field of a tool result. Buffers, streams, and Date objects don't survive the boundary — convert at the tool edge.

**Handle errors by throwing.** The adapter catches and shapes errors into `{is_error: true}` results. Throwing is cheaper than building error objects yourself.

**Cap response sizes.** Anthropic's content size limits cap how much a tool result can carry. The `http_get` example caps at 100KB by default — apply the same shape to tools that fetch arbitrary data.

## Where this leaves the agent

Once registered, the tool's `name` is what the agent uses. The schema's JSON Schema form (Zod gives you this via `zod-to-json-schema` if needed) goes into the agent definition's `tools` field — but the V1 agent setup just passes a string allowlist, leaving schema discovery to the runtime when the tool is called.

## See also

- [`architecture.md`](./architecture.md) for where tool dispatch sits in the worker
- [`applying-egress-policies.md`](./applying-egress-policies.md) for how credentials reach tool handlers
