/**
 * The fixtures are unedited workflow-run records from fairchild/workspaces,
 * recorded with:
 *
 *   gh api "repos/fairchild/workspaces/actions/runs?head_sha=$SHA&per_page=100" \
 *     --jq '[.workflow_runs[] | {name, event, status, conclusion, createdAt: .created_at}]
 *           | sort_by(.createdAt) | reverse'
 *
 * 5d0b0314 is a commit where main had a test-target compile break: the `CI`
 * and `Web CI` push workflows are red while the scheduled automation around
 * them is green. 3cf09361 is genuinely green.
 */
import { describe, expect, test } from "bun:test";
import { ciVerdict, triggersOnTagPush, type WorkflowRun } from "./analyze.ts";

import red from "./fixtures/red-5d0b0314.json" with { type: "json" };
import green from "./fixtures/green-3cf09361.json" with { type: "json" };

/**
 * What the old gate did: most recent run on the branch, any workflow, any
 * event. Kept here so the regression it caused stays visible.
 */
function newestRunVerdict(runs: WorkflowRun[]): string {
  const run = runs[0];
  if (!run) return "none";
  if (run.status !== "completed") return "pending";
  return run.conclusion === "success" ? "success" : "failure";
}

const run = (over: Partial<WorkflowRun> = {}): WorkflowRun => ({
  name: "CI",
  event: "push",
  status: "completed",
  conclusion: "success",
  createdAt: "2026-08-01T00:00:00Z",
  ...over,
});

describe("ciVerdict on recorded fairchild/workspaces runs", () => {
  test("5d0b0314 fails - CI and Web CI are red over a compile break", () => {
    expect(ciVerdict(red as WorkflowRun[])).toBe("failure");

    const redPushRuns = (red as WorkflowRun[])
      .filter((r) => r.event === "push" && r.conclusion === "failure")
      .map((r) => r.name);
    expect(redPushRuns.sort()).toEqual(["CI", "Web CI"]);
  });

  test("3cf09361 passes - every push workflow is green", () => {
    expect(ciVerdict(green as WorkflowRun[])).toBe("success");
  });

  test("the old gate reported success on both, including the red one", () => {
    expect(newestRunVerdict(red as WorkflowRun[])).toBe("success");
    expect(newestRunVerdict(green as WorkflowRun[])).toBe("success");
  });

  test("a failing non-push workflow does not fail the green commit", () => {
    const noise = (green as WorkflowRun[]).filter(
      (r) => r.event !== "push" && r.conclusion === "failure"
    );
    expect(noise.length).toBeGreaterThan(0);
    expect(ciVerdict(green as WorkflowRun[])).toBe("success");
  });
});

describe("ciVerdict", () => {
  test("no runs at all is 'none', not success", () => {
    expect(ciVerdict([])).toBe("none");
  });

  test("only non-push runs is 'none' - nothing gated this commit", () => {
    expect(ciVerdict([run({ event: "schedule" }), run({ event: "workflow_run" })])).toBe("none");
  });

  test("all push runs skipped is 'none' - nothing was actually verified", () => {
    expect(ciVerdict([run({ conclusion: "skipped" })])).toBe("none");
  });

  test("a skipped workflow alongside a passing one still passes", () => {
    expect(
      ciVerdict([run({ name: "CI" }), run({ name: "Docs", conclusion: "skipped" })])
    ).toBe("success");
  });

  test("an incomplete run is pending", () => {
    expect(ciVerdict([run({ status: "in_progress", conclusion: null })])).toBe("pending");
  });

  test("failure outranks pending", () => {
    expect(
      ciVerdict([
        run({ name: "CI", conclusion: "failure" }),
        run({ name: "Docs", status: "queued", conclusion: null }),
      ])
    ).toBe("failure");
  });

  test("cancelled and timed_out count as failure", () => {
    expect(ciVerdict([run({ conclusion: "cancelled" })])).toBe("failure");
    expect(ciVerdict([run({ conclusion: "timed_out" })])).toBe("failure");
  });

  test("a re-run supersedes the earlier attempt", () => {
    const runs = [
      run({ conclusion: "success", createdAt: "2026-08-02T00:00:00Z" }),
      run({ conclusion: "failure", createdAt: "2026-08-01T00:00:00Z" }),
    ];
    expect(ciVerdict(runs)).toBe("success");
    expect(ciVerdict([...runs].reverse())).toBe("success");
  });

  test("a workflow that stays red is not rescued by another workflow passing later", () => {
    expect(
      ciVerdict([
        run({ name: "CI", conclusion: "failure", createdAt: "2026-08-01T00:00:00Z" }),
        run({ name: "Docs", conclusion: "success", createdAt: "2026-08-02T00:00:00Z" }),
      ])
    ).toBe("failure");
  });
});

describe("triggersOnTagPush", () => {
  test("block form", () => {
    expect(
      triggersOnTagPush("on:\n  push:\n    tags:\n      - 'v*'\njobs:\n  build:\n")
    ).toBe(true);
  });

  test("inline list form", () => {
    expect(triggersOnTagPush("on:\n  push:\n    tags: ['v*']\n")).toBe(true);
  });

  test("flow form", () => {
    expect(triggersOnTagPush("on: {push: {tags: ['v*']}}\n")).toBe(true);
  });

  test("quoted key", () => {
    expect(triggersOnTagPush('"on":\n  push:\n    tags:\n      - v*\n')).toBe(true);
  });

  test("branch-only push is not a tag trigger", () => {
    expect(
      triggersOnTagPush("on:\n  push:\n    branches: [main]\n  pull_request:\n")
    ).toBe(false);
  });

  test("tags under a non-push trigger is not a tag push", () => {
    expect(triggersOnTagPush("on:\n  create:\n    tags:\n      - 'v*'\n")).toBe(false);
  });

  test("a 'tags:' input elsewhere in the file is not a trigger", () => {
    expect(
      triggersOnTagPush(
        "on:\n  push:\n    branches: [main]\njobs:\n  build:\n    with:\n      tags: latest\n"
      )
    ).toBe(false);
  });

  test("comments are ignored", () => {
    expect(
      triggersOnTagPush("on:\n  push:\n    # tags: ['v*']\n    branches: [main]\n")
    ).toBe(false);
  });

  test("tag trigger after a branch trigger is still found", () => {
    expect(
      triggersOnTagPush("on:\n  pull_request:\n  push:\n    tags:\n      - 'v*'\n")
    ).toBe(true);
  });
});
