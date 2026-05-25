/**
 * Tool registry types. A tool is the triple {name, schema, handler}.
 *
 *   name      what the agent calls
 *   schema    a Zod schema validated against tool-call input
 *   handler   async function running the tool, receives parsed input + ctx
 *
 * Adding a new tool: define it in custom-tools.ts and export it in the
 * `customTools` array. See docs/adding-custom-tools.md.
 */
import type { z } from "zod";
import type { Env } from "../env.d.ts";

export interface ToolContext {
  env: Env;
  /**
   * Fetch that routes outbound HTTP through the egress layer. Tools should
   * use this instead of global fetch so credentials inject and audit hooks
   * apply.
   */
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

/**
 * Runtime shape of a registered tool. The schema is widened to ZodTypeAny so
 * heterogenous tools can live in a single array; defineTool keeps the strong
 * input typing at the authoring edge.
 */
export interface ToolDefinition<Output = unknown> {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  handler: (input: unknown, ctx: ToolContext) => Promise<Output>;
}

export interface ToolDefinitionInput<Schema extends z.ZodTypeAny, Output> {
  name: string;
  description: string;
  schema: Schema;
  handler: (input: z.infer<Schema>, ctx: ToolContext) => Promise<Output>;
}

export function defineTool<Schema extends z.ZodTypeAny, Output>(
  def: ToolDefinitionInput<Schema, Output>,
): ToolDefinition<Output> {
  return def as unknown as ToolDefinition<Output>;
}
