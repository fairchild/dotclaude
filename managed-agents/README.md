# managed-agents

Self-hosted execution environments for AI agents that follow a "platform runs the loop, you run the tools" architecture.

**Currently focused on Claude managed agents.** Anthropic keeps the agent loop on its infrastructure (orchestration, context, error recovery) and enqueues per-session work items into a queue scoped to an environment. A worker we own claims items, runs tool calls in a sandbox we control, and posts results back.

The same shape exists for other platforms (Daytona, Modal, Vercel sandboxes; OpenAI's responses-with-tools pattern), so this directory holds room for sibling implementations.

## Implementations

| Path | Status | Notes |
|---|---|---|
| [`cloudflare/`](./cloudflare) | V1 scaffold | Cloudflare Workers + per-agent email routing. Webhook surface, egress layer, tool registry, and email handler are wired and tested. The per-session agent loop body (Worker Loader isolate, tool-call delivery) lands in V1.1 once the protocol's HTTP surface is verified. First deployed agent target: PR review on this repo. |

## Why a self-hosted environment

The default Anthropic-hosted environment is fine when the agent's code, filesystem, and outbound network don't need to live inside your boundary. You reach for self-hosted when:
- The agent operates on data that can't leave your network
- It calls internal services that aren't publicly routable
- You want network egress under your own policies (credential injection by reference, audit logging, allow/deny lists)
- Compliance or audit controls in your infra need to apply

## What lives here vs. what doesn't

This directory holds **deployable implementations** of self-hosted environments. Documentation that's purely reference (the protocol, security model, comparison tables) lives inside each implementation's own `docs/` subdir, so the docs sit next to the code they describe.

## References

- [Anthropic — self-hosted sandboxes](https://platform.claude.com/docs/en/managed-agents/self-hosted-sandboxes)
- [Anthropic — managed agents overview](https://platform.claude.com/docs/en/managed-agents/overview)
- [Cloudflare — claude-managed-agents repo](https://github.com/cloudflare/claude-managed-agents) (upstream we cross-walk to)
