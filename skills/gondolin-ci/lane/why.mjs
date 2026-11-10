// From a pid to its run: which pull request and suite, what started it and why, the step it is on,
// and when it should end.
//   node why.mjs [pid]     no pid: every run in progress
// The estimate is the median of each remaining step across this suite's earlier successful runs.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { alive, ancestry, ledgerPath, PID_FIELDS, readRecord, runsPath } from "./lib/record.mjs";
import { sanitize } from "./lib/terminal.mjs";

/** @typedef {import("./lib/record.mjs").Run} Run */
/** @typedef {{ done: Map<string, number>, started: string[], current?: string, lastWrite: number }} Steps */

/** The record a pid belongs to: its environment names it, or a pid above it is one a record holds. */
export function findRecord(pid, dir = runsPath()) {
  const env = execOr(["ps", "-E", "-o", "command=", "-p", String(pid)]);
  const named = env.match(/GONDOLIN_RUN_RECORD=(\S+\.json)/)?.[1];
  if (named?.startsWith(`${dir}/`)) return named;
  const chain = new Set(ancestry(pid).map((link) => link.pid));
  return liveRecords(dir).find((file) => PID_FIELDS.some((field) => chain.has(Number(readRecord(file)[field]))));
}

/** Records of runs still going, newest first. A finished run's pids may belong to anyone now. */
export function liveRecords(dir = runsPath()) {
  return listing(dir)
    .filter((f) => /^job-.*\.json$/.test(f))
    .map((f) => join(dir, f))
    .filter((file) => {
      const run = readRecord(file);
      return !run.finished && run.optin_pid && alive(run.optin_pid);
    })
    .sort()
    .reverse();
}

/** @param {string} file @returns {Steps} */
export function readSteps(file) {
  const done = new Map();
  const started = [];
  let text = "";
  let lastWrite = 0;
  try {
    text = readFileSync(file, "utf8");
    lastWrite = statSync(file).mtimeMs;
  } catch {}
  for (const line of text.split("\n")) {
    const [kind, , a, b, c] = line.split("\t");
    if (kind === "start") started.push(a);
    if (kind === "finish") done.set(c, (done.get(c) ?? 0) + Number(b));
  }
  return { done, started, current: started.findLast((name) => !done.has(name)), lastWrite };
}

const median = (xs) => {
  const sorted = xs.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : undefined;
};

/**
 * Seconds left, and what that rests on. Earlier runs are this repository's and suite's successes;
 * each is read for its steps' durations and for the time between its last step and its end.
 * @param {Run} run
 * @param {Steps} now
 * @param {{ ledger: Run[], stepsOf: (suffix: string) => Steps, at?: number }} history
 * @returns {{ left: number, runs: number } | null}
 */
export function estimate(run, now, { ledger, stepsOf, at = Date.now() }) {
  const peers = ledger
    .filter((p) => p.repo === run.repo && p.suite === run.suite && p.conclusion === "success" && p.suffix !== run.suffix)
    .slice(-10);
  if (!peers.length) return null;
  const elapsed = (at - Date.parse(run.started ?? "")) / 1000;
  const histories = peers.map((p) => ({ run: p, steps: stepsOf(p.suffix ?? "") })).filter((h) => h.steps.done.size);
  if (!histories.length || !now.started.length) {
    const total = median(peers.map((p) => p.seconds));
    return total === undefined ? null : { left: Math.max(0, total - (elapsed || 0)), runs: peers.length };
  }
  const order = [...histories.at(-1).steps.done.keys()];
  const typical = (name) => median(histories.map((h) => h.steps.done.get(name))) ?? 0;
  const tail = median(histories.map((h) => (Date.parse(h.run.at ?? "") - h.steps.lastWrite) / 1000)) ?? 0;
  const inCurrent = (at - now.lastWrite) / 1000;
  let left = Math.max(0, tail);
  for (const name of order) {
    if (now.done.has(name)) continue;
    left += name === now.current ? Math.max(0, typical(name) - inCurrent) : typical(name);
  }
  return { left, runs: histories.length };
}

/** @param {string} file */
export function describe(file, at = Date.now()) {
  const run = readRecord(file);
  const base = file.replace(/\.json$/, "");
  const now = readSteps(`${base}.steps`);
  const ledger = readLedger();
  const guess = estimate(run, now, { ledger, stepsOf: (s) => readSteps(join(runsPath(), `job-${s}.steps`)), at });
  const chain = run.chain ?? [];
  const invoker = chain.find((link) => !/gondolin-ci\.sh|^script |run-optin\.sh/.test(link.command));
  const session = chain.find((link) => /(^|\/)(claude|codex)\b/.test(link.command));
  const since = run.started ? new Date(run.started) : null;
  const lines = [
    `${bold(`${run.repo}#${run.pr}`)} ${run.title ?? ""}`,
    `  run      ${run.suffix} · suite ${run.suite}${run.sha ? ` @ ${run.sha.slice(0, 12)}` : ""}${run.run_url ? `  ${run.run_url}` : ""}`,
    `  why      ${run.reason ?? dim("no reason given; GONDOLIN_REASON=… on the run sets one")}`,
    `  started  ${since ? clock(since) : "?"} by ${invoker ? `${short(invoker.command)} (pid ${invoker.pid})` : "?"}`,
    ...(session ? [`  under    ${short(session.command)} (pid ${session.pid})${run.cwd ? ` in ${tilde(run.cwd)}` : ""}`] : []),
    `  pids     run-optin ${run.optin_pid} · run-job ${run.job_pid ?? "?"} · qemu ${run.qemu_pid ?? "?"}`,
    `  now      ${now.current ? `step ${now.started.length}, ${now.current}` : now.started.length ? "between steps" : "booting or dispatching"}` +
      ` · ${now.done.size} done${run.mode === "yield" ? dim(" · yielding to the laptop, so slower than usual") : ""}`,
    guess
      ? `  eta      ~${minutes(guess.left)} left, around ${clock(new Date(at + guess.left * 1000))} ${dim(`(median of ${guess.runs} earlier ${run.suite} run${guess.runs === 1 ? "" : "s"})`)}`
      : `  eta      ${dim(`no earlier successful ${run.suite} runs of ${run.repo} to go on`)}`,
    `  records  ${base}.{json,log,steps,egress}`,
  ];
  return sanitize(lines.join("\n"));
}

function readLedger() {
  try {
    return readFileSync(ledgerPath(), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function listing(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function execOr(argv) {
  try {
    return execFileSync(argv[0], argv.slice(1), { encoding: "utf8" });
  } catch {
    return "";
  }
}

const tty = process.stdout.isTTY;
const bold = (s) => (tty ? `\x1b[1m${s}\x1b[0m` : s);
const dim = (s) => (tty ? `\x1b[2m${s}\x1b[0m` : s);
const clock = (d) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const minutes = (s) => (s < 90 ? `${Math.round(s)}s` : `${Math.round(s / 60)}m`);
const short = (command) => command.replace(/(\S*\/)([^/\s]+)/g, "$2").slice(0, 70);
const tilde = (path) => path.replace(homedir(), "~");

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const pid = Number(process.argv[2]);
  if (process.argv[2] && !pid) {
    console.error("usage: node why.mjs [pid]");
    process.exit(2);
  }
  const files = pid ? [findRecord(pid)].filter(Boolean) : liveRecords();
  if (!files.length) {
    if (!pid) console.log("no gondolin run in progress");
    else {
      console.log(`pid ${pid} belongs to no gondolin run with a record. What is above it:`);
      for (const link of ancestry(pid)) console.log(sanitize(`  ${String(link.pid).padStart(6)}  ${link.command.slice(0, 110)}`));
    }
    process.exit(pid ? 1 : 0);
  }
  console.log(files.map((file) => describe(file)).join("\n\n"));
}
