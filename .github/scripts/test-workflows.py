#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pyyaml==6.0.3"]
# ///
"""Protect workflow wiring; run with uv run --script .github/scripts/test-workflows.py."""

from pathlib import Path
import unittest

import yaml


WORKFLOWS = Path(__file__).resolve().parents[1] / "workflows"


def workflow(name: str) -> dict:
    # BaseLoader preserves Actions' `on` key instead of treating it as a boolean.
    return yaml.load((WORKFLOWS / name).read_text(), Loader=yaml.BaseLoader)


class WorkflowContractTests(unittest.TestCase):
    def test_pending_main_runs_cannot_replace_each_other(self) -> None:
        ci = workflow("ci.yml")
        # A pending skill push must survive a later docs-only push. PR runs may
        # replace each other; every non-PR run must have its own concurrency key.
        self.assertEqual(ci["concurrency"], {
            "group": "ci-${{ github.workflow }}-${{ github.event.pull_request.number || github.run_id }}",
            "cancel-in-progress": "${{ github.event_name == 'pull_request' }}",
        })
        for name in ("deploy-skills", "deploy-webui"):
            job = ci["jobs"][name]
            self.assertEqual(job["concurrency"]["group"], job["environment"]["name"])
            self.assertEqual(job["concurrency"]["cancel-in-progress"], "false")

    def test_deploy_jobs_check_needs_result_not_bare_ref(self) -> None:
        # gate has `if: always()` and needs every lane, several path-filtered
        # and often skipped. A skip anywhere in that chain propagates through
        # gate to any downstream job whose `if` relies on the implicit
        # success() check, even when gate's own conclusion is "success" — see
        # docs/github-actions.md and the run evidence for #290 (33952653246),
        # where deploy-skills and deploy-webui were both skipped despite gate
        # and package succeeding. Each deploy job must instead name
        # needs.gate.result and the result of its own artifact-producing lane
        # explicitly, not just the bare ref/event check.
        ci = workflow("ci.yml")
        artifact_lane = {"deploy-skills": "package", "deploy-webui": "webui"}
        for name, lane in artifact_lane.items():
            condition = ci["jobs"][name]["if"]
            self.assertIn("needs.gate.result == 'success'", condition)
            self.assertIn(f"needs.{lane}.result == 'success'", condition)
            self.assertNotRegex(condition.strip(), r"^\$\{\{\s*github\.ref\b")


if __name__ == "__main__":
    unittest.main()
