#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Focused stdlib tests for agent_pressure.py."""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.dont_write_bytecode = True

SCRIPT = Path(__file__).parents[1] / "scripts" / "agent_pressure.py"
SPEC = importlib.util.spec_from_file_location("agent_pressure", SCRIPT)
assert SPEC and SPEC.loader
agent_pressure = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = agent_pressure
SPEC.loader.exec_module(agent_pressure)


class AgentPressureTests(unittest.TestCase):
    def test_run_command_turns_permission_error_into_visibility_gap(self) -> None:
        with patch.object(agent_pressure.subprocess, "run", side_effect=PermissionError(1, "Operation not permitted")):
            stdout, error = agent_pressure.run_command(["ps"])
        self.assertEqual(stdout, "")
        self.assertIn("Operation not permitted", error)

    def test_parse_vm_stat_uses_page_size_and_values(self) -> None:
        parsed = agent_pressure.parse_vm_stat(
            "Mach Virtual Memory Statistics: (page size of 16384 bytes)\n"
            "Pages free:                               1,234.\n"
            "Swapouts:                                  567.\n"
        )
        self.assertEqual(parsed["page_size"], 16384)
        self.assertEqual(parsed["pages"]["Pages free"], 1234)
        self.assertEqual(parsed["pages"]["Swapouts"], 567)

    def test_classify_process_avoids_codex_path_false_positive(self) -> None:
        self.assertEqual(
            agent_pressure.classify_process("/usr/bin/node /Users/me/.codex/worktrees/abc/server.js"),  # portability: allow
            "Node/Bun/Deno",
        )
        self.assertEqual(
            agent_pressure.classify_process("/Applications/Codex.app/Contents/MacOS/Codex app-server"),
            "Codex",
        )

    def test_detached_long_lived_filters_by_parent_age_and_family(self) -> None:
        processes = [
            {"pid": 10, "ppid": 1, "rss_mib": 800.0, "age_seconds": 25000, "etime": "06:56:40", "command": "/tmp/workerd", "family": "Cloudflare workerd"},
            {"pid": 11, "ppid": 3, "rss_mib": 900.0, "age_seconds": 30000, "etime": "08:20:00", "command": "/tmp/workerd", "family": "Cloudflare workerd"},
            {"pid": 12, "ppid": 1, "rss_mib": 700.0, "age_seconds": 100, "etime": "01:40", "command": "/tmp/workerd", "family": "Cloudflare workerd"},
        ]
        self.assertEqual([row["pid"] for row in agent_pressure.detached_processes(processes)], [10])

    def test_assessment_uses_active_swap_rate_not_cumulative_swap(self) -> None:
        snapshot = {
            "memory": {
                "free_percent": 42.0,
                "compressor_percent": 20.0,
                "swapout_mib_per_minute": 0.0,
                "swapouts_cumulative_mib": 999999.0,
            },
            "load": {"normalized_5m": 0.8},
        }
        result = agent_pressure.assess(snapshot)
        self.assertEqual(result["overall"], "green")

    def test_assessment_red_for_active_thrashing(self) -> None:
        snapshot = {
            "memory": {"free_percent": 15.0, "compressor_percent": 50.0, "swapout_mib_per_minute": 75.0},
            "load": {"normalized_5m": 2.4},
        }
        result = agent_pressure.assess(snapshot)
        self.assertEqual(result["overall"], "red")
        self.assertIn("active swap-out detected", result["reasons"])

    def collect_with_second_vm_stat(self, second: tuple[str, str]) -> dict:
        vm_text = "Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free: 1000.\nSwapouts: 10.\n"
        vm_replies = iter([(vm_text, ""), second])

        def fake_run(command: list[str]) -> tuple[str, str]:
            if command[0] == "vm_stat":
                return next(vm_replies)
            return {"uptime": ("load averages: 1.0 1.0 1.0", ""), "sysctl": ("8", "")}.get(command[0], ("", ""))

        with patch.object(agent_pressure, "run_command", side_effect=fake_run):
            return agent_pressure.collect_snapshot(0)

    def test_failed_second_vm_stat_reports_unknown_swap_not_zero(self) -> None:
        snapshot = self.collect_with_second_vm_stat(("", "vm_stat: timed out"))
        self.assertIsNone(snapshot["memory"]["swapout_mib_per_minute"])
        self.assertEqual(snapshot["assessment"]["dimensions"]["swap"], "unknown")
        self.assertTrue(any("second vm_stat" in error for error in snapshot["errors"]))

    def test_two_vm_stat_samples_report_a_swap_rate(self) -> None:
        later = "Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free: 1000.\nSwapouts: 10.\n"
        snapshot = self.collect_with_second_vm_stat((later, ""))
        self.assertEqual(snapshot["memory"]["swapout_mib_per_minute"], 0.0)
        self.assertEqual(snapshot["assessment"]["dimensions"]["swap"], "green")

    def test_compare_snapshots_reports_direction(self) -> None:
        before = {
            "captured_at": "before",
            "memory": {"free_percent": 20, "swapout_mib_per_minute": 80},
            "load": {"normalized_5m": 2.0},
            "processes": {"families": [{"family": "Codex", "rss_mib": 2000}]},
        }
        after = {
            "captured_at": "after",
            "memory": {"free_percent": 40, "swapout_mib_per_minute": 0},
            "load": {"normalized_5m": 0.5},
            "processes": {"families": [{"family": "Codex", "rss_mib": 1000}]},
        }
        result = agent_pressure.compare_snapshots(before, after)
        self.assertEqual(result["free_percent_delta"], 20.0)
        self.assertEqual(result["swapout_rate_delta"], -80.0)
        self.assertEqual(result["family_rss_deltas"][0]["rss_mib_delta"], -1000.0)


if __name__ == "__main__":
    unittest.main()
