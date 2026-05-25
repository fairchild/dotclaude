/**
 * Toolset assembled for the isolate. Combines:
 *   - the standard agent tools (read, write, glob, grep, bash equivalent for
 *     the isolate's virtual FS)
 *   - any custom tools registered via tools/tool-registry.ts
 *
 * V1: returns just the custom tools - standard tools are stubbed pending
 * Worker Loader virtual filesystem decisions (see runner.ts).
 */
import { customTools } from "../tools/custom-tools.ts";
import type { ToolDefinition } from "../tools/tool-registry.ts";

export function assembleToolset(allowed: string[]): ToolDefinition[] {
  const all = [...customTools];
  return all.filter((tool) => allowed.includes(tool.name));
}
