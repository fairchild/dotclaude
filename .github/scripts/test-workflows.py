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



if __name__ == "__main__":
    unittest.main()
