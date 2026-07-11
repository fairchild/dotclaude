#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Manage dotclaude's public-source and private-runtime boundary."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import tomllib
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path


@dataclass(frozen=True)
class Paths:
    source: Path
    runtime: Path
    backup_root: Path


def resolve_paths() -> Paths:
    default_source = Path(__file__).resolve().parent.parent
    source = (
        Path(os.environ.get("DOTCLAUDE_SOURCE_REPO", default_source))
        .expanduser()
        .resolve()
    )
    runtime = Path(
        os.environ.get("DOTCLAUDE_RUNTIME", Path.home() / ".claude")
    ).expanduser()
    backup_root = Path(
        os.environ.get(
            "DOTCLAUDE_BACKUP_ROOT",
            Path.home() / ".local" / "share" / "dotclaude" / "migration-backups",
        )
    ).expanduser()
    return Paths(source=source, runtime=runtime, backup_root=backup_root)


def git(path: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(path), *args],
        check=check,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def is_independent_clone(runtime: Path) -> bool:
    return runtime.is_dir() and not runtime.is_symlink() and (runtime / ".git").is_dir()


def backup_ambiguous_runtime(paths: Paths) -> Path:
    paths.backup_root.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    backup = paths.backup_root / f"claude-runtime-{stamp}-{os.getpid()}"
    paths.runtime.rename(backup)
    print(f"BACKED UP: ambiguous runtime -> {backup}")
    return backup


def require_independent_main(paths: Paths) -> bool:
    if paths.runtime.is_symlink():
        print("FAIL: runtime is a symlink, not an independent clone")
        return False
    if paths.runtime.is_dir() and (paths.runtime / ".git").is_file():
        print("FAIL: runtime is a Git worktree; ~/.claude must be an independent clone")
        return False
    if not is_independent_clone(paths.runtime):
        print("FAIL: runtime is not an independent Git clone")
        return False
    branch = git(paths.runtime, "branch", "--show-current").stdout.strip()
    if branch != "main":
        print(f"FAIL: runtime branch is {branch or 'detached'}; expected main")
        return False
    return True


def classify_drift(runtime: Path) -> tuple[int, int, int]:
    result = git(
        runtime,
        "status",
        "--porcelain=v1",
        "--ignored=matching",
        "--untracked-files=normal",
    )
    tracked = unknown = ignored = 0
    for line in result.stdout.splitlines():
        status = line[:2]
        if status == "!!":
            ignored += 1
        elif status == "??":
            unknown += 1
        else:
            tracked += 1
    return tracked, unknown, ignored


def sync_runtime(paths: Paths) -> int:
    if not require_independent_main(paths):
        return 1
    tracked, unknown, ignored = classify_drift(paths.runtime)
    if tracked:
        print(f"FAIL: tracked source drift: {tracked} path(s)")
        return 1
    if unknown:
        print(f"FAIL: unknown unignored runtime drift: {unknown} path(s)")
        return 1
    git(paths.runtime, "fetch", "origin", "main")
    git(paths.runtime, "merge", "--ff-only", "origin/main")
    print(
        f"OK: runtime fast-forwarded on main; allowed ignored runtime entries: {ignored}"
    )
    return 0


def cmd_bootstrap(paths: Paths) -> int:
    if paths.runtime.exists() or paths.runtime.is_symlink():
        if paths.runtime.is_dir() and (paths.runtime / ".git").is_file():
            print(
                "FAIL: refusing to move a registered Git worktree at the runtime path"
            )
            return 1
        if is_independent_clone(paths.runtime):
            return sync_runtime(paths)
        backup_ambiguous_runtime(paths)

    remote = git(paths.source, "remote", "get-url", "origin").stdout.strip()
    if not remote:
        print("FAIL: source checkout has no origin remote")
        return 1
    paths.runtime.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "git",
            "clone",
            "--branch",
            "main",
            "--single-branch",
            remote,
            str(paths.runtime),
        ],
        check=True,
    )
    if not require_independent_main(paths):
        return 1
    print("OK: created independent dotclaude runtime clone on main")
    return 0


def validate_json(path: Path) -> bool:
    try:
        with path.open(encoding="utf-8") as handle:
            value = json.load(handle)
        return isinstance(value, dict)
    except (OSError, json.JSONDecodeError):
        return False


def check_skill_links(paths: Paths) -> tuple[int, int]:
    manifest_path = paths.runtime / "dotagents.toml"
    try:
        manifest = tomllib.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError):
        return 0, 1

    agents_skills = Path.home() / ".agents" / "skills"
    checks: list[tuple[Path, Path]] = []
    for name, enabled in manifest.get("link-to-claude", {}).items():
        if enabled is True:
            checks.append((paths.runtime / "skills" / name, agents_skills / name))
    for name, enabled in manifest.get("share-to-agents", {}).items():
        if enabled is True:
            checks.append((agents_skills / name, paths.runtime / "skills" / name))

    failed = 0
    for link, target in checks:
        if not link.is_symlink() or link.resolve(strict=False) != target.resolve(
            strict=False
        ):
            failed += 1
    return len(checks), failed


def cmd_doctor(paths: Paths) -> int:
    failures = 0

    def ok(message: str) -> None:
        print(f"OK: {message}")

    def fail(message: str) -> None:
        nonlocal failures
        failures += 1
        print(f"FAIL: {message}")

    if not require_independent_main(paths):
        failures += 1
    else:
        ok("runtime is an independent clone on main")

    if failures == 0:
        tracked, unknown, ignored = classify_drift(paths.runtime)
        if tracked:
            fail(f"tracked source drift: {tracked} path(s)")
        else:
            ok("tracked source has no local drift")
        if unknown:
            fail(f"unknown unignored runtime drift: {unknown} path(s)")
        else:
            ok(f"runtime policy accepts {ignored} ignored generated/private entry(s)")

        origin_main = git(
            paths.runtime, "rev-parse", "--verify", "origin/main", check=False
        )
        if origin_main.returncode != 0:
            fail("origin/main is unavailable; run mise run sync")
        else:
            counts = git(
                paths.runtime,
                "rev-list",
                "--left-right",
                "--count",
                "HEAD...origin/main",
            ).stdout.split()
            ahead, behind = (int(value) for value in counts)
            if ahead or behind:
                fail(
                    f"tracked source is not synchronized (ahead={ahead}, behind={behind})"
                )
            else:
                ok("tracked source matches the last fetched origin/main")

        if validate_json(paths.runtime / "settings.json"):
            ok("settings.json is structured configuration")
        else:
            fail("settings.json is missing, invalid, or not an object")

        total_links, failed_links = check_skill_links(paths)
        if failed_links:
            fail(f"required skill-link drift: {failed_links} of {total_links}")
        else:
            ok(f"required skill links match dotagents.toml ({total_links})")

    if failures:
        print(f"doctor: FAILED ({failures} problem(s))")
        return 1
    print("doctor: OK")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="dotclaude source/runtime participant CLI"
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser(
        "bootstrap", help="create or reconcile the independent runtime clone"
    )
    subparsers.add_parser("sync", help="fast-forward clean tracked source on main")
    subparsers.add_parser("doctor", help="read-only source/runtime validation")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    paths = resolve_paths()
    try:
        if args.command == "bootstrap":
            return cmd_bootstrap(paths)
        if args.command == "sync":
            return sync_runtime(paths)
        if args.command == "doctor":
            return cmd_doctor(paths)
    except (OSError, subprocess.CalledProcessError) as error:
        if isinstance(error, subprocess.CalledProcessError):
            print(f"FAIL: Git operation exited {error.returncode}")
        else:
            print(
                f"FAIL: filesystem operation could not be completed ({error.__class__.__name__})"
            )
        return 1
    raise SystemExit("unknown command")


if __name__ == "__main__":
    raise SystemExit(main())
