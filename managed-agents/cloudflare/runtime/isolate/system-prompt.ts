/**
 * Base system-prompt scaffolding. Per-agent system prompts live with the agent
 * definition (e.g. agents/pr-review/system-prompt.md); this module exposes
 * runtime guarantees the agent can rely on (filesystem, tool semantics, the
 * fact that egress is mediated).
 */

export const RUNTIME_GUARANTEES = `
You are running inside a per-session sandbox isolate on Cloudflare Workers.
- Working directory: /workspace. State is wiped at session end.
- All outbound HTTP from tool calls passes through an egress layer that
  injects credentials by reference name. You never see or need to handle raw
  secrets - reference them by name (e.g. "github", "stripe").
- Skills downloaded for this session live in /workspace/skills/<name>/.
- Tool calls return synchronously. Long-running work should report progress
  in tool result text rather than blocking past 5 minutes.
`.trim();
