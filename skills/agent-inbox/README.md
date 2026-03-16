# agent-inbox

File-based messaging between AI coding agents, across any harness.

## When to use this

- You have agents in **different tools** (Claude Code, Codex, Cursor, Gemini CLI, Warp) that need to coordinate on the same project.
- You want agent-to-agent communication that **doesn't require a daemon, MCP server, or network**.
- You need something simpler than Claude Code's TeamCreate — just drop a file, read a file.

## How it works

Each agent gets a directory:

```
.agents/inbox/agent-name/
  new/          # unread messages land here
  tmp/          # write-in-progress (atomic safety)
  archive/      # read messages get moved here
```

Messages are markdown files with YAML frontmatter. Filenames are timestamped with a topic slug: `20260315T101500-auth-ready.md`.

Discovery is human-brokered: you tell each agent where the other's inbox is. Every message carries a `reply_to` path so the recipient can reply without prior setup.

## Example

```bash
# Create inboxes
mkdir -p .agents/inbox/alice/{new,tmp,archive}
mkdir -p .agents/inbox/bob/{new,tmp,archive}

# Alice sends to Bob
cat > .agents/inbox/bob/tmp/20260315T101500-api-ready.md << 'EOF'
---
from: alice
to: bob
reply_to: ../alice/tmp/
timestamp: 2026-03-15T10:15:00Z
---

Endpoints are live on `feat/api`.
EOF
mv .agents/inbox/bob/tmp/20260315T101500-api-ready.md .agents/inbox/bob/new/

# Bob checks and reads
ls .agents/inbox/bob/new/
cat .agents/inbox/bob/new/20260315T101500-api-ready.md
mv .agents/inbox/bob/new/20260315T101500-api-ready.md .agents/inbox/bob/archive/

# Bob replies using reply_to path from the message
cat > .agents/inbox/alice/tmp/20260315T102000-ack.md << 'EOF'
---
from: bob
to: alice
reply_to: ../bob/tmp/
timestamp: 2026-03-15T10:20:00Z
---

Got it, pulling now.
EOF
mv .agents/inbox/alice/tmp/20260315T102000-ack.md .agents/inbox/alice/new/
```

## "You've got mail" hook

An optional Stop hook scans `.agents/inbox/*/new/` from the working directory and nudges the agent with a one-line `📬` notification. Silent when empty — no configuration needed.

```json
{
  "Stop": [{
    "hooks": [{
      "type": "command",
      "command": "~/.claude/skills/agent-inbox/scripts/check-inbox-hook.sh"
    }]
  }]
}
```

## Design choices

- **Markdown over JSON** — agents already speak markdown. Messages are human-readable with `cat`.
- **Atomic writes** — write to `tmp/`, rename to `new/`. No partial reads.
- **Gitignored** — messages are ephemeral coordination, not project state.
- **No scripts required** — the protocol is `mkdir`, `cat`, and `mv`.
- **No registry** — discovery is explicit, brokered by the human.
- **Cross-harness by design** — the filesystem is the only dependency.
