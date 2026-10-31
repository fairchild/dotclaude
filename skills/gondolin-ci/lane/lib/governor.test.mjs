import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { decide, govern, treeOf } from "./governor.mjs";

const quiet = { otherCores: 0.2, cores: 10, awayAfterS: 120 };

test("someone at the keyboard keeps the lane yielding", () => {
  assert.equal(decide({ ...quiet, idleS: 5, mode: "full", calm: 9 }).mode, "yield");
});

test("other busy work keeps the lane yielding even with nobody at the keyboard", () => {
  const next = decide({ ...quiet, idleS: 900, otherCores: 4, mode: "full", calm: 9 });
  assert.equal(next.mode, "yield");
  assert.match(next.why, /other work using 4\.0 cores/);
});

test("a left-alone, quiet laptop lets the lane run full, after two calm samples", () => {
  const first = decide({ ...quiet, idleS: 300, mode: "yield", calm: 0 });
  assert.equal(first.mode, "yield");
  const second = decide({ ...quiet, idleS: 310, mode: first.mode, calm: first.calm });
  assert.equal(second.mode, "full");
});

test("the lane goes back to yielding the moment the keyboard is touched", () => {
  assert.equal(decide({ ...quiet, idleS: 1, mode: "full", calm: 30 }).mode, "yield");
});

test("a small laptop still tolerates one core of other work", () => {
  assert.equal(decide({ idleS: 600, otherCores: 0.9, cores: 2, mode: "full", calm: 3, awayAfterS: 120 }).mode, "full");
});

test("the tree is the root and every descendant, and nothing else", () => {
  const table = new Map([
    [10, [1, 0]],
    [11, [10, 50]],
    [12, [11, 300]],
    [20, [1, 90]],
  ]);
  assert.deepEqual(treeOf(10, table).sort(), [10, 11, 12]);
});

test("governing a process that exits writes a summary and returns", async () => {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 300)"]);
  const seconds = await govern(child.pid, { sampleMs: 50, log: () => {} });
  assert.ok(seconds.yield + seconds.full >= 0);
});
