// A run's record: which pull request and suite it is, what started it and why, and the pids that
// are its. It sits beside the run's log, steps and egress report as job-<suffix>.json, so any pid
// the lane starts leads back to its run, and a finished run joins the ledger that estimates the
// next one.
//
//   node lib/record.mjs open <file> <pid> key=value...   start a record for the run at <pid>
//   node lib/record.mjs set <file> key=value...          add or replace fields
//   node lib/record.mjs close <file> key=value...        mark it finished and add it to the ledger
//
// run-optin.sh exports GONDOLIN_RUN_RECORD, so every process under it, QEMU included, carries the
// record's path in its environment, where `ps -E` reads it even after its parents are gone.
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { statePath } from "./guest.mjs";

/** @typedef {{ pid: number, command: string }} Link */
/**
 * @typedef {{
 *   suffix?: string, repo?: string, pr?: number, suite?: string, sha?: string, workflow?: string,
 *   title?: string, reason?: string, started?: string, finished?: string, conclusion?: string,
 *   seconds?: number, run_id?: string, mode?: string,
 *   optin_pid?: number, job_pid?: number, qemu_pid?: number, governor_pid?: number,
 *   claude_pid?: number, cwd?: string, chain?: Link[],
 * }} Run
 */

export const runsPath = () => join(statePath(), "runs");
export const ledgerPath = () => join(statePath(), "runs.jsonl");
export const PID_FIELDS = /** @type {const} */ (["optin_pid", "job_pid", "qemu_pid", "governor_pid"]);

/** @param {string} file @returns {Run} */
export function readRecord(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

/**
 * Merge `fields` in. Three processes write a run's record (run-optin.sh, run-job.mjs and the
 * governor), so each merge holds a lock directory, and a rename keeps a reader from seeing half a
 * file. A lock older than a few seconds was left by a writer that died, and is taken over.
 * @param {string} file @param {Run} fields
 */
export function updateRecord(file, fields) {
  const lock = `${file}.lock`;
  for (let tries = 0; ; tries++) {
    try {
      mkdirSync(lock);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (tries > 200) {
        rmSync(lock, { recursive: true, force: true });
        tries = 0;
      }
      Atomics.wait(PAUSE, 0, 0, 10);
    }
  }
  try {
    const next = { ...readRecord(file), ...fields };
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, file);
    return next;
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

const PAUSE = new Int32Array(new SharedArrayBuffer(4));

/** For the processes whose job is the run, not its record: a failed write is noted, never thrown. */
export function tryUpdateRecord(file, fields) {
  try {
    return updateRecord(file, fields);
  } catch (error) {
    console.error(`run record not updated: ${error.message}`);
  }
}

/** The processes above `pid`, nearest first. @param {number} pid @returns {Link[]} */
export function ancestry(pid) {
  const chain = [];
  for (let p = pid; p > 1 && chain.length < 32; ) {
    const line = ps(p, ["ppid", "command"]);
    const match = line?.match(/^\s*(\d+)\s+(.*)$/);
    if (!match) break;
    chain.push({ pid: p, command: match[2].slice(0, 300) });
    p = Number(match[1]);
  }
  return chain;
}

/** @param {number} pid @param {string[]} fields @returns {string | null} */
export function ps(pid, fields) {
  try {
    return execFileSync("ps", [...fields.flatMap((f) => ["-o", `${f}=`]), "-p", String(pid)], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

/** @param {number} pid */
export function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/**
 * Start the record for the run whose script is `pid`. What started it is the chain above that
 * script, captured now, while it still exists.
 * @param {string} file @param {number} pid @param {Run} fields @param {NodeJS.ProcessEnv} [env]
 */
export function openRecord(file, pid, fields, env = process.env) {
  const chain = ancestry(pid).slice(1);
  return updateRecord(file, {
    ...fields,
    reason: env.GONDOLIN_REASON || undefined,
    started: new Date().toISOString(),
    optin_pid: pid,
    claude_pid: Number(env.CLAUDE_PID) || undefined,
    cwd: env.PWD,
    chain,
  });
}

/** Finish the record and add its summary to the ledger. @param {string} file @param {Run} fields */
export function closeRecord(file, fields, ledger = ledgerPath()) {
  const run = readRecord(file);
  const finished = new Date();
  const seconds = run.started ? Math.round((finished.getTime() - Date.parse(run.started)) / 1000) : undefined;
  const done = updateRecord(file, { conclusion: "aborted", ...fields, finished: finished.toISOString(), seconds });
  const { suffix, repo, pr, suite, sha, conclusion, run_id, reason } = done;
  appendFileSync(ledger, `${JSON.stringify({ at: done.finished, suffix, repo, pr, suite, sha, conclusion, seconds, run_id, reason })}\n`);
  return done;
}

/** key=value words as fields; short digit strings become numbers. @param {string[]} words @returns {Run} */
export function fields(words) {
  return Object.fromEntries(
    words.map((word) => {
      const at = word.indexOf("=");
      const [key, value] = [word.slice(0, at), word.slice(at + 1)];
      return [key, /^\d{1,15}$/.test(value) ? Number(value) : value];
    }),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const [verb, file, ...rest] = process.argv.slice(2);
  if (verb === "open" && file && Number(rest[0]) > 0) openRecord(file, Number(rest[0]), fields(rest.slice(1)));
  else if (verb === "set" && file) updateRecord(file, fields(rest));
  else if (verb === "close" && file) closeRecord(file, fields(rest));
  else {
    console.error("usage: node lib/record.mjs open <file> <pid> k=v... | set <file> k=v... | close <file> k=v...");
    process.exit(2);
  }
}
