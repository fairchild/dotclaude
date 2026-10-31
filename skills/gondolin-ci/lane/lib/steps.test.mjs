import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createLineSplitter, createStepReader, followSteps, lastLines, LIMITS, plain, record } from "./steps.mjs";

const ESC = "\x1b";

// Both captured from Runner.Worker 2.337.0 in the guest, with step names and ids replaced: a green
// job, and one that fails on a command the guest lacks. Each is an
// excerpt: every JobRunner and StepsRunner line but the blank "Step result: ", each process exit,
// and each step's telemetry.
const testdata = (name) => readFileSync(new URL(`./testdata/${name}`, import.meta.url), "utf8");
const GREEN_JOB = testdata("worker-success.txt");
const RED_JOB = testdata("worker-failure.txt");

const events = (log) => {
  const reader = createStepReader();
  return log.split("\n").map((line) => reader.read(line)).filter(Boolean);
};
const told = (log) => events(log).map(record);

test("a real job's steps start and finish in order, with the durations GitHub later reported", () => {
  const checkout = "Run actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1";
  const uv = "Run astral-sh/setup-uv@d0cc045d04ccac9d8b7881df0226f9e82c39688e";
  const steps = [
    ["Set up job", 3],
    [checkout, 6],
    [uv, 2],
    ["Validate config", 4],
    ["Test policy", 1],
    ["Install dependencies", 1],
    ["Validate schema", 1],
    ["Run integration tests", 12],
    [`Post ${uv}`, 0],
    [`Post ${checkout}`, 0],
    ["Complete job", 0],
  ];
  assert.deepEqual(
    told(GREEN_JOB),
    steps.flatMap(([name, seconds], i) => [`start\t${i + 1}\t${name}`, `finish\t${i + 1}\tsuccess\t${seconds}\t${name}`]),
  );
});

test("each finished step carries the timeline record its log is named for", () => {
  const ids = events(GREEN_JOB).filter((event) => event.kind === "finish").map((event) => event.id);
  assert.equal(ids.length, 11);
  assert.equal(ids[0], "ac6749f9-b145-5132-a269-4214ded3e138");
  assert.equal(new Set(ids).size, 11);
});

test("a real failed step is told as a failure, and the job's remaining steps after it", () => {
  const checkout = "Run actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1";
  assert.deepEqual(told(RED_JOB), [
    "start\t1\tSet up job",
    "finish\t1\tsuccess\t2\tSet up job",
    `start\t2\t${checkout}`,
    `finish\t2\tsuccess\t6\t${checkout}`,
    "start\t3\tRun tests",
    "finish\t3\tfailure\t0\tRun tests",
    `start\t4\tPost ${checkout}`,
    `finish\t4\tsuccess\t1\tPost ${checkout}`,
    "start\t5\tComplete job",
    "finish\t5\tsuccess\t0\tComplete job",
  ]);
});

// No capture of these yet, so the lines are the ones the runner's source writes (StepsRunner.cs).
test("a skipped step and a cancelled one", () => {
  assert.deepEqual(
    told(
      "[2026-09-30 15:00:04Z INFO StepsRunner] Processing step: DisplayName='Test policy'\n" +
        "[2026-09-30 15:00:04Z INFO StepsRunner] Skipping step due to condition evaluation.\n" +
        "[2026-09-30 15:00:04Z INFO StepsRunner] No need for updating job result with current step result 'Skipped'.\n" +
        "[2026-09-30 15:00:04Z INFO StepsRunner] Processing step: DisplayName='Build'\n" +
        "[2026-09-30 15:00:04Z INFO StepsRunner] Starting the step.\n" +
        "[2026-09-30 15:00:45Z INFO StepsRunner] Step result: Canceled\n" +
        "[2026-09-30 15:00:45Z INFO StepsRunner] No need for updating job result with current step result 'Canceled'.\n",
    ),
    [
      "start\t1\tTest policy",
      "finish\t1\tskipped\t0\tTest policy",
      "start\t2\tBuild",
      "finish\t2\tcancelled\t41\tBuild",
    ],
  );
});

test("a job that fails before its first step fails at Set up job", () => {
  assert.deepEqual(
    told(
      "[2026-09-30 15:00:00Z INFO JobRunner] Initialize job. Getting all job steps.\n" +
        "[2026-09-30 15:00:04Z ERR  JobRunner] Job initialize failed.\n",
    ),
    ["start\t1\tSet up job", "finish\t1\tfailure\t4\tSet up job"],
  );
});

test("a result the runner has no word for is unknown, never the guest's own text", () => {
  const [, finish] = events(
    "[2026-09-30 15:00:01Z INFO StepsRunner] Processing step: DisplayName='x'\n" +
      "[2026-09-30 15:00:02Z INFO StepsRunner] No need for updating job result with current step result 'Pwned'.",
  );
  assert.equal(finish.conclusion, "unknown");
});

test("a result with no step before it, and a line with no real time, are ignored", () => {
  assert.deepEqual(events("[2026-09-30 15:00:02Z INFO StepsRunner] Update job result with current step result 'Failed'."), []);
  assert.deepEqual(events("[2026-99-99 15:00:02Z INFO StepsRunner] Processing step: DisplayName='x'"), []);
});

test("a step name cannot carry an escape, a tab or a line break into the steps file", () => {
  assert.deepEqual(told(`[2026-09-30 15:00:01Z INFO StepsRunner] Processing step: DisplayName='a${ESC}]52;c;aGk=\x07\tb${ESC}[31mc'`), [
    "start\t1\ta]52;c;aGk= bc",
  ]);
});

test("plain cuts a long field", () => {
  assert.equal(plain("x".repeat(500), 10).length, 10);
});

test("lines split across chunks are reassembled, and a UTF-8 character with them", () => {
  const split = createLineSplitter();
  const bytes = Buffer.from("one\ntwo é\nthr");
  const cut = bytes.indexOf(0xc3) + 1;
  assert.deepEqual([...split.write(bytes.subarray(0, cut)), ...split.write(bytes.subarray(cut)), ...split.write("ee\n")], ["one", "two é", "three"]);
});

test("a stream with no line break holds a bounded tail", () => {
  const split = createLineSplitter(16);
  for (let i = 0; i < 100; i++) assert.deepEqual(split.write("x".repeat(1000)), []);
  assert.deepEqual(split.write("\n"), ["x".repeat(16)]);
});

// The failed step's block in run 36747725837, rebuilt from the lines the lane printed. The text is
// the runner's; the stamps are made up in the runner's format, as seen in a captured block.
const BLOCK =
  "\uFEFF2026-09-30T16:55:37.9161742Z ##[group]Run swift test --package-path auth/ios/Packages/AuthKit\n" +
  `2026-09-30T16:55:37.9162268Z ${ESC}[36;1mswift test --package-path auth/ios/Packages/AuthKit${ESC}[0m\n` +
  "2026-09-30T16:55:37.9165021Z shell: /usr/bin/bash -e {0}\n" +
  "2026-09-30T16:55:37.9165263Z ##[endgroup]\n" +
  "2026-09-30T16:55:37.9253318Z /home/runner/actions-runner/_work/_temp/e34508ee-0e9d-5f55-b8e7-9e51be9886d9.sh: line 1: swift: command not found\n" +
  "2026-09-30T16:55:37.9265403Z ##[error]Process completed with exit code 127.\n";
const LAST_LINES = [
  "##[group]Run swift test --package-path auth/ios/Packages/AuthKit",
  "swift test --package-path auth/ios/Packages/AuthKit",
  "shell: /usr/bin/bash -e {0}",
  "##[endgroup]",
  "/home/runner/actions-runner/_work/_temp/e34508ee-0e9d-5f55-b8e7-9e51be9886d9.sh: line 1: swift: command not found",
  "##[error]Process completed with exit code 127.",
];

test("the last lines of a step's log come back plain and without timestamps", () => {
  assert.deepEqual(lastLines(BLOCK, 20), LAST_LINES);
  assert.deepEqual(lastLines(BLOCK, 2), LAST_LINES.slice(-2));
  assert.deepEqual(lastLines("2026-09-30T16:55:37.9Z kept\n2026-09-30T16:55:37.9Z \n", 5), ["kept"]);
});

// A VM whose follower streams what the test feeds it and whose one-shot reads return `page`.
function fakeVm(page) {
  const stdout = new EventEmitter();
  const reads = [];
  return {
    stdout,
    reads,
    exec(command, options) {
      if (options?.stdout === "pipe") return Object.assign(new Promise(() => {}), { stdout });
      reads.push(command);
      return Promise.resolve({ stdout: page });
    },
  };
}

test("following a job writes each step as it happens, and a failed step's last lines", async () => {
  const vm = fakeVm(BLOCK);
  const written = [];
  const steps = followSteps(vm, (line) => written.push(line));

  const bytes = Buffer.from(RED_JOB);
  for (let i = 0; i < bytes.length; i += 97) vm.stdout.emit("data", bytes.subarray(i, i + 97));
  await steps.settled();

  assert.deepEqual(written.filter((line) => !line.startsWith("log")), told(RED_JOB));
  assert.deepEqual(written.filter((line) => line.startsWith("log")), LAST_LINES.map((line) => `log\t3\t${line}`));
  assert.equal(vm.reads.length, 1, "only the failed step's log is read");
  assert.match(vm.reads[0], /_63b957fd-337d-5750-81ce-2cb8c6828f9b\./, "and it is read by the step's own record");
});

test("a green job reads no step log", async () => {
  const vm = fakeVm(BLOCK);
  const steps = followSteps(vm, () => {});
  vm.stdout.emit("data", GREEN_JOB);
  await steps.settled();
  assert.deepEqual(vm.reads, []);
});

test("a step log that cannot be read costs the lines, not the run", async () => {
  const vm = fakeVm("");
  vm.exec = (command, options) => (options?.stdout === "pipe" ? Object.assign(new Promise(() => {}), { stdout: vm.stdout }) : Promise.reject(new Error("aborted")));
  const written = [];
  const steps = followSteps(vm, (line) => written.push(line));
  vm.stdout.emit("data", RED_JOB);
  await steps.settled();
  assert.deepEqual(written, told(RED_JOB));
});

test("a record id that is not one cannot reach the guest's shell", async () => {
  const vm = fakeVm(BLOCK);
  const steps = followSteps(vm, () => {});
  vm.stdout.emit("data", RED_JOB.replace('"stepId": "63b957fd-337d-5750-81ce-2cb8c6828f9b"', `"stepId": "x'; touch /tmp/pwned; '"`));
  await steps.settled();
  assert.deepEqual(vm.reads, []);
});

test("a guest that forges steps without end costs the host a bounded file and a few reads", async () => {
  const vm = fakeVm(BLOCK);
  const written = [];
  const steps = followSteps(vm, (line) => written.push(line));
  const forged = (i) =>
    `[2026-09-30 16:55:37Z INFO StepsRunner] Processing step: DisplayName='forged ${i}'\n` +
    `  "stepId": "63b957fd-337d-5750-81ce-2cb8c6828f9b",\n` +
    "[2026-09-30 16:55:37Z INFO StepsRunner] Update job result with current step result 'Failed'.\n";
  for (let i = 0; i < 10_000; i++) vm.stdout.emit("data", forged(i));
  await steps.settled();

  const told = written.filter((line) => !line.startsWith("log"));
  assert.equal(told.length, LIMITS.events + 1, "every event up to the limit, then one line saying it stopped");
  assert.equal(told.at(-1), `capped\t${LIMITS.events}`);
  assert.equal(vm.reads.length, LIMITS.failures, "a step log is read for the first failures only");
  assert.equal(written.length - told.length, LIMITS.failures * LAST_LINES.length);
});
