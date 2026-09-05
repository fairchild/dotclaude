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
`~/.claude/skills/git-worktree/…`, and never a climb out of this skill's own
directory into a sibling's (`../git-worktree/…`,
`$(dirname "$0")/../../git-worktree/…`). Install layout is the host's
business: skills that sit side by side here need not sit side by side there,
and over MCP another skill may not be installed at all. Naming degrades
gracefully.

## Tiers

`metadata.portability` in SKILL.md frontmatter declares the tier. Absence
claims **portable** and the lint verifies the claim. The test: would the skill
do its job on a stranger's machine that has the stated prerequisites
installed?

- **portable** (default): meaningful on any machine that meets the skill's
  stated prerequisites. Needing macOS, an API key, a CLI, or Claude Code
  itself is portable — state the prerequisite in prose. A skill operating on
  the consumer's *own* `~/.claude` (their config, their session data) is
  portable with Claude Code as the prerequisite. Served by every MCP binding.
- **machine-bound** (`metadata.portability: machine-bound`): depends on this
  specific machine or account — personal infrastructure hostnames, local
  hardware, accounts only the author holds. Served only by the local stdio
  binding, never by the hosted one.

Skills in the repo's `local` tier (listed in `skills/.gitignore`, untracked)
are outside the lint's scope — it walks `git ls-files` — and are served only
by the local binding, which reads the live directory.

## Waivers

`portability: allow` in a comment on the flagged line (`<!-- … -->` in
markdown, `// …` or `# …` in code) asserts the reference is deliberate. The
lint also matches programmatic home-path forms (`${process.env.HOME}/.claude`,
`join(HOME, ".claude", …)`, `Path.home() / ".claude"`) and programmatic climbs
into a sibling skill (`join(import.meta.dir, "..", "..", "<skill>")`,
`Path(__file__).parent.parent.parent / "<skill>"`), so waivers appear in code
as well as prose. Three grounds justify one:

1. **Content, not coupling** — the line's subject matter is a path:
   documentation about the layout itself, not a reference the skill resolves.
2. **Consumer-config access** — runtime code reading or writing the invoking
   user's own `~/.claude`, where Claude Code is a stated prerequisite. The
   waiver marks the touchpoint as examined; grepping for waivers inventories
   exactly where a skill touches consumer config.
3. **Declared optional integration** — a conventional default path for a
   cross-skill or external integration that is environment-overridable and
   feature-detected, degrading cleanly when absent.

Waive sparingly, and say which ground applies when it isn't obvious from the
line itself.
