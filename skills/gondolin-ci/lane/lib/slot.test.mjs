import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { holder, releaseSlot, takeSlot } from "./slot.mjs";

const freshDir = () => join(mkdtempSync(join(tmpdir(), "slot-")), "vm.slot");
const script = fileURLToPath(new URL("./slot.mjs", import.meta.url));

// A pid that is certainly alive and is not this process: a child that sleeps.
function bystander() {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"]);
  return { pid: child.pid, stop: () => child.kill() };
}

test("a free slot is taken at once and names its holder", async () => {
  const dir = freshDir();
  const release = await takeSlot({ dir, label: "pr 1 lint" });
  assert.equal(holder(dir).pid, process.pid);
  assert.equal(holder(dir).label, "pr 1 lint");
  release();
  assert.equal(holder(dir), null);
});

test("a second taker waits until the first lets go", async () => {
  const dir = freshDir();
  const first = bystander();
  try {
    await takeSlot({ dir, pid: first.pid, label: "first" });
    let waits = 0;
    const second = takeSlot({ dir, label: "second", pollMs: 20, onWait: () => waits++ });
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(holder(dir).label, "first", "still the first's while it holds it");
    assert.ok(waits > 0, "the second was told it is waiting");
    releaseSlot({ dir, pid: first.pid });
    (await second)();
  } finally {
    first.stop();
  }
});

test("a slot whose holder died is taken over", async () => {
  const dir = freshDir();
  const gone = spawnSync(process.execPath, ["-e", ""]).pid;
  mkdirSync(dir);
  writeFileSync(join(dir, "owner.json"), JSON.stringify({ pid: gone, label: "crashed", since: "" }));
  const release = await takeSlot({ dir, label: "next", pollMs: 20 });
  assert.equal(holder(dir).label, "next");
  release();
});

test("a slot left without an owner is cleared rather than waited on forever", async () => {
  const dir = freshDir();
  mkdirSync(dir);
  const release = await takeSlot({ dir, label: "next", pollMs: 20 });
  assert.equal(holder(dir).label, "next");
  release();
});

test("releasing does not take the slot away from someone else", async () => {
  const dir = freshDir();
  const other = bystander();
  try {
    await takeSlot({ dir, pid: other.pid, label: "theirs" });
    releaseSlot({ dir });
    assert.equal(holder(dir).label, "theirs");
  } finally {
    other.stop();
  }
});

test("of several takers racing for a stale slot, exactly one holds it at a time", async () => {
  const dir = freshDir();
  const gone = spawnSync(process.execPath, ["-e", ""]).pid;
  mkdirSync(dir);
  writeFileSync(join(dir, "owner.json"), JSON.stringify({ pid: gone, label: "crashed", since: "" }));
  const racers = [bystander(), bystander(), bystander()];
  let holding = 0;
  let most = 0;
  try {
    await Promise.all(
      racers.map(async (racer) => {
        const release = await takeSlot({ dir, pid: racer.pid, label: `racer ${racer.pid}`, pollMs: 15 });
        most = Math.max(most, ++holding);
        await new Promise((resolve) => setTimeout(resolve, 40));
        holding--;
        release();
      }),
    );
  } finally {
    for (const racer of racers) racer.stop();
  }
  assert.equal(most, 1);
});

test("the command line holds the slot for the pid it is given", () => {
  const dir = freshDir();
  const env = { ...process.env, XDG_STATE_HOME: join(dir, "..", "state") };
  const owner = bystander();
  try {
    assert.equal(spawnSync(process.execPath, [script, "who"], { env }).stdout.toString().trim(), "free");
    assert.equal(spawnSync(process.execPath, [script, "take", String(owner.pid), "pr", "7", "files"], { env }).status, 0);
    assert.match(spawnSync(process.execPath, [script, "who"], { env }).stdout.toString(), new RegExp(`^${owner.pid}  pr 7 files  since `));
    assert.equal(spawnSync(process.execPath, [script, "release", String(owner.pid)], { env }).status, 0);
    assert.equal(spawnSync(process.execPath, [script, "who"], { env }).stdout.toString().trim(), "free");
  } finally {
    owner.stop();
  }
});

test("GONDOLIN_PARALLEL=1 runs beside whoever holds the slot", async () => {
  const dir = freshDir();
  const other = bystander();
  process.env.GONDOLIN_PARALLEL = "1";
  try {
    mkdirSync(dir);
    writeFileSync(join(dir, "owner.json"), JSON.stringify({ pid: other.pid, label: "theirs", since: "" }));
    (await takeSlot({ dir, label: "beside" }))();
    assert.equal(holder(dir).label, "theirs");
  } finally {
    delete process.env.GONDOLIN_PARALLEL;
    other.stop();
  }
});
