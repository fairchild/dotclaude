#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# ///
"""Manage ~/.agents skills and symlinks from dotagents.toml.

Usage:
    ./scripts/sync-dotagents.py audit   — show current state and drift
    ./scripts/sync-dotagents.py sync    — install missing skills + create symlinks
    ./scripts/sync-dotagents.py status  — one-line summary for hooks
"""

from __future__ import annotations

import subprocess
import sys
import tomllib
from dataclasses import dataclass
from os import readlink, symlink, unlink
from os.path import relpath
from pathlib import Path


# ── Where things live ──

HOME = Path.home()
CLAUDE_SKILLS = HOME / ".claude" / "skills"
AGENTS_SKILLS = HOME / ".agents" / "skills"
MANIFEST = Path(__file__).resolve().parent.parent / "dotagents.toml"


def tilde(path: Path) -> str:
    """~/readable/path"""
    return str(path).replace(str(HOME), "~")


def die(msg: str) -> None:
    print(msg, file=sys.stderr)
    sys.exit(1)


# ── What we want (the manifest) ──

@dataclass
class Manifest:
    ecosystem: dict[str, str]           # name → github source
    link_to_claude: dict[str, bool]     # ecosystem skills to symlink into claude
    share_to_agents: dict[str, bool]    # dotclaude skills to symlink into agents

    @classmethod
    def load(cls) -> Manifest:
        raw = tomllib.loads(MANIFEST.read_text())
        manifest = cls(
            ecosystem={k: v for k, v in raw.get("ecosystem", {}).items() if isinstance(v, str)},
            link_to_claude={k: v for k, v in raw.get("link-to-claude", {}).items() if isinstance(v, bool)},
            share_to_agents={k: v for k, v in raw.get("share-to-agents", {}).items() if isinstance(v, bool)},
        )

        # A skill can't come from both directions
        overlap = set(manifest.ecosystem) & set(manifest.share_to_agents)
        if overlap:
            die(f"Skills in both [ecosystem] and [share-to-agents]: {', '.join(sorted(overlap))}")

        return manifest


# ── What we see (filesystem inspection) ──

def what_is(path: Path) -> str:
    """Classify a path: 'missing', 'symlink', 'directory', or 'file'."""
    if path.is_symlink():
        return "symlink"
    if not path.exists():
        return "missing"
    return "directory" if path.is_dir() else "file"


def relative_target(link: Path, target: Path) -> str:
    """The relative path a symlink should contain."""
    return relpath(target, link.parent)


# ── Do they match? (link verification) ──

@dataclass
class LinkCheck:
    name: str
    expected: str
    actual: str | None
    ok: bool

    @property
    def as_row(self) -> str:
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
    """Does this symlink exist and point where the manifest says it should?"""
    link, target = link_dir / name, target_dir / name
    expected = relative_target(link, target)

    match what_is(link):
        case "missing":
            return LinkCheck(name, expected, None, ok=False)
        case "symlink":
            actual = str(readlink(link))
            return LinkCheck(name, expected, actual, ok=actual in (expected, str(target)))
        case "directory":
            return LinkCheck(name, expected, "(real directory)", ok=False)
        case _:
            return LinkCheck(name, expected, "(unknown)", ok=False)


# ── Commands ──

def audit(manifest: Manifest) -> None:
    ok = issues = 0
    print("# Dotagents Audit\n")

    # Are ecosystem skills installed in ~/.agents/skills/?
    print("## Ecosystem Skills\n")
    print("| Skill | Source | Installed |")
    print("|-------|--------|-----------|")
    for name, source in manifest.ecosystem.items():
        installed = what_is(AGENTS_SKILLS / name) != "missing"
        ok += installed; issues += not installed
        print(f"| {name} | {source} | {'yes' if installed else '**NO**'} |")

    # Are symlinks correct in both directions?
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

    # Anything in ~/.agents/skills/ that the manifest doesn't know about?
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


def sync(manifest: Manifest) -> None:
    print("# Dotagents Sync\n")
    installed = created = skipped = 0

    # Install any ecosystem skills not yet in ~/.agents/skills/
    for name, source in manifest.ecosystem.items():
        if what_is(AGENTS_SKILLS / name) != "missing":
            continue
        print(f"Installing {name} from {source}...")
        result = subprocess.run(["skills", "add", source, "--skill", name, "--yes"])
        if result.returncode == 0:
            installed += 1
        else:
            print(f"  Failed (exit {result.returncode})")

    # Ensure symlinks exist in both directions
    for entries, link_dir, target_dir, conflict_hint in [
        (manifest.link_to_claude, CLAUDE_SKILLS, AGENTS_SKILLS,
         "Remove manually if ecosystem version should replace it:"),
        (manifest.share_to_agents, AGENTS_SKILLS, CLAUDE_SKILLS,
         "This is likely an ecosystem install that duplicates a dotclaude skill."),
    ]:
        for name in entries:
            link, target = link_dir / name, target_dir / name
            expected = relative_target(link, target)

            if what_is(target) == "missing":
                print(f"Skip {name}: target not found in {tilde(target_dir)}/")
                skipped += 1; continue

            match what_is(link):
                case "symlink":
                    actual = str(readlink(link))
                    if actual in (expected, str(target)):
                        continue  # already correct
                    print(f"Fixing {name}: {actual} → {expected}")
                    unlink(link)
                case "directory":
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


def status(manifest: Manifest) -> None:
    """One-line health check — suitable for hooks or status bars."""
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


# ── Main ──

if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) > 1 else "audit"
    manifest = Manifest.load()

    match command:
        case "audit":  audit(manifest)
        case "sync":   sync(manifest)
        case "status": status(manifest)
        case _:
            print("Usage: ./scripts/sync-dotagents.py [audit|sync|status]\n")
            print("  audit   Show current state, conflicts, and drift (default)")
            print("  sync    Install missing ecosystem skills + create symlinks")
            print("  status  One-line summary")
            sys.exit(1)
