#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only macOS memory, load, and agent-process pressure check."""

from __future__ import annotations

import argparse
import json
import os
import platform
import re
import subprocess
import sys
import time
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

BYTES_PER_MIB = 1024 * 1024
STATUS_ORDER = {"green": 0, "yellow": 1, "red": 2, "unknown": -1}


def run_command(args: list[str]) -> tuple[str, str]:
    try:
        result = subprocess.run(
            args,
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return "", str(exc)
    if result.returncode != 0:
        return result.stdout, result.stderr.strip() or f"exit {result.returncode}"
    return result.stdout, ""


def parse_vm_stat(text: str) -> dict[str, Any]:
    page_match = re.search(r"page size of\s+(\d+) bytes", text)
    page_size = int(page_match.group(1)) if page_match else 4096
    pages: dict[str, int] = {}
    for line in text.splitlines():
        match = re.match(r"([^:]+):\s+([\d,.]+)\.?$", line.strip())
        if match:
            pages[match.group(1).strip()] = int(match.group(2).replace(",", "").replace(".", ""))
    return {"page_size": page_size, "pages": pages}


def parse_memory_pressure(text: str) -> float | None:
    match = re.search(r"System-wide memory free percentage:\s*([\d.]+)%", text)
    return float(match.group(1)) if match else None


def parse_uptime_load(text: str) -> list[float] | None:
    match = re.search(r"load averages?:\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)", text)
    if not match:
        return None
    return [float(match.group(index)) for index in range(1, 4)]


def elapsed_seconds(value: str) -> int | None:
    """Parse ps etime values: [[dd-]hh:]mm:ss."""
    try:
        days = 0
        if "-" in value:
            day_text, value = value.split("-", 1)
            days = int(day_text)
        parts = [int(part) for part in value.split(":")]
        if len(parts) == 3:
            hours, minutes, seconds = parts
        elif len(parts) == 2:
            hours, (minutes, seconds) = 0, parts
        else:
            return None
        return days * 86400 + hours * 3600 + minutes * 60 + seconds
    except ValueError:
        return None


def command_executable(command: str) -> str:
    first = command.strip().split(maxsplit=1)[0] if command.strip() else ""
    return os.path.basename(first).lower()


def classify_process(command: str) -> str:
    lower = command.lower()
    executable = command_executable(command)

    if "workerd" in executable or "/workerd" in lower:
        return "Cloudflare workerd"
    if "wrangler" in lower or "miniflare" in lower:
        return "Wrangler/miniflare"
    if "/google chrome.app/" in lower or "chrome helper" in lower:
        return "Google Chrome"
    if "/claude.app/" in lower or executable == "claude" or "@anthropic-ai/claude-code" in lower:
        return "Claude"
    if "/codex.app/" in lower or executable == "codex" or re.search(r"\bcodex\s+app-server\b", lower):
        return "Codex"
    if "/orca.app/" in lower or "workspacemanager" in lower:
        return "Orca/WorkSpaces"
    if executable in {"zig", "zig2", "swiftc", "xcodebuild", "cargo", "rustc", "clang", "clang++"}:
        return "Build tools"
    if (
        "/orbstack.app/" in lower
        or "com.apple.virtualization.virtualmachine" in lower
        or executable.startswith("qemu-system")
        or executable in {"lume", "tart"}
    ):
        return "VMs/containers"
    if executable in {"node", "bun", "deno"}:
        return "Node/Bun/Deno"
    if "/safari.app/" in lower or "/firefox.app/" in lower or "/arc.app/" in lower:
        return "Other browsers"
    return "Other"


def parse_ps(text: str) -> list[dict[str, Any]]:
    processes: list[dict[str, Any]] = []
    for line in text.splitlines():
        parts = line.strip().split(maxsplit=4)
        if len(parts) != 5:
            continue
        try:
            pid, ppid, rss_kib = (int(parts[index]) for index in range(3))
        except ValueError:
            continue
        age_seconds = elapsed_seconds(parts[3])
        command = parts[4]
        processes.append(
            {
                "pid": pid,
                "ppid": ppid,
                "rss_mib": round(rss_kib / 1024, 1),
                "age_seconds": age_seconds,
                "etime": parts[3],
                "command": command,
                "family": classify_process(command),
            }
        )
    return processes


def aggregate_processes(processes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    totals: dict[str, dict[str, float | int]] = defaultdict(lambda: {"rss_mib": 0.0, "count": 0})
    for process in processes:
        family = str(process["family"])
        totals[family]["rss_mib"] = float(totals[family]["rss_mib"]) + float(process["rss_mib"])
        totals[family]["count"] = int(totals[family]["count"]) + 1
    return sorted(
        (
            {"family": family, "rss_mib": round(float(values["rss_mib"]), 1), "count": int(values["count"])}
            for family, values in totals.items()
            if family != "Other"
        ),
        key=lambda row: float(row["rss_mib"]),
        reverse=True,
    )


def agent_counts(processes: list[dict[str, Any]]) -> dict[str, int]:
    counts = {"codex_app_servers": 0, "codex_cli": 0, "claude_cli": 0}
    for process in processes:
        command = str(process["command"])
        lower = command.lower()
        executable = command_executable(command)
        if re.search(r"\bcodex\s+app-server\b", lower):
            counts["codex_app_servers"] += 1
        elif executable == "codex" and ".app/" not in lower:
            counts["codex_cli"] += 1
        if (executable == "claude" and ".app/" not in lower) or "@anthropic-ai/claude-code" in lower:
            counts["claude_cli"] += 1
    return counts


def detached_processes(processes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    candidates = {"Cloudflare workerd", "Wrangler/miniflare", "Node/Bun/Deno"}
    return sorted(
        (
            process
            for process in processes
            if process["family"] in candidates
            and process["ppid"] == 1
            and (process["age_seconds"] or 0) >= 6 * 3600
        ),
        key=lambda process: float(process["rss_mib"]),
        reverse=True,
    )[:10]


def vm_page_value(vm: dict[str, Any], name: str) -> int:
    return int(vm.get("pages", {}).get(name, 0))


def page_delta_mib(before: dict[str, Any], after: dict[str, Any], name: str, seconds: float) -> float:
    delta_pages = max(0, vm_page_value(after, name) - vm_page_value(before, name))
    page_size = int(after.get("page_size", 4096))
    return delta_pages * page_size / BYTES_PER_MIB * 60 / max(seconds, 0.001)


def max_status(*statuses: str) -> str:
    return max(statuses, key=lambda status: STATUS_ORDER.get(status, -1))


def assess(snapshot: dict[str, Any]) -> dict[str, Any]:
    free = snapshot["memory"].get("free_percent")
    swapout_rate = snapshot["memory"].get("swapout_mib_per_minute")
    compressor = snapshot["memory"].get("compressor_percent")
    normalized_load = snapshot["load"].get("normalized_5m")

    memory_status = "unknown"
    if free is not None:
        memory_status = "red" if free < 20 else "yellow" if free < 30 else "green"
    swap_status = "unknown"
    if swapout_rate is not None:
        swap_status = "red" if swapout_rate >= 50 else "yellow" if swapout_rate >= 5 else "green"
    compressor_status = "unknown"
    if compressor is not None:
        compressor_status = "red" if compressor >= 45 else "yellow" if compressor >= 30 else "green"
    load_status = "unknown"
    if normalized_load is not None:
        load_status = "red" if normalized_load >= 2 else "yellow" if normalized_load >= 1 else "green"

    known = [status for status in (memory_status, swap_status, compressor_status, load_status) if status != "unknown"]
    overall = max_status(*known) if known else "unknown"
    reasons: list[str] = []
    if swap_status in {"yellow", "red"}:
        reasons.append("active swap-out detected")
    if memory_status in {"yellow", "red"}:
        reasons.append("low free/reclaimable memory")
    if compressor_status in {"yellow", "red"}:
        reasons.append("high compressor occupancy")
    if load_status in {"yellow", "red"}:
        reasons.append("load exceeds available CPU capacity")
    if not reasons and overall == "green":
        reasons.append("no active pressure signal crossed a threshold")

    return {
        "overall": overall,
        "dimensions": {
            "memory": memory_status,
            "swap": swap_status,
            "compressor": compressor_status,
            "load": load_status,
        },
        "reasons": reasons,
    }


def collect_snapshot(sample_seconds: float) -> dict[str, Any]:
    errors: list[str] = []
    memory_text, memory_error = run_command(["memory_pressure"])
    if memory_error:
        errors.append(f"memory_pressure: {memory_error}")

    before_text, before_error = run_command(["vm_stat"])
    if before_error:
        errors.append(f"vm_stat: {before_error}")
    before_vm = parse_vm_stat(before_text)

    uptime_text, uptime_error = run_command(["uptime"])
    if uptime_error:
        errors.append(f"uptime: {uptime_error}")

    cpu_text, cpu_error = run_command(["sysctl", "-n", "hw.ncpu"])
    cpu_count = int(cpu_text.strip()) if cpu_text.strip().isdigit() else os.cpu_count()
    if cpu_error and cpu_count is None:
        errors.append(f"sysctl hw.ncpu: {cpu_error}")

    ps_text, ps_error = run_command(["ps", "-axo", "pid=,ppid=,rss=,etime=,command="])
    if ps_error:
        errors.append(f"process inspection: {ps_error}")
    processes = parse_ps(ps_text)

    start = time.monotonic()
    if sample_seconds > 0:
        time.sleep(sample_seconds)
    after_text, after_error = run_command(["vm_stat"])
    elapsed = max(time.monotonic() - start, 0.001)
    if after_error:
        errors.append(f"second vm_stat: {after_error}")
    after_vm = parse_vm_stat(after_text) if after_text else before_vm
    # A rate needs two real samples; a missing reading is unknown, not zero swap.
    vm_read = bool(after_vm.get("pages"))
    vm_sampled = bool(before_vm.get("pages")) and bool(after_text) and not before_error and not after_error

    def vm_mib(name: str) -> float | None:
        return round(vm_page_value(after_vm, name) * page_size / BYTES_PER_MIB, 1) if vm_read else None

    def vm_rate(name: str) -> float | None:
        return round(page_delta_mib(before_vm, after_vm, name, elapsed), 2) if vm_sampled else None

    page_size = int(after_vm.get("page_size", 4096))
    physical_names = (
        "Pages free",
        "Pages active",
        "Pages inactive",
        "Pages speculative",
        "Pages wired down",
        "Pages occupied by compressor",
        "Pages throttled",
    )
    total_pages = sum(vm_page_value(after_vm, name) for name in physical_names)
    compressor_pages = vm_page_value(after_vm, "Pages occupied by compressor")
    compressor_percent = compressor_pages / total_pages * 100 if total_pages else None
    load = parse_uptime_load(uptime_text)
    normalized = load[1] / cpu_count if load and cpu_count else None

    snapshot: dict[str, Any] = {
        "schema_version": 1,
        "captured_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "host": platform.node(),
        "sample_seconds": round(elapsed, 3),
        "memory": {
            "free_percent": parse_memory_pressure(memory_text),
            "compressor_mib": vm_mib("Pages occupied by compressor"),
            "compressor_percent": round(compressor_percent, 1) if compressor_percent is not None else None,
            "swapins_cumulative_mib": vm_mib("Swapins"),
            "swapouts_cumulative_mib": vm_mib("Swapouts"),
            "swapin_mib_per_minute": vm_rate("Swapins"),
            "swapout_mib_per_minute": vm_rate("Swapouts"),
        },
        "load": {
            "averages": load,
            "cpu_count": cpu_count,
            "normalized_5m": round(normalized, 2) if normalized is not None else None,
        },
        "processes": {
            "available": not bool(ps_error),
            "families": aggregate_processes(processes)[:12],
            "top": sorted(processes, key=lambda process: float(process["rss_mib"]), reverse=True)[:12],
            "detached_long_lived": detached_processes(processes),
            "agent_counts": agent_counts(processes),
        },
        "errors": errors,
    }
    snapshot["assessment"] = assess(snapshot)
    return snapshot


def family_map(snapshot: dict[str, Any]) -> dict[str, float]:
    return {
        str(row["family"]): float(row["rss_mib"])
        for row in snapshot.get("processes", {}).get("families", [])
    }


def compare_snapshots(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    before_families = family_map(before)
    after_families = family_map(after)
    names = set(before_families) | set(after_families)
    family_delta = sorted(
        (
            {"family": name, "rss_mib_delta": round(after_families.get(name, 0) - before_families.get(name, 0), 1)}
            for name in names
        ),
        key=lambda row: abs(float(row["rss_mib_delta"])),
        reverse=True,
    )

    def numeric_delta(section: str, key: str) -> float | None:
        old = before.get(section, {}).get(key)
        new = after.get(section, {}).get(key)
        return round(float(new) - float(old), 2) if old is not None and new is not None else None

    return {
        "baseline_captured_at": before.get("captured_at"),
        "free_percent_delta": numeric_delta("memory", "free_percent"),
        "swapout_rate_delta": numeric_delta("memory", "swapout_mib_per_minute"),
        "normalized_load_delta": numeric_delta("load", "normalized_5m"),
        "family_rss_deltas": family_delta[:10],
    }


def fmt_number(value: Any, suffix: str = "") -> str:
    return "unknown" if value is None else f"{value}{suffix}"


def print_human(snapshot: dict[str, Any]) -> None:
    assessment = snapshot["assessment"]
    memory = snapshot["memory"]
    load = snapshot["load"]
    processes = snapshot["processes"]
    print(f"macOS agent pressure: {assessment['overall'].upper()}")
    print(f"Captured: {snapshot['captured_at']} on {snapshot['host']}")
    print(f"Why: {', '.join(assessment['reasons']) or 'insufficient evidence'}")
    print()
    print("Memory")
    print(f"  Free/reclaimable: {fmt_number(memory['free_percent'], '%')}")
    print(f"  Compressor: {fmt_number(memory['compressor_mib'], ' MiB')} ({fmt_number(memory['compressor_percent'], '%')})")
    print(f"  Swap-in rate: {fmt_number(memory['swapin_mib_per_minute'], ' MiB/min')}")
    print(f"  Swap-out rate: {fmt_number(memory['swapout_mib_per_minute'], ' MiB/min')}")
    print(f"  Cumulative swap in/out: {memory['swapins_cumulative_mib']} / {memory['swapouts_cumulative_mib']} MiB (historical)")
    print()
    averages = load["averages"]
    average_text = " / ".join(str(value) for value in averages) if averages else "unknown"
    print("Load")
    print(f"  1/5/15 min: {average_text}")
    print(f"  CPUs: {fmt_number(load['cpu_count'])}; normalized 5m: {fmt_number(load['normalized_5m'], 'x')}")
    print()
    print("Agent process counts")
    for name, count in processes["agent_counts"].items():
        print(f"  {name.replace('_', ' ')}: {count}")
    print()
    print("Largest process families")
    if processes["families"]:
        for row in processes["families"][:8]:
            print(f"  {row['family']}: {row['rss_mib']} MiB across {row['count']} processes")
    else:
        print("  unavailable")
    if processes["detached_long_lived"]:
        print()
        print("Detached long-lived tool/development processes")
        for process in processes["detached_long_lived"]:
            command = str(process["command"])
            if len(command) > 110:
                command = command[:107] + "..."
            print(f"  PID {process['pid']}: {process['rss_mib']} MiB, age {process['etime']}, {command}")
    comparison = snapshot.get("comparison")
    if comparison:
        print()
        print(f"Comparison with {comparison['baseline_captured_at']}")
        print(f"  Free/reclaimable delta: {fmt_number(comparison['free_percent_delta'], ' points')}")
        print(f"  Swap-out rate delta: {fmt_number(comparison['swapout_rate_delta'], ' MiB/min')}")
        print(f"  Normalized load delta: {fmt_number(comparison['normalized_load_delta'], 'x')}")
        for row in comparison["family_rss_deltas"][:5]:
            print(f"  {row['family']} RSS delta: {row['rss_mib_delta']:+.1f} MiB")
    if snapshot["errors"]:
        print()
        print("Visibility gaps")
        for error in snapshot["errors"]:
            print(f"  {error}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sample-seconds", type=float, default=5.0, help="Seconds used to measure swap activity (default: 5)")
    parser.add_argument("--json", action="store_true", help="Print the complete snapshot as JSON")
    parser.add_argument("--save", type=Path, help="Save the complete JSON snapshot to this path")
    parser.add_argument("--compare", type=Path, help="Compare with a previously saved JSON snapshot")
    parser.add_argument("--strict", action="store_true", help="Exit 1 for yellow and 2 for red")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if platform.system() != "Darwin":
        print("agent_pressure.py requires macOS", file=sys.stderr)
        return 2
    if args.sample_seconds < 0:
        print("--sample-seconds must be non-negative", file=sys.stderr)
        return 2
    snapshot = collect_snapshot(args.sample_seconds)
    if args.compare:
        try:
            baseline = json.loads(args.compare.read_text())
        except (OSError, json.JSONDecodeError) as exc:
            print(f"Could not read baseline {args.compare}: {exc}", file=sys.stderr)
            return 2
        snapshot["comparison"] = compare_snapshots(baseline, snapshot)
    if args.save:
        args.save.parent.mkdir(parents=True, exist_ok=True)
        args.save.write_text(json.dumps(snapshot, indent=2, sort_keys=True) + "\n")
    if args.json:
        print(json.dumps(snapshot, indent=2, sort_keys=True))
    else:
        print_human(snapshot)
    if args.strict:
        return {"green": 0, "yellow": 1, "red": 2, "unknown": 2}.get(snapshot["assessment"]["overall"], 2)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
