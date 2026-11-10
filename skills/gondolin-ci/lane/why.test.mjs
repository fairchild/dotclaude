import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.GONDOLIN_STATE = mkdtempSync(join(tmpdir(), "why-"));
const { closeRecord, openRecord, readRecord, runsPath, updateRecord, ledgerPath } = await import("./lib/record.mjs");
const { describe, estimate, findRecord, liveRecords, readSteps } = await import("./why.mjs");
mkdirSync(runsPath(), { recursive: true });

const sleeper = (env = {}) => spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { env: { ...process.env, ...env } });

/** @param {[string, number][]} finished @param {string} [current] */
function stepsFile(name, finished, current) {
  const file = join(runsPath(), `job-${name}.steps`);
  const lines = finished.flatMap(([step, s], i) => [`start\t${i + 1}\t${step}`, `finish\t${i + 1}\tsuccess\t${s}\t${step}`]);
  if (current) lines.push(`start\t${finished.length + 1}\t${current}`);
  writeFileSync(file, `${lines.join("\n")}\n`);
  return file;
}

test("a record names what started the run, and closing it adds a line to the ledger", () => {
  const file = join(runsPath(), "job-optin-pr-1-000001.json");
  openRecord(file, process.pid, { suffix: "optin-pr-1-000001", repo: "o/r", pr: 1, suite: "lint" }, { GONDOLIN_REASON: "pre-merge", CLAUDE_PID: "42", PWD: "/w" });
  const run = readRecord(file);
  assert.equal(run.optin_pid, process.pid);
  assert.equal(run.reason, "pre-merge");
  assert.equal(run.claude_pid, 42);
  assert.ok(run.chain.length > 0, "the processes above the run were captured");
  closeRecord(file, { conclusion: "success" });
  const last = readFileSync(ledgerPath(), "utf8").trim().split("\n").at(-1);
  assert.deepEqual(
    { ...JSON.parse(last), at: undefined, seconds: undefined },
    { suffix: "optin-pr-1-000001", repo: "o/r", pr: 1, suite: "lint", conclusion: "success", reason: "pre-merge", at: undefined, seconds: undefined },
  );
});

test("a pid finds its run through the environment it inherited", async () => {
  const file = join(runsPath(), "job-optin-pr-2-000002.json");
  updateRecord(file, { suffix: "optin-pr-2-000002", optin_pid: 999999 });
  const child = sleeper({ GONDOLIN_RUN_RECORD: file });
  try {
    await new Promise((resolve) => child.once("spawn", resolve));
    assert.equal(findRecord(child.pid), file);
  } finally {
    child.kill();
  }
});

test("a pid finds a live run through the pids its record holds, and a finished run's pids are ignored", async () => {
  const optin = sleeper();
  const job = sleeper();
  try {
    await Promise.all([optin, job].map((c) => new Promise((resolve) => c.once("spawn", resolve))));
    const file = join(runsPath(), "job-optin-pr-3-000003.json");
    updateRecord(file, { suffix: "optin-pr-3-000003", optin_pid: optin.pid, job_pid: job.pid });
    assert.equal(findRecord(job.pid), file);
    assert.ok(liveRecords().includes(file));
    updateRecord(file, { finished: new Date().toISOString() });
    assert.equal(findRecord(job.pid), undefined);
  } finally {
    optin.kill();
    job.kill();
  }
});

test("the estimate is the median of each step still to come, less the time already in the current one", () => {
  const at = Date.parse("2026-11-09T12:00:00Z");
  const ledger = ["a", "b", "c"].map((s, i) => {
    const steps = stepsFile(`peer-${s}`, [["checkout", 10], ["build", 100 + i * 10], ["test", 200 + i * 100]]);
    const end = at - 3600_000 * (i + 1);
    utimesSync(steps, new Date(end - 5000), new Date(end - 5000));
    return { suffix: `peer-${s}`, repo: "o/r", suite: "full", conclusion: "success", at: new Date(end).toISOString(), seconds: 400 };
  });
  ledger.push({ suffix: "other", repo: "o/r", suite: "lint", conclusion: "success", seconds: 9000 });
  const mine = stepsFile("mine", [["checkout", 12]], "build");
  utimesSync(mine, new Date(at - 30_000), new Date(at - 30_000));
  const guess = estimate(
    { suffix: "mine", repo: "o/r", suite: "full", started: new Date(at - 60_000).toISOString() },
    readSteps(mine),
    { ledger, stepsOf: (s) => readSteps(join(runsPath(), `job-${s}.steps`)), at },
  );
  // build: median 110, 30 s in → 80; test: median 300; after the last step: 5.
  assert.deepEqual(guess, { left: 385, runs: 3 });
});

test("before any step, the estimate is the typical whole run less the time so far", () => {
  const at = Date.parse("2026-11-09T12:00:00Z");
  const guess = estimate(
    { suffix: "new", repo: "o/r", suite: "lint", started: new Date(at - 100_000).toISOString() },
    readSteps("/nonexistent"),
    { ledger: [{ repo: "o/r", suite: "lint", conclusion: "success", seconds: 400 }], stepsOf: () => readSteps("/nonexistent"), at },
  );
  assert.deepEqual(guess, { left: 300, runs: 1 });
});

test("with no earlier runs of the suite there is no estimate, and the description says so", () => {
  const file = join(runsPath(), "job-optin-pr-9-000009.json");
  updateRecord(file, { suffix: "optin-pr-9-000009", repo: "o/new", pr: 9, suite: "e2e", optin_pid: 1, started: new Date().toISOString() });
  assert.match(describe(file), /no earlier successful e2e runs of o\/new/);
});
