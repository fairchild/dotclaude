# Skill portability

Skills in this repo are served over MCP (SEP-2640, the Skills Extension) as
well as read from disk. A consuming host materializes an MCP-served skill at a
path of its own choosing, so a skill's content can locate its own files only
one way: relative to its base directory. `scripts/portability.py` enforces the
conventions below; `mise run portability` reports, `portability:check` gates.

## The base directory

Every harness that loads a skill announces its base directory at invocation
("Base directory for this skill: …"). All references to the skill's own files
are written relative to it:

- `scripts/catchup.ts`, `references/GUIDE.md` — bare relative paths.
- When a command runs from the project directory (the usual cwd), anchor once
  in prose: "paths are relative to this skill's base directory" — the model
  resolves against the announced base.
- Never `~/.claude/skills/<name>/…`, `$HOME/.claude/skills/<name>/…`, or any
  absolute install path. The skill does not know where it is installed.

Scripts compute their own location (`import.meta.dir`, `$(dirname "$0")`,
`Path(__file__).parent`) rather than assuming an install path.

## Cross-skill references

Name the skill, not its path: "use the `git-worktree` skill", never
`~/.claude/skills/git-worktree/…`. Install layout is the host's business; over
MCP another skill may not be installed at all, and naming degrades gracefully.

## Tiers

`metadata.portability` in SKILL.md frontmatter declares the tier. Absence
claims **portable** and the lint verifies the claim.

- **portable** (default): meaningful on any machine that meets the skill's
  stated prerequisites. Needing macOS, an API key, or a CLI is portable —
  state the prerequisite in prose. Served by every MCP binding.
- **machine-bound** (`metadata.portability: machine-bound`): depends on this
  specific machine or account — Claude config under `~/.claude`, personal
  infrastructure hostnames, local hardware. Served only by the local stdio
  binding, never by the hosted one.

## Waivers

A line whose subject matter is a path — documentation about the layout itself,
not a reference the skill resolves — carries `portability: allow` in a comment
on that line (`<!-- portability: allow -->` in markdown). Waive sparingly: a
waiver asserts the path is content, not coupling.
