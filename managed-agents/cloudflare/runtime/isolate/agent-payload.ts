/**
 * Shape of the agent-side payload sent into a per-session isolate. The
 * Anthropic protocol delivers tool calls one at a time from inside its agent
 * loop; the isolate's job is to execute them and post results back.
 */

export interface AgentPayload {
  sessionId: string;
  /** Free-form metadata attached when the session was created. */
  metadata: Record<string, unknown>;
  /** Names of tools this agent is allowed to call. */
  allowedTools: string[];
}
