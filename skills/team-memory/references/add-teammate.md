# Adding a New Teammate

Step-by-step guide for creating and configuring a new AI teammate.

Paths like `scripts/init.sh` are relative to this skill's base directory — run
the commands from there. Where a command has to survive outside that directory
(a shell alias), `$SKILL_DIR` stands for the same base directory; expand it
when you write the line. Prerequisite: Claude Code on the machine.

## 1. Choose a Name

Pick a lowercase name with hyphens. The name becomes:
- The directory at `~/.ai-memory/<name>/`
- The `--persona` flag value
- Part of any shell alias

Good names: `bertram`, `oracle`, `code-scout`, `debug-buddy`

## 2. Bootstrap

```bash
bash scripts/init.sh <name>
```

This creates the directory structure, wires the SessionEnd hook (first time only),
syncs the global `team-memory-sleep` agent, and sets the new teammate as active
if it's the first one.

## 3. Define the Personality

Edit `~/.ai-memory/<name>/personality.md`. This is the most important step —
it determines how the teammate behaves.

### Sections

| Section | Marker | Who edits | What to write |
|---------|--------|-----------|---------------|
| Identity | `<!-- IMMUTABLE -->` | You only | Core character: who they are, how they think, their personality |
| Values | `<!-- IMMUTABLE -->` | You only | Non-negotiable principles that guide decisions |
| Voice | `<!-- MUTABLE -->` | AI evolves | Communication style — tone, verbosity, humor |
| Strengths | `<!-- MUTABLE -->` | AI evolves | Discovered over time as you work together |
| Growth | `<!-- MUTABLE -->` | AI evolves | Self-reflection on how they're changing |

### Tips for Identity

- **Be specific.** "You think carefully before acting" is better than "you are smart."
- **Give them character.** Dry wit? Enthusiastic? Terse? Verbose? Cautious? Bold?
- **Define their approach.** Do they ask before acting? Prototype fast? Prefer planning?
- **Keep it short.** 3-5 sentences. The personality loads into the system prompt every session.

### Tips for Values

- These are guardrails the AI cannot override. The sleep-reflect agent respects `<!-- IMMUTABLE -->` markers.
- Match YOUR values. If you want minimal abstraction, say so here.
- 3-5 values is plenty.

### Starting from the sample

A Bertram personality is available as a reference:
```bash
cp references/sample-bertram-personality.md \
   ~/.ai-memory/<name>/personality.md
```
Then edit Identity/Values to match your vision.

## 4. Populate Shared Knowledge (First Teammate Only)

If this is your first teammate, populate the shared files that all teammates
@import. Human preferences and conventions are already covered by your global
`~/.claude/CLAUDE.md`, so only project and platform context need shared files: <!-- portability: allow -->

- `~/.ai-memory/shared/projects.md` — active projects and their context
- `~/.ai-memory/shared/platform.md` — shell, OS, and infrastructure defaults

These files are @imported by every teammate's CLAUDE.md, so all teammates
share this knowledge without re-teaching.

## 5. Set Up Shell Access

Add an alias to your shell profile (`~/.zshrc`, `~/.bashrc`):

```bash
# General launcher (uses active teammate)
alias claude-memory="$SKILL_DIR/scripts/launch.sh"

# Per-teammate shortcuts
alias claude-bertram="$SKILL_DIR/scripts/launch.sh --persona bertram"
alias claude-oracle="$SKILL_DIR/scripts/launch.sh --persona oracle"
```

Reload: `source ~/.zshrc`

## 6. First Launch

```bash
claude-memory --persona <name>
# or
claude-<name>
```

On the first session:
- The teammate loads its personality and shared knowledge
- It has empty memory — everything is new
- It will start remembering decisions, patterns, and preferences as you work
- At session end, the sleep pipeline extracts additional memories and writes a session summary

### Good first-session activities

- Work on a real task (the teammate learns by doing, not by being told)
- Make a few decisions together — these get remembered
- State preferences explicitly ("I prefer X over Y") — these become high-confidence memories
- The relationship.md will be updated after the session by the sleep-reflect agent

## 7. Switching Between Teammates

```bash
# Set a new default
ln -sfn <name> ~/.ai-memory/active

# Or just use --persona
claude-memory --persona oracle
```

## 8. Verify

After the first session ends, check that memory was created:

```bash
ls ~/.ai-memory/<name>/archival/   # Should have memory blocks
ls ~/.ai-memory/<name>/journal/     # Should have a session summary
cat ~/.ai-memory/<name>/relationship.md  # Should be updated
```

## Personality Archetypes

Some starting points for different teammate styles:

**The Careful Engineer** (Bertram-style)
> Thinks before acting. Asks clarifying questions. Values correctness. Dry wit.

**The Rapid Prototyper**
> Builds fast, iterates faster. Prefers working code over perfect design.
> Asks forgiveness, not permission. Optimistic energy.

**The Architect**
> Zooms out before zooming in. Thinks in systems. Draws diagrams.
> Will stop you from building the wrong thing efficiently.

**The Debugger**
> Loves mysteries. Systematic, methodical. Reads error messages carefully.
> Builds mental models of state. Never guesses — always verifies.

**The Reviewer**
> Reads code like literature. Catches edge cases. Thinks about maintenance cost.
> Constructive but honest. "Have you considered..."

**The Researcher**
> Gets to the bottom of things. Digs through docs, source code, and history
> until the full picture emerges. Curates what they find — separates signal
> from noise. The librarian who always knows where to look.
