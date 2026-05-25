#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# ///
"""Reconcile ~/.agents and ~/.claude skill dirs against dotagents.toml.

Skills can live in two locations. ~/.agents/skills/ is the conventional
spot the `skills` CLI uses, and the location other agent harnesses
(Codex, Cursor, Gemini CLI, etc.) honor. ~/.claude/skills/ is where
Claude Code itself looks. To avoid duplication, the two directories are
wired together with symlinks — and dotagents.toml declares which
symlinks should exist in each direction.

The manifest has three sections:

  [ecosystem]       skill-name = "github-org/repo"
                    Skills installed by `skills add` into
                    ~/.agents/skills/. These start as real directories
                    there and are tracked by ~/.agents/.skill-lock.json
                    (which the `skills` CLI owns — this script does not
                    edit the lockfile).

  [link-to-claude]  skill-name = true
                    Of the ecosystem skills, which should also appear
                    in ~/.claude/skills/ as symlinks pointing back into
                    ~/.agents/skills/. Symlinks in this direction make
                    ecosystem skills visible to Claude Code.

  [share-to-agents] skill-name = true
                    Of the dotclaude-authored skills (real dirs under
                    ~/.claude/skills/, tracked in this git repo), which
                    should also appear in ~/.agents/skills/ as symlinks
                    pointing back into ~/.claude/skills/. Symlinks in
                    this direction make dotclaude skills available to
                    other agent harnesses.

Nothing enforces this manifest at install time — the `skills` CLI
doesn't know about it, and manual symlinks can be added by anyone. So
this script doesn't act as a gate; it catches drift after the fact and
offers a one-pass reconciler.

Commands:
    audit                Print a markdown drift report. Default.
    audit --strict       Same, but exit 1 if any issues exist. For hooks.
    sync                 Install missing ecosystem skills via the CLI,
                         create missing symlinks in both directions,
                         and refresh the .gitignore block.
    gitignore            Write the auto-managed .gitignore block from
                         [link-to-claude]. Called automatically by sync.
    status               One-line health summary for status bars / hooks.
"""

from __future__ import annotations

import subprocess
import sys
import tomllib
from dataclasses import dataclass
from os import readlink, symlink, unlink
from os.path import relpath
from pathlib import Path


# ── Paths and markers ──────────────────────────────────────────────
#
# The two skill directories live in fixed, known locations on the
# user's machine. They aren't configurable here because the whole point
# of the convention is that other tools (the `skills` CLI, Claude Code,
# Cursor, Codex) can find skills at the standard path without
# coordination.
#
# MANIFEST and GITIGNORE are resolved relative to this script's
# location, not $HOME, so the script works correctly from either the
# dev clone (~/code/dotclaude/) or the runtime (~/.claude/). It always
# touches the manifest and .gitignore that sit next to it.

HOME = Path.home()
CLAUDE_SKILLS = HOME / ".claude" / "skills"
AGENTS_SKILLS = HOME / ".agents" / "skills"

MANIFEST = Path(__file__).resolve().parent.parent / "dotagents.toml"
GITIGNORE = MANIFEST.parent / ".gitignore"

# The .gitignore block this script manages is bounded by these
# markers so it can rewrite its own slice without disturbing entries
# the user maintains by hand elsewhere in the file.
GITIGNORE_BEGIN = "# BEGIN sync-dotagents (generated from dotagents.toml — do not edit)"
GITIGNORE_END = "# END sync-dotagents"


def tilde(path: Path) -> str:
    """Render a path with $HOME collapsed to ~ for friendlier output."""
    return str(path).replace(str(HOME), "~")


def die(msg: str) -> None:
    print(msg, file=sys.stderr)
    sys.exit(1)


# ── The manifest: what we want ─────────────────────────────────────
#
# dotagents.toml describes the desired state. The script's job is to
# move the filesystem toward that state (in sync mode) or report on the
# gap (in audit mode).
#
# Loading is strict: a skill name appearing in both [ecosystem] and
# [share-to-agents] would mean "we want symlinks in both directions for
# the same name" — which would form a cycle and has no sensible
# resolution. The CLI bails rather than guessing.

@dataclass
class Manifest:
    ecosystem: dict[str, str]           # name → "github-org/repo"
    link_to_claude: dict[str, bool]     # ecosystem entries that mirror into ~/.claude/skills/
    share_to_agents: dict[str, bool]    # dotclaude entries that mirror into ~/.agents/skills/

    @classmethod
    def load(cls) -> Manifest:
        raw = tomllib.loads(MANIFEST.read_text())
        manifest = cls(
            ecosystem={k: v for k, v in raw.get("ecosystem", {}).items() if isinstance(v, str)},
            link_to_claude={k: v for k, v in raw.get("link-to-claude", {}).items() if isinstance(v, bool)},
            share_to_agents={k: v for k, v in raw.get("share-to-agents", {}).items() if isinstance(v, bool)},
        )

        # Two structural invariants. Violations are operator errors
        # (typos, copy-paste mistakes) we want to surface loudly at
        # load time rather than have produce silent "missing symlink"
        # reports during sync.

        # ecosystem ∩ share-to-agents would mean symlinks pointing in
        # opposite directions for the same name — a cycle. (This also
        # catches the link-to-claude ∩ share-to-agents case, since
        # link-to-claude entries must be in ecosystem per the next
        # check.)
        overlap = set(manifest.ecosystem) & set(manifest.share_to_agents)
        if overlap:
            die(f"Skills in both [ecosystem] and [share-to-agents]: {', '.join(sorted(overlap))}")

        # link-to-claude ⊆ ecosystem — a link-to-claude entry needs an
        # ecosystem install to point at. Without this check, a typo
        # would manifest as a quiet "target not found" during sync
        # with no signal that the manifest itself is inconsistent.
        unknown = set(manifest.link_to_claude) - set(manifest.ecosystem)
        if unknown:
            die(f"Skills in [link-to-claude] but not [ecosystem]: {', '.join(sorted(unknown))}")

        return manifest


# ── Filesystem inspection: what we see ─────────────────────────────
#
# Each path under skills/ is in one of four states. We deliberately
# distinguish "directory" from "symlink", because a real directory at
# a path we expected to be a symlink almost always means someone (often
# the `skills` CLI running in parallel, or a manual install) wrote
# content there. The reconciler refuses to clobber real content
# automatically — the conflict surfaces to the user instead.

def what_is(path: Path) -> str:
    """Classify a path: 'missing', 'symlink', 'directory', or 'file'."""
    if path.is_symlink():
        return "symlink"
    if not path.exists():
        return "missing"
    return "directory" if path.is_dir() else "file"


def relative_target(link: Path, target: Path) -> str:
    """The relative path a symlink at `link` should contain to reach `target`.

    Relative symlinks (../../.agents/skills/foo) survive a $HOME change
    or a parent-tree move; absolute symlinks (/Users/.../skills/foo) do
    not. We always create relative ones, though we accept either form
    as valid when checking existing links — the `skills` CLI sometimes
    produces absolute ones we don't want to churn unnecessarily.
    """
    return relpath(target, link.parent)


# ── Link verification ──────────────────────────────────────────────
#
# A symlink is "ok" when its target string matches what we'd write
# today (the relative form) OR matches the absolute form of the same
# destination. Accepting both forms avoids fighting historical links
# the `skills` CLI may have created with absolute paths.

@dataclass
class LinkCheck:
    name: str
    expected: str
    actual: str | None
    ok: bool

    @property
    def as_row(self) -> str:
        """Render this check as a single row in the audit's markdown table."""
        if self.ok:
            return f"| {self.name} | ok | {self.actual} |"
        if self.actual is None:
            detail = "**missing**"
        elif self.actual == "(real directory)":
            detail = f"**conflict** {self.actual}"
        else:
            detail = f"**wrong** → {self.actual}"
        return f"| {self.name} | {detail} | expected: {self.expected} |"


def check_link(name: str, link_dir: Path, target_dir: Path) -> LinkCheck:
    """Verify a single symlink: does it exist, and does it point at the right place?

    `link_dir` is where the symlink lives; `target_dir` is what it
    should point at. The two flip depending on which direction we're
    checking (ecosystem → claude vs dotclaude → agents).
    """
    link, target = link_dir / name, target_dir / name
    expected = relative_target(link, target)

    match what_is(link):
        case "missing":
            return LinkCheck(name, expected, None, ok=False)
        case "symlink":
            actual = str(readlink(link))
            # Accept both relative and absolute forms — see note above.
            return LinkCheck(name, expected, actual, ok=actual in (expected, str(target)))
        case "directory":
            return LinkCheck(name, expected, "(real directory)", ok=False)
        case _:
            return LinkCheck(name, expected, "(unknown)", ok=False)


# ── Commands ───────────────────────────────────────────────────────
#
# Four entry points wrap the inspection and reconciliation logic. The
# split is deliberate: `audit` is pure read-only — `sync` is the only
# mode that mutates the filesystem. `gitignore` is a narrow utility
# `sync` calls automatically but that's also exposed standalone for
# refresh-without-symlink-changes workflows. `status` is a terse
# single-line summary suited to hooks.

def audit(manifest: Manifest) -> int:
    """Print a markdown drift report and return the number of issues found.

    The report has four sections:
      1. Ecosystem skills — installed in ~/.agents/skills/?
      2. Ecosystem → Claude symlinks — do they point where the manifest says?
      3. Dotclaude → Agents symlinks — same check, other direction.
      4. Unmanaged — skills in ~/.agents/skills/ the manifest doesn't know.

    Returns the issue count so the CLI wrapper can exit non-zero when
    --strict is passed (for use in SessionStart hooks).
    """
    ok = issues = 0
    print("# Dotagents Audit\n")

    # 1. Are ecosystem skills installed in ~/.agents/skills/?
    print("## Ecosystem Skills\n")
    print("| Skill | Source | Installed |")
    print("|-------|--------|-----------|")
    for name, source in manifest.ecosystem.items():
        installed = what_is(AGENTS_SKILLS / name) != "missing"
        ok += installed; issues += not installed
        print(f"| {name} | {source} | {'yes' if installed else '**NO**'} |")

    # 2 & 3. Are symlinks correct in both directions?
    for entries, link_dir, target_dir, heading in [
        (manifest.link_to_claude, CLAUDE_SKILLS, AGENTS_SKILLS,
         "Ecosystem → Claude (symlinks in ~/.claude/skills/)"),
        (manifest.share_to_agents, AGENTS_SKILLS, CLAUDE_SKILLS,
         "Dotclaude → Agents (symlinks in ~/.agents/skills/)"),
    ]:
        checks = [check_link(n, link_dir, target_dir) for n in entries]
        print(f"\n## {heading}\n")
        print("| Skill | Status | Target |")
        print("|-------|--------|--------|")
        for c in checks:
            ok += c.ok; issues += not c.ok
            print(c.as_row)

    # 4. Anything in ~/.agents/skills/ the manifest doesn't know about?
    # These don't count toward the issue tally (the user may have
    # deliberately installed something outside the manifest), but they
    # surface so drift is at least visible.
    print("\n## Unmanaged Skills in ~/.agents/skills/\n")
    if AGENTS_SKILLS.exists():
        managed = set(manifest.ecosystem) | set(manifest.share_to_agents)
        unmanaged = sorted(p for p in AGENTS_SKILLS.iterdir()
                           if not p.name.startswith(".") and p.name not in managed)
        if unmanaged:
            for p in unmanaged:
                print(f"- {p.name}{' (symlink)' if p.is_symlink() else ''}")
            print("\nAdd to dotagents.toml or remove from ~/.agents/skills/")
        else:
            print("None — all skills are tracked in manifest.")
    else:
        print("~/.agents/skills/ not found")

    print(f"\n## Summary\n\n- OK: {ok}\n- Issues: {issues}")
    return issues


def sync(manifest: Manifest) -> None:
    """Reconcile the filesystem with the manifest, in three passes.

    1. Install ecosystem skills missing from ~/.agents/skills/ by
       shelling out to the `skills` CLI.

    2. Walk both symlink directions (ecosystem → claude, dotclaude →
       agents). For each entry, either create the symlink, fix one
       that points at the wrong place, or report a conflict and skip.

       We never auto-delete a real directory found where a symlink
       should be — that path may hold user content not in git. The
       user gets a copy-pasteable `rm -rf` instead.

    3. Refresh the .gitignore block so it matches the manifest.
    """
    print("# Dotagents Sync\n")
    installed = created = skipped = 0

    # Pass 1: install ecosystem skills not yet on disk.
    for name, source in manifest.ecosystem.items():
        if what_is(AGENTS_SKILLS / name) != "missing":
            continue
        print(f"Installing {name} from {source}...")
        result = subprocess.run(["skills", "add", source, "--skill", name, "--yes"])
        if result.returncode == 0:
            installed += 1
        else:
            print(f"  Failed (exit {result.returncode})")

    # Pass 2: ensure symlinks exist in both directions. The two
    # iterations have the same shape — only the source/dest dirs and
    # the conflict-hint message differ — so we share the loop body.
    for entries, link_dir, target_dir, conflict_hint in [
        (manifest.link_to_claude, CLAUDE_SKILLS, AGENTS_SKILLS,
         "Remove manually if ecosystem version should replace it:"),
        (manifest.share_to_agents, AGENTS_SKILLS, CLAUDE_SKILLS,
         "This is likely an ecosystem install that duplicates a dotclaude skill."),
    ]:
        for name in entries:
            link, target = link_dir / name, target_dir / name
            expected = relative_target(link, target)

            # Can't link to something that doesn't exist. Skip and let
            # the next pass / next sync run pick it up after the
            # target appears.
            if what_is(target) == "missing":
                print(f"Skip {name}: target not found in {tilde(target_dir)}/")
                skipped += 1; continue

            match what_is(link):
                case "symlink":
                    actual = str(readlink(link))
                    if actual in (expected, str(target)):
                        continue  # already correct
                    # Wrong target — replace.
                    print(f"Fixing {name}: {actual} → {expected}")
                    unlink(link)
                case "directory":
                    # Real content where we expected a symlink. Don't
                    # clobber; surface for the user to decide.
                    print(f"CONFLICT {name}: real directory at {link}")
                    print(f"  {conflict_hint}")
                    print(f"  rm -rf {link} && ./scripts/sync-dotagents.py sync")
                    skipped += 1; continue
                case "file":
                    print(f"CONFLICT {name}: unexpected file at {link}")
                    skipped += 1; continue

            symlink(expected, link)
            print(f"Linked {tilde(link_dir)}/{name} → {expected}")
            created += 1

    print(f"\nDone: {installed} installed, {created} linked, {skipped} skipped")

    # Pass 3: keep .gitignore in step with what we just created.
    gitignore(manifest)


def gitignore(manifest: Manifest) -> None:
    """Write the auto-managed block into .gitignore from [link-to-claude].

    Symlinks in ~/.claude/skills/ that point into ~/.agents/ are
    filesystem plumbing, not source — they shouldn't appear in
    `git status`. Listing them here keeps the working tree clean.

    The block is bounded by GITIGNORE_BEGIN / GITIGNORE_END markers, so
    this rewrites its own slice without touching anything else in the
    file (hand-maintained entries like `skills/code-council` survive).
    If the block doesn't yet exist, it's appended; if it does, its body
    is replaced in place.
    """
    entries = sorted(manifest.link_to_claude)
    block_lines = [GITIGNORE_BEGIN, *(f"skills/{name}" for name in entries), GITIGNORE_END]
    block = "\n".join(block_lines)

    text = GITIGNORE.read_text() if GITIGNORE.exists() else ""
    lines = text.splitlines()

    try:
        # Block already present — replace its body in place.
        start = lines.index(GITIGNORE_BEGIN)
        end = lines.index(GITIGNORE_END, start)
        new_lines = lines[:start] + block_lines + lines[end + 1:]
        new_text = "\n".join(new_lines) + ("\n" if text.endswith("\n") else "")
        action = "Updated"
    except ValueError:
        # No block yet — append, separated from prior content by a
        # blank line for readability.
        sep = "" if text.endswith("\n\n") or not text else ("\n" if text.endswith("\n") else "\n\n")
        new_text = text + sep + block + "\n"
        action = "Appended"

    if new_text == text:
        print(f"gitignore: no change ({len(entries)} entries)")
        return
    GITIGNORE.write_text(new_text)
    print(f"gitignore: {action} block in {tilde(GITIGNORE)} ({len(entries)} entries)")


def status(manifest: Manifest) -> None:
    """Print a single-line health summary.

    Designed for SessionStart hooks and status bars: success reads
    "dotagents ✓ 55/55 (24 eco, 22→claude, 9→agents)"; drift reads
    "dotagents ! 47/55 (...) 8 issues". The healthy/total counts cover
    the three manifest sections combined, so a single number captures
    the whole reconciliation state.
    """
    healthy = (
        sum(what_is(AGENTS_SKILLS / n) != "missing" for n in manifest.ecosystem)
        + sum(check_link(n, CLAUDE_SKILLS, AGENTS_SKILLS).ok for n in manifest.link_to_claude)
        + sum(check_link(n, AGENTS_SKILLS, CLAUDE_SKILLS).ok for n in manifest.share_to_agents)
    )
    total = len(manifest.ecosystem) + len(manifest.link_to_claude) + len(manifest.share_to_agents)
    missing = total - healthy
    icon = "✓" if missing == 0 else "!"
    tail = f" {missing} issues" if missing else ""
    eco, link, share = len(manifest.ecosystem), len(manifest.link_to_claude), len(manifest.share_to_agents)
    print(f"dotagents {icon} {healthy}/{total} ({eco} eco, {link}→claude, {share}→agents){tail}")


# ── CLI entry point ────────────────────────────────────────────────
#
# Two-token CLI: `<command> [--strict]`. We parse --strict out of argv
# by hand rather than reaching for argparse — the flag only attaches
# meaningfully to `audit`, and mixing options across commands isn't
# worth a third-party dependency or the boilerplate.

if __name__ == "__main__":
    args = sys.argv[1:]
    strict = "--strict" in args
    args = [a for a in args if a != "--strict"]
    command = args[0] if args else "audit"
    manifest = Manifest.load()

    match command:
        case "audit":
            issues = audit(manifest)
            # --strict turns audit into a CI/hook check — non-zero exit
            # when anything is off, so the hook surfaces drift loudly.
            if strict and issues:
                sys.exit(1)
        case "sync":     sync(manifest)
        case "gitignore": gitignore(manifest)
        case "status":   status(manifest)
        case _:
            print("Usage: ./scripts/sync-dotagents.py [audit|sync|gitignore|status] [--strict]\n")
            print("  audit       Show current state, conflicts, and drift (default)")
            print("  sync        Install missing ecosystem skills + create symlinks + refresh gitignore")
            print("  gitignore   Write the auto-managed block into .gitignore from manifest")
            print("  status      One-line summary")
            print("  --strict    With audit, exit non-zero when issues > 0 (for hooks)")
            sys.exit(1)
