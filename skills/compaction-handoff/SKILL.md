---
name: compaction-handoff
description: Prepare a long-running session for compaction and pick the work up after it — write durable state before the cut, ask for the cut with instructions and a resume prompt, then rebuild from live reads instead of the summary. Use when the user says "prepare for compaction", "let's compact" or "we're getting long", when the compaction mod's prepare note arrives, and before handing the user a /compact to type.
license: Apache-2.0
metadata:
  status: experimental
  experimental_reason: "Generalised from a handoff practice in the user's other repositories, used across many cuts there; no eval in this repo."
---

# Compaction handoff

Compaction keeps the process and replaces the context with a summary. Background tasks, subagents,
the working directory and anything on disk survive; everything only the context held becomes a
paraphrase. The handoff makes the paraphrase unnecessary: by the cut, every fact that matters is on
disk or in the tracker, and the next turn has a short list of live reads to rebuild from.

The engine's own compaction is the backstop. It takes no instructions and lands mid-thought, so a
summary that matters is one the session asked for. With the `compaction` mod installed, the short
form of steps 2–4 arrives on its own: a note beside the first prompt at or past the prepare point,
and another beside the first prompt after a cut the mod did not run itself (a typed `/compact`, the
engine's own), or after its own cut when the resume prompt did not go in. This skill is the long
form.

## 1. Reflect back

In one screen, tell the user what moved since the last cut (each arc, its state, what is left), what
was learned (each lesson with what it cost), what is running (agents by name, processes by pid), and
what is waiting on them. They often add to it. Write nothing durable until they have seen it.

## 2. Write durable state

1. **Lessons** go where they will be read: a rule about code into the repo beside it, a preference
   into memory.
2. **An arc in flight** gets a handoff on its tracking issue (`arc-handoff`), with anything that
   exists only on this machine pushed to a WIP branch first — where the repo's instructions or the
   user have granted pushes and tracker comments. Otherwise commit locally, write the handoff into
   the resume file, and tell the user what you would push and post.
3. **A resume file**, outside the repository (for example under `~/.cache/`), so it stays out of
   version control: agents and processes and what each will change in the world (a commit, a
   review, a file), decisions not yet recorded, blockers, the first action, and the reads that
   rebuild state. Write it after the last dispatch, so the list is current.
4. **Verify the writes:** `git status` clean, and each push and handoff comment you were allowed to
   make actually made.

## 3. Ask for the cut

With the `compaction` mod installed, call `mcp__compaction__request`:

- `instructions`: what the summary keeps, named exactly — the user's briefs verbatim, open asks,
  agents and their states, the merge order — and what it drops: tool output, transcripts, status
  echoes.
- `reasoning`: why now beats carrying on.
- `resume`: the first thing to do and where its state lives, in words you want to read cold, for
  example `Read ~/.cache/arc/RESUME.md, then re-check the three PRs it lists before acting.` It
  must not begin with `/`.

The mod runs `/compact` once the turn ends and submits `resume` to start the next turn, so a
requested cut picks itself up. Two cases resume nothing:

- **A `/compact` the user types.** It starts no turn, so the compacted session waits for the next
  event. Before handing them the command, start a background timer (a `sleep 900` run in the
  background) as a ceiling on the wait, and start another if it fires before the cut lands.
- **A dropped request.** The mod drops a request when another compaction ran first or the context
  sat below the floor when it fell due, and nothing follows a `/compact` that fails.
  `mcp__compaction__context` shows the last request's outcome; if it was dropped or failed, the
  resume file still says what comes next.

Without the mod, give the user `/compact <instructions>` and set the timer as above.

## 4. After the cut

Read the resume file, then re-check every fact that can change — branches, PRs and checks, running
processes, agents — before acting on it. The summary carries what the session believed, including
anything already wrong. The ids the harness gave background tasks do not survive the cut: address
agents by name and processes by pid. Release an agent's claim from what it changed in the world, not from its report.
