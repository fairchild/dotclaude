# agent-inbox

File-based messaging between AI coding agents, across tools.

## When to use this

- Agents in different tools (Claude Code, Codex, Cursor, Gemini CLI, Warp) need to coordinate on the same project.
- Agent-to-agent communication without a daemon, MCP server, or network.
- Something simpler than Claude Code's TeamCreate: drop a file, read a file.

## How it works

Each agent owns a directory under a shared inbox root:

```
$inbox_root/agent-name/
  tmp/          # write-in-progress; renamed into new/ when complete
  new/          # unread messages
  archive/      # handled messages
```

Inside a Git clone the root is `.agents/inbox/` beside the clone's common Git directory, so every worktree sees the same mail from any subdirectory. Outside Git it is `$PWD/.agents/inbox/`. `AGENT_INBOX_ROOT`, an absolute path, overrides both. `scripts/lib.sh` resolves it:

```bash
. <agent-inbox base dir>/scripts/lib.sh
inbox_root=$(agent_inbox_root) || exit 1
```

Messages are Markdown files with YAML frontmatter: `from`, `to`, `reply_to`, `timestamp`, and an optional `thread`. Filenames carry a UTC timestamp, a subject, and a unique suffix, such as `20260315T101500Z-auth-ready.Ab3dEf.md`.

Discovery is human-brokered or by listing `$inbox_root/`. Every message carries a `reply_to` path so the recipient can reply without prior setup.

`SKILL.md` is the protocol: naming, sending, replying, reading, archiving.

## Example

```bash
. <agent-inbox base dir>/scripts/lib.sh
inbox_root=$(agent_inbox_root) || exit 1
mkdir -p "$inbox_root"/{alice,bob}/{tmp,new,archive}

# Alice sends to Bob: write into tmp/, rename into new/
draft=$(mktemp "$inbox_root/bob/tmp/$(date -u +%Y%m%dT%H%M%SZ)-api-ready.XXXXXX")
cat > "$draft" <<EOF
---
from: alice
to: bob
reply_to: ../alice/tmp/
timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)
---

Endpoints are live on branch feat/api.
EOF
mv "$draft" "$inbox_root/bob/new/$(basename "$draft").md"

# Bob reads, then archives once handled
ls "$inbox_root/bob/new/"
cat "$inbox_root/bob/new/"*.md
mv "$inbox_root/bob/new/"*.md "$inbox_root/bob/archive/"
```

Bob replies the same way: `reply_to` resolves from his inbox directory to `$inbox_root/alice/tmp/`, and the rename goes into the sibling `new/`.

## Existing inboxes

Old per-worktree `.agents/inbox/` trees use the same layout and message format. Moving one into the shared root is a merge, not a bulk `mv`: pause its readers and writers, check for agent-name and filename collisions, verify the mail arrived, and update collaborators' paths before removing the old copy.

## Notifications

Two optional hook scripts report unread mail without consuming it. Both are silent when empty, resolve the root the same way, and take the agent identity from `AGENT_INBOX_NAME`, falling back to `CLAUDE_SESSION_NAME`. With no identity set they report the count across all inboxes.

- `scripts/check-inbox-hook.sh` prints a one-line unread count, for a turn-boundary hook such as Claude Code's Stop.
- `scripts/inbox-startup.sh` prints a per-message summary, for a session-start hook.

Hook commands run outside skill invocation, so they need the skill's absolute install path:

```json
{
  "hooks": {
    "Stop": [{ "hooks": [{ "type": "command", "command": "bash <agent-inbox base dir>/scripts/check-inbox-hook.sh" }] }],
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "bash <agent-inbox base dir>/scripts/inbox-startup.sh" }] }]
  }
}
```

`scripts/test-hooks.sh` covers identity handling and runs in CI.

Waking an idle agent belongs to the terminal or harness. The `cmux-orchestrator` skill carries a cmux adapter, `scripts/wake-parent.sh`.

## Design choices

- Markdown over JSON: agents already speak Markdown, and `cat` is the reader.
- Atomic delivery: write into `tmp/`, rename into `new/`. No partial reads.
- Gitignored: messages are coordination state, not source.
- No scripts required: the protocol is `mkdir`, `cat`, and `mv`. `lib.sh` only saves retyping the root resolution.
- No registry: discovery is the shared root, brokered by the human when needed.
- Cross-tool by design: the filesystem is the only dependency.
