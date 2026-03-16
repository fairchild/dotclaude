---
name: agent-inbox
license: Apache-2.0
description: >
  File-based messaging between agents across any harness. Invoke this skill
  when you see "📬 unread in .agents/inbox", need to send or read agent
  messages, or set up an inbox. Triggers on: "📬", ".agents/inbox",
  "agent inbox", "send message to agent", "check inbox", "agent message".
---

# Agent Inbox Protocol

File-based messaging for agents across harnesses (Claude Code, Codex, Cursor, Gemini CLI, Warp, etc.). Just filesystem operations — `mkdir`, `cat`, `mv`.

## Setup

```bash
mkdir -p .agents/inbox/my-agent/{new,tmp,archive}
```

## Send a message

Write to `tmp/`, then `mv` to `new/` (atomic — prevents partial reads). If the directory doesn't exist yet, create it with `mkdir -p` first.

```bash
cat > .agents/inbox/recipient/tmp/20260315T101500-auth-ready.md << 'EOF'
---
from: my-agent
to: recipient
reply_to: ../my-agent/tmp/
timestamp: 2026-03-15T10:15:00Z
thread: auth-v2
---

Auth middleware rewrite is ready on `feat/auth-v2`.
EOF
mv .agents/inbox/recipient/tmp/20260315T101500-auth-ready.md .agents/inbox/recipient/new/
```

## Check for messages

```bash
ls .agents/inbox/my-agent/new/
```

## Read and archive

```bash
cat .agents/inbox/my-agent/new/20260315T101500-auth-ready.md
mv .agents/inbox/my-agent/new/20260315T101500-auth-ready.md .agents/inbox/my-agent/archive/
```

## Reply

Read `reply_to` from the message frontmatter — it points to the sender's `tmp/` directory. Write there, then `mv` to `new/`.

## Discovery

Human-brokered. Tell each agent the other's inbox path. Every message carries `reply_to` so the recipient can reply without prior setup.

## Message format

Markdown with YAML frontmatter. Filename: `<YYYYMMDDTHHMMSS>-<slug>.md`

| Field | Required | Description |
|-------|----------|-------------|
| `from` | yes | Sender's agent name |
| `to` | yes | Recipient's agent name |
| `reply_to` | yes | Sender's `tmp/` dir, relative to recipient's inbox (e.g. `../sender/tmp/`) |
| `timestamp` | yes | ISO 8601 |
| `thread` | no | Topic grouping (e.g. `auth-v2`) |

## Conventions

- **Slugs are short subjects**: `auth-update`, `review-needed`, `api-ready`
- **Always write via `tmp/` then `mv` to `new/`**: atomic writes prevent partial reads
- **Archive after reading**: move from `new/` to `archive/`
- **Gitignore contents**: messages are ephemeral coordination, not project state

## Mail notifications

`scripts/check-inbox-hook.sh` is a Stop hook that scans `.agents/inbox/*/new/` from the working directory. Silent when empty — no configuration needed.
