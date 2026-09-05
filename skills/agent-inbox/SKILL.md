---
name: agent-inbox
license: Apache-2.0
description: File-based messaging between agents across tools. Use when notified of unread inbox mail, setting up an agent inbox, or sending, reading, or replying to agent messages.
---

# Agent inbox

Mail is a Markdown file. Deliver it with an atomic rename; the recipient reads it and archives it after handling it. Any agent with filesystem access can participate.

```text
main checkout ----+--> shared .agents/inbox/<agent>/
linked worktree ---+

message: tmp/ --mv--> new/ --read + handle--> archive/
owner:   sender      recipient
```

## Set up and discover

Pick a short, goal-oriented name such as `auth-rewrite`. Use lowercase kebab-case, check for an existing owner, and add a suffix if the name is taken. Keep your name for the session even if the task changes. One reader owns each inbox.

Set `skill_dir` to the directory containing this SKILL.md, then:

```bash
. "$skill_dir/scripts/lib.sh"
inbox_root=$(agent_inbox_root) || exit 1
export AGENT_INBOX_NAME=auth-rewrite
mkdir -p "$inbox_root/$AGENT_INBOX_NAME"/{tmp,new,archive}
ls "$inbox_root"  # Discover peers; directories may belong to inactive sessions.
```

Share your name and resolved inbox root with collaborators. Directory existence does not prove an agent is running.

By default, all worktrees in a Git clone share `.agents/inbox/` beside the common Git directory. This keeps discovery simple and mail independent of worktree deletion. Outside Git, the default is `$PWD/.agents/inbox/`; collaborators must use the same directory.

Set `AGENT_INBOX_ROOT` to an absolute path to override the default. Use a worktree-local `.agents/inbox/` when isolation or filesystem permissions require it, and share that exact path with peers. A shared inbox may require access beyond an agent's worktree sandbox. Keep inbox contents ignored by Git; they are coordination state, not source code.

## Send and reply

Use a unique filename and write in the recipient's `tmp/`, then rename into its `new/`. Both directories must be on the same filesystem. `mktemp` prevents concurrent senders from reusing a filename.

```bash
recipient=api-review
mkdir -p "$inbox_root/$recipient"/{tmp,new,archive}
draft=$(mktemp "$inbox_root/$recipient/tmp/$(date -u +%Y%m%dT%H%M%SZ)-auth-ready.XXXXXX") || exit 1
cat > "$draft" <<EOF_MESSAGE
---
from: $AGENT_INBOX_NAME
to: $recipient
reply_to: ../$AGENT_INBOX_NAME/tmp/
timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)
thread: auth-v2
---

Auth middleware is ready on branch feat/auth-v2. Please review the token validation.
EOF_MESSAGE
mv "$draft" "$inbox_root/$recipient/new/$(basename "$draft").md"
```

The body should state the result or request, relevant evidence or file/branch references, and the next action. Keep it short. Use a quoted heredoc for literal bodies containing shell syntax.

Messages have YAML frontmatter. `from`, `to`, `reply_to`, and `timestamp` are required; `thread` is optional topic grouping. Keep the same `thread` when replying. Filenames end in `.md`; a UTC timestamp, subject, and unique suffix make them easy to scan.

To reply, resolve `reply_to` relative to the recipient's inbox directory, not its `new/` directory. It identifies the sender's `tmp/`; deliver to the sibling `new/` using the same write-and-rename sequence. For separate inbox roots, use an agreed absolute `reply_to` path. Check that the path belongs to the intended peer before writing.

## Read and archive

```bash
ls "$inbox_root/$AGENT_INBOX_NAME/new/"
cat "$inbox_root/$AGENT_INBOX_NAME/new/<file>.md"
# After handling the message or recording its follow-up:
mv "$inbox_root/$AGENT_INBOX_NAME/new/<file>.md" "$inbox_root/$AGENT_INBOX_NAME/archive/"
```

Read and archive only your own mail unless asked to act for another agent. Archiving acknowledges handling, not task completion. Send an explicit reply when the sender needs a result. Delivery does not guarantee an agent is awake or has read the message.

## Optional notifications

Run `scripts/check-inbox-hook.sh` at a turn boundary for an unread count, or `scripts/inbox-startup.sh` at session start for a summary. Both are read-only and silent when empty.

Both use `AGENT_INBOX_NAME`, falling back to `CLAUDE_SESSION_NAME` for existing integrations. With no identity set, they report only the shared unread count. Export the name where the hook runs; setting it in a child shell does not configure the parent session.

Attach these scripts through your tool's hook configuration using their absolute install paths. Scheduling and waking agents belong to that tool; the inbox protocol only delivers files.

## Existing inboxes

The message format is unchanged. Before moving an old worktree-local inbox, pause its readers and writers, resolve the shared root, and check for name and filename collisions. Merge messages deliberately; do not blindly move agent directories over existing inboxes. Verify the mail arrived and update collaborators' paths before removing the old copy.
