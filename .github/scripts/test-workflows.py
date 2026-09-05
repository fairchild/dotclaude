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

    def test_ci_and_release_share_all_package_checks(self) -> None:
        ci = workflow("ci.yml")["jobs"]
        release = workflow("release-skill-server.yml")["jobs"]
        shared = workflow("verify-skill-server.yml")
        for caller in (ci["package"], release["candidate"]):
            self.assertEqual(caller["uses"], "./.github/workflows/verify-skill-server.yml")
            self.assertNotIn("secrets", caller)
        self.assertIn("workflow_call", shared["on"])
        self.assertEqual(shared["permissions"], {"contents": "read"})
        self.assertEqual(shared["jobs"]["consumer"]["needs"], "package")
        self.assertEqual(shared["jobs"]["consumer"]["strategy"]["matrix"], {
            "os": ["ubuntu-latest", "macos-latest", "windows-latest"],
            "node": ["22", "24"],
        })
        self.assertEqual(release["candidate"]["needs"], "validate-tag")
        self.assertEqual(release["publish"]["needs"], "candidate")
        self.assertIn("package", ci["gate"]["needs"])
        self.assertIn("package", ci["deploy-skills"]["needs"])

    def test_artifact_consumers_match_shared_producer(self) -> None:
        shared = workflow("verify-skill-server.yml")["jobs"]
        produced = {
            step["with"]["name"]
            for step in shared["package"]["steps"]
            if step.get("uses", "").startswith("actions/upload-artifact@")
        }
        consumers = [shared["consumer"]]
        consumers.append(workflow("release-skill-server.yml")["jobs"]["publish"])
        consumers.append(workflow("ci.yml")["jobs"]["deploy-skills"])
        for job in consumers:
            downloads = [
                step["with"]["name"] for step in job["steps"]
                if step.get("uses", "").startswith("actions/download-artifact@")
            ]
            self.assertTrue(downloads)
            self.assertTrue(set(downloads) <= produced)


if __name__ == "__main__":
    unittest.main()
