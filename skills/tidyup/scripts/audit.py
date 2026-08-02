#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# ///
"""Audit a repo's git worktrees and local branches for tidyup: classify each as
KEEP, SAFE (provably landed in main), DIRTY_MERGED (landed, but has uncommitted
files), or UNKNOWN. Merged-PR metadata is the ground truth because squash merges
defeat ancestry checks. Read-only; --plan emits a reviewable deletion script."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from dataclasses import asdict, dataclass
from pathlib import Path


def run(args: list[str], cwd: Path | None = None) -> str:
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True).stdout


def git(repo: Path, *args: str) -> str:
    return run(["git", "-C", str(repo), *args]).strip()


def is_ancestor(repo: Path, commit: str, of: str) -> bool:
    r = subprocess.run(
        ["git", "-C", str(repo), "merge-base", "--is-ancestor", commit, of],
        capture_output=True,
    )
    return r.returncode == 0


@dataclass
class Item:
    name: str  # branch name, or path for detached worktrees
    path: str | None  # None for branch-only items
    head: str
    dirty: int
    last_commit: str
    tier: str  # oid-match | ancestor | pr-name-match | none
    merged_pr: int | None
    cls: str  # KEEP | SAFE | DIRTY_MERGED | UNKNOWN
    keep_reason: str | None


def parse_worktrees(primary: Path) -> list[dict[str, str | None]]:
    out = run(["git", "-C", str(primary), "worktree", "list", "--porcelain"])
    entries: list[dict[str, str | None]] = []
    cur: dict[str, str | None] = {}
    for line in out.splitlines():
        if line.startswith("worktree "):
            cur = {"path": line[9:], "branch": None, "head": ""}
            entries.append(cur)
        elif line.startswith("HEAD "):
            cur["head"] = line[5:]
        elif line.startswith("branch refs/heads/"):
            cur["branch"] = line[len("branch refs/heads/") :]
    return entries


def gh_prs(repo: Path, state: str, limit: int) -> list[dict]:
    out = run(
        ["gh", "pr", "list", "--state", state, "--limit", str(limit),
         "--json", "headRefName,headRefOid,number"],
        cwd=repo,
    )
    try:
        return json.loads(out or "[]")
    except json.JSONDecodeError:
        return []


def classify(
    *, name: str, path: str | None, head: str, dirty: int, last: str,
    keep_reason: str | None, primary: Path, base: str,
    merged_by_name: dict[str, int], merged_by_oid: dict[str, int],
) -> Item:
    tier, pr = "none", None
    if head in merged_by_oid:
        tier, pr = "oid-match", merged_by_oid[head]
    elif is_ancestor(primary, head, base):
        tier = "ancestor"
    elif name in merged_by_name:
        tier, pr = "pr-name-match", merged_by_name[name]
    if keep_reason:
        cls = "KEEP"
    elif tier == "none":
        cls = "UNKNOWN"
    else:
        cls = "DIRTY_MERGED" if dirty else "SAFE"
    return Item(name, path, head, dirty, last, tier, pr, cls, keep_reason)


def emit_plan(path: Path, primary: Path, worktrees: list[Item], branches: list[Item], scope: str) -> None:
    classes = {"SAFE"} if scope == "safe" else {"SAFE", "DIRTY_MERGED"}
    doomed = [w for w in worktrees if w.cls in classes and w.path != str(primary)]
    doomed.sort(key=lambda w: len(w.path or ""), reverse=True)  # nested worktrees first
    orca = shutil.which("orca")
    lines = [
        "#!/bin/bash",
        f"# tidyup plan — scope={scope}. Review before running; log full output to a file.",
        "set -u",
    ]
    for w in doomed:
        assert w.path
        if orca and "/orca/" in w.path:
            lines.append(f"orca worktree rm --worktree 'path:{w.path}' --force --json")
        lines.append(f"git -C {primary} worktree remove --force '{w.path}' && echo 'REMOVED {w.path}'")
    lines.append(f"git -C {primary} worktree prune")
    doomed_branches = {w.name for w in doomed if w.path != w.name} | {
        b.name for b in branches if b.cls in classes
    }
    for br in sorted(doomed_branches):
        lines.append(f"git -C {primary} branch -D '{br}'")
    lines.append(f"git -C {primary} worktree list")
    path.write_text("\n".join(lines) + "\n")
    path.chmod(0o755)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--repo", type=Path, default=None, help="any checkout of the repo (default: cwd)")
    ap.add_argument("--limit", type=int, default=1000, help="merged PRs to fetch")
    ap.add_argument("--json", type=Path, default=None, help="write full detail as JSON")
    ap.add_argument("--plan", type=Path, default=None, help="write a deletion plan script")
    ap.add_argument("--plan-scope", choices=["safe", "dirty-merged"], default="safe")
    ap.add_argument("--keep", action="append", default=[], help="extra path or branch to protect")
    args = ap.parse_args()

    start = args.repo or Path.cwd()
    toplevel = git(start, "rev-parse", "--show-toplevel")
    if not toplevel:
        print("not inside a git repository", file=sys.stderr)
        return 1
    entries = parse_worktrees(Path(toplevel))
    primary = Path(entries[0]["path"])  # git lists the main worktree first
    current = toplevel

    head_ref = git(primary, "symbolic-ref", "--quiet", "refs/remotes/origin/HEAD")
    default_branch = head_ref.rsplit("/", 1)[-1] if head_ref else "main"
    base = f"origin/{default_branch}"
    git(primary, "fetch", "origin", default_branch, "--quiet")

    merged = gh_prs(primary, "merged", args.limit)
    merged_by_name = {p["headRefName"]: p["number"] for p in reversed(merged)}
    merged_by_oid = {p["headRefOid"]: p["number"] for p in reversed(merged)}
    open_prs = {p["headRefName"]: p["number"] for p in gh_prs(primary, "open", 100)}

    def keep_reason(path: str | None, branch: str | None) -> str | None:
        if path == str(primary):
            return "primary checkout"
        if path == current:
            return "current session"
        if branch and branch in open_prs:
            return f"open PR #{open_prs[branch]}"
        if branch == default_branch:
            return "default branch"
        if path in args.keep or branch in args.keep:
            return "--keep"
        return None

    worktrees, kept_branches = [], set()
    for e in entries:
        path, branch = e["path"], e["branch"]
        assert path
        p = Path(path)
        dirty = len(run(["git", "-C", path, "status", "--porcelain"]).splitlines()) if p.is_dir() else 0
        last = git(p, "log", "-1", "--format=%cs") if p.is_dir() else ""
        item = classify(
            name=branch or path, path=path, head=e["head"] or "", dirty=dirty, last=last,
            keep_reason=keep_reason(path, branch), primary=primary, base=base,
            merged_by_name=merged_by_name, merged_by_oid=merged_by_oid,
        )
        worktrees.append(item)
        if item.cls == "KEEP" and branch:
            kept_branches.add(branch)

    branches = []
    for line in git(primary, "for-each-ref", "--format=%(refname:short) %(objectname)", "refs/heads/").splitlines():
        br, oid = line.rsplit(" ", 1)
        if br in kept_branches:
            continue
        branches.append(
            classify(
                name=br, path=None, head=oid, dirty=0,
                last=git(primary, "log", "-1", "--format=%cs", br),
                keep_reason=keep_reason(None, br), primary=primary, base=base,
                merged_by_name=merged_by_name, merged_by_oid=merged_by_oid,
            )
        )

    def summary(items: list[Item]) -> str:
        counts: dict[str, int] = {}
        for i in items:
            counts[i.cls] = counts.get(i.cls, 0) + 1
        return "  ".join(f"{k}={v}" for k, v in sorted(counts.items()))

    print(f"repo: {primary}  base: {base}  merged PRs seen: {len(merged)}")
    print(f"worktrees ({len(worktrees)}): {summary(worktrees)}")
    print(f"branches  ({len(branches)}): {summary(branches)}")
    print()
    for i in worktrees + [b for b in branches if b.cls != "SAFE"]:
        loc = i.path or "(branch only)"
        extra = i.keep_reason or (f"PR #{i.merged_pr}" if i.merged_pr else i.tier)
        print(f"{i.cls:13} dirty={i.dirty:<3} last={i.last_commit or '-':10} {i.name}  {loc}  [{extra}]")

    if args.json:
        args.json.write_text(json.dumps(
            {"worktrees": [asdict(w) for w in worktrees], "branches": [asdict(b) for b in branches]},
            indent=2,
        ))
    if args.plan:
        emit_plan(args.plan, primary, worktrees, branches, args.plan_scope)
        print(f"\nplan written: {args.plan} (scope={args.plan_scope}; UNKNOWN never auto-deleted)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
