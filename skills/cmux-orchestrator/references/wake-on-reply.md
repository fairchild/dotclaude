# Wake-on-Reply

Wake-on-Reply connects async inbox replies to session lifecycle. When a child agent finishes and writes to the parent inbox, it can wake the parent if the parent is idle.

## Setup

Add the inbox startup hook to `settings.json` so every session checks for mail on start:

```json
{"hooks":{"SessionStart":[{"type":"command","command":"bash ~/.claude/skills/agent-inbox/scripts/inbox-startup.sh"}]}}
```

## Child Reply Flow

After a child completes work:

```bash
. ~/.claude/skills/agent-inbox/scripts/lib.sh
inbox_root="$(agent_inbox_root)"
TIMESTAMP=$(date -u +%Y%m%dT%H%M%S)

cat > "$inbox_root/orchestrator/tmp/${TIMESTAMP}-done.md" <<'EOF'
---
from: coder
to: orchestrator
reply_to: ../coder/tmp/
timestamp: 2026-04-03T05:30:00Z
thread: my-task
---

Task complete. PR at #42.
EOF

mv "$inbox_root/orchestrator/tmp/${TIMESTAMP}-done.md" "$inbox_root/orchestrator/new/"

bash ~/.claude/skills/agent-inbox/scripts/wake-parent.sh \
  --surface <parent-surface> --agent orchestrator
```

## Parent State Matrix

| Parent state | Action |
|---|---|
| Active Claude session | No-op; mail is surfaced on next turn |
| Idle shell prompt | Spawns headless `claude -p -n <agent>` to read the inbox |
| Surface closed | Logs warning and exits cleanly |

## Launching With Wake Instructions

Bake the wake instruction into the child launch:

```bash
cmux send --surface <child> "echo 'Check your inbox. When done, reply to orchestrator inbox and run: bash ~/.claude/skills/agent-inbox/scripts/wake-parent.sh --surface <parent> --agent orchestrator' | claude -p -n coder --add-dir '$inbox_root' --dangerously-skip-permissions"
cmux send-key --surface <child> Enter
```

Headless sessions use `--dangerously-skip-permissions` because no human is present to approve tool calls. Prefer a scoped permission profile if Claude Code adds one.
