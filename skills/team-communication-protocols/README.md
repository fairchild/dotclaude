# team-communication-protocols

Communication playbook for Claude Code agent teams.

## When to use this

When you're using Claude Code's `TeamCreate` to spin up multi-agent teams — a lead coordinating implementers, reviewers, or investigators. Without this skill, agents default to ad-hoc messaging that tends toward noisy broadcasts and unstructured status dumps. This skill gives them a shared protocol.

## What it covers

- **Message type selection** — when to direct-message vs broadcast vs request shutdown. Broadcasts fan out to every teammate, so they should be rare.
- **Plan approval workflow** — the `plan_mode_required` handshake where a teammate proposes a plan, the lead reviews it, and approves or rejects with feedback.
- **Shutdown protocol** — graceful team teardown. Teammates can reject shutdown if they're mid-task; the lead retries after they finish.
- **Anti-patterns** — the common mistakes: broadcasting routine updates, sending JSON blobs as messages, micromanaging, using UUIDs instead of names.
- **Message templates** — ready-to-use patterns for task assignment, blocker reports, integration notifications, review summaries, and shutdown acknowledgments.

## How it works

Pure documentation — no scripts. The SKILL.md content gets loaded when the skill triggers, giving the agent structured guidance on how to communicate within a team. The `references/messaging-patterns.md` file has copy-paste message templates.
