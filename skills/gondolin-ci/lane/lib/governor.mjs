// The lane borrows its owner's laptop, so it runs at the lowest priority and steps aside for them.
//
//   node lib/governor.mjs <pid> [--summary <file>]
//
// Watches the process tree under <pid> (run-job.mjs and the QEMU it starts) until it exits. While
// someone is using the laptop, or other work wants the CPU, the tree runs in macOS's background
// band (PRIO_DARWIN_BG): on Apple silicon that keeps it to the efficiency cores and throttles its
// disk I/O, so the interactive work stays quick. Once the laptop has been left alone and nothing
// else is busy, the tree is let out of the band and runs at full speed. It goes back the moment
// either changes.
//
// A job slowed this way can fail on a timeout set for hosted speed, so the summary records how
// long the run spent yielding, and a red run that mostly yielded is read with that in mind.
import { execFileSync } from "node:child_process";
import { cpus } from "node:os";
import { realpathSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

/** @typedef {"yield" | "full"} Mode */

const AWAY_AFTER_S = Number(process.env.GONDOLIN_AWAY_AFTER ?? 120);
const SAMPLE_MS = Number(process.env.GONDOLIN_SAMPLE_MS ?? 10_000);

/**
 * Yield at once when the laptop is in use or busy; run full only after `calmNeeded` calm samples
 * in a row, so a pause in typing does not flip the VM back and forth.
 * @param {{ idleS: number, otherCores: number, cores: number, mode: Mode, calm: number, calmNeeded?: number, awayAfterS?: number }} s
 * @returns {{ mode: Mode, calm: number, why: string }}
 */
export function decide({ idleS, otherCores, cores, mode, calm, calmNeeded = 2, awayAfterS = AWAY_AFTER_S }) {
  const busyLimit = Math.max(1, cores * 0.25);
  if (idleS < awayAfterS) return { mode: "yield", calm: 0, why: `in use (input ${Math.round(idleS)} s ago)` };
  if (otherCores > busyLimit) return { mode: "yield", calm: 0, why: `other work using ${otherCores.toFixed(1)} cores` };
  const nextCalm = calm + 1;
  if (mode === "full" || nextCalm >= calmNeeded) return { mode: "full", calm: nextCalm, why: `left alone ${Math.round(idleS)} s, other work ${otherCores.toFixed(1)} cores` };
  return { mode: "yield", calm: nextCalm, why: "settling" };
}

/** Seconds since the last keyboard, mouse or trackpad input. */
export function inputIdleSeconds() {
  const out = execFileSync("ioreg", ["-c", "IOHIDSystem", "-d", "4"], { encoding: "utf8" });
  const match = out.match(/"HIDIdleTime" = (\d+)/);
  return match ? Number(match[1]) / 1e9 : Infinity;
}

/** pid → [parent, %cpu] for every process. */
function processTable() {
  const table = new Map();
  for (const line of execFileSync("ps", ["-A", "-o", "pid=,ppid=,%cpu="], { encoding: "utf8" }).split("\n")) {
    const [pid, ppid, cpu] = line.trim().split(/\s+/).map(Number);
    if (pid) table.set(pid, [ppid, cpu]);
  }
  return table;
}

/** The pid and all of its descendants, given a process table. */
export function treeOf(root, table) {
  const tree = new Set([root]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [pid, [ppid]] of table) {
      if (tree.has(ppid) && !tree.has(pid)) {
        tree.add(pid);
        grew = true;
      }
    }
  }
  return [...tree].filter((pid) => table.has(pid));
}

/** @param {number[]} pids @param {Mode} mode */
function apply(pids, mode) {
  for (const pid of pids) {
    try {
      execFileSync("taskpolicy", [mode === "yield" ? "-b" : "-B", "-p", String(pid)], { stdio: "ignore" });
    } catch {
      // A process that exited between the listing and here is fine to miss.
    }
  }
}

/**
 * @param {number} root
 * @param {{ summary?: string, log?: (line: string) => void, sampleMs?: number, awayAfterS?: number }} [options]
 */
export async function govern(root, { summary, log = (line) => console.error(line), sampleMs = SAMPLE_MS, awayAfterS = AWAY_AFTER_S } = {}) {
  const cores = cpus().length;
  /** @type {Mode} */
  let mode = "yield";
  let calm = 0;
  const seconds = { yield: 0, full: 0 };
  let last = Date.now();
  for (;;) {
    const table = processTable();
    if (!table.has(root)) break;
    const tree = treeOf(root, table);
    const ours = tree.reduce((sum, pid) => sum + (table.get(pid)?.[1] ?? 0), 0);
    const all = [...table.values()].reduce((sum, [, cpu]) => sum + cpu, 0);
    const next = decide({ idleS: inputIdleSeconds(), otherCores: Math.max(0, all - ours) / 100, cores, mode, calm, awayAfterS });
    if (next.mode !== mode) log(`${new Date().toISOString()}  ${next.mode === "yield" ? "yielding" : "running full"}: ${next.why}`);
    // Applied every pass, not only on a change: QEMU starts after the first pass and must join.
    apply(tree, next.mode);
    const now = Date.now();
    seconds[mode] += (now - last) / 1000;
    last = now;
    ({ mode, calm } = next);
    await sleep(sampleMs);
  }
  const line = `yielded ${Math.round(seconds.yield)} s, full ${Math.round(seconds.full)} s`;
  if (summary) writeFileSync(summary, `${line}\n`);
  return seconds;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const [rootText, flag, file] = process.argv.slice(2);
  const root = Number(rootText);
  if (!root) {
    console.error("usage: node lib/governor.mjs <pid> [--summary <file>]");
    process.exit(2);
  }
  await govern(root, { summary: flag === "--summary" ? file : undefined });
}
