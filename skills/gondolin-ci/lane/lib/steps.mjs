// The job's steps, read from the runner's own diagnostic log inside the guest. GitHub's step data
// can run minutes behind the runner; Runner.Worker flushes this log line by line as each
// step starts and ends.
//
// The job's user owns that log, so the code under test can write to it. What comes out of here is
// a narration and never a verdict: run-optin.sh still takes the run's conclusion from GitHub.
// Every field is plain text by the time it leaves, with no escape, tab or line break.
import { StringDecoder } from "node:string_decoder";
import { asRunner } from "./guest.mjs";
import { sanitize } from "./terminal.mjs";

const DIAG = "/home/runner/actions-runner/_diag";

// HostTraceListener writes "[{utc:u} {level} {source}] {message}", one second of resolution.
const TRACE = /^\[(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d)Z (?:INFO|ERR ) (JobRunner|StepsRunner)\] (.*)$/;
const PROCESSING = /^Processing step: DisplayName='(.*?)'?$/;
// StepsRunner writes one of these for every step it dequeues, skipped ones included, after the
// step's log has been closed.
const SETTLED = /^(?:Update|No need for updating) job result with current step result '(\w*)'\.$/;
// As a step completes, the runner traces its telemetry as indented JSON. The stepId in it is the
// step's timeline record, which is also how the step's log file is named.
const STEP_ID = /^  "stepId": "([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})",?$/;

// The runner's TaskResult, in the words GitHub's API uses for a step's conclusion.
const CONCLUSIONS = {
  Succeeded: "success",
  SucceededWithIssues: "success",
  Failed: "failure",
  Canceled: "cancelled",
  Skipped: "skipped",
  Abandoned: "failure",
};

/** @typedef {"success" | "failure" | "cancelled" | "skipped" | "unknown"} Conclusion */
/**
 * `id` is the step's timeline record, when the runner named one.
 * @typedef {{ kind: "start", number: number, name: string }
 *   | { kind: "finish", number: number, name: string, conclusion: Conclusion, seconds: number, id?: string }} StepEvent
 */

/**
 * Guest text as one plain field: sanitised, colour removed, tabs and line breaks flattened.
 * @param {string} text
 * @param {number} limit
 */
export function plain(text, limit = 200) {
  return sanitize(text)
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/[\t\n]+/g, " ")
    .slice(0, limit);
}

/**
 * Reads Worker_*.log a line at a time and says when a step starts or finishes. "Set up job" and
 * "Complete job" are steps to GitHub and not to the runner, so both are read from JobRunner's
 * lines around the real steps. Steps are numbered in the order they run. GitHub's numbers agree
 * until the post steps, where it skips ahead.
 */
export function createStepReader() {
  let number = 0;
  /** @type {{ name: string, since: number, id?: string } | null} */
  let running = null;

  const begin = (name, since) => {
    running = { name: plain(name), since };
    return { kind: "start", number: ++number, name: running.name };
  };
  const settle = (conclusion, at) => {
    if (!running) return null;
    const { name, since, id } = running;
    running = null;
    return { kind: "finish", number, name, conclusion, seconds: Math.max(0, at - since), id };
  };

  return {
    /** @param {string} line @returns {StepEvent | null} */
    read(line) {
      const trace = TRACE.exec(line);
      if (!trace) {
        const id = running && STEP_ID.exec(line);
        if (id) running.id = id[1];
        return null;
      }
      const at = Date.parse(`${trace[1]}T${trace[2]}Z`) / 1000;
      if (!Number.isFinite(at)) return null;
      const message = trace[4];

      if (trace[3] === "StepsRunner") {
        const processing = PROCESSING.exec(message);
        if (processing) return begin(processing[1], at);
        const settled = SETTLED.exec(message);
        return settled ? settle(CONCLUSIONS[settled[1]] ?? "unknown", at) : null;
      }
      if (message === "Initialize job. Getting all job steps.") return begin("Set up job", at);
      if (/^Total job steps: \d+\.$/.test(message)) return settle("success", at);
      if (message === "Job initialize failed.") return settle("failure", at);
      if (message === "Job is cancelled during initialize.") return settle("cancelled", at);
      if (message === "Finalize job.") return begin("Complete job", at);
      if (message.startsWith("Job result after all job steps finish: ")) return settle("success", at);
      return null;
    },
  };
}

/**
 * Splits a stream into lines. An unfinished line is held up to `limit` characters, so a guest
 * that never sends a line break cannot grow the host's memory.
 */
export function createLineSplitter(limit = 8192) {
  const decoder = new StringDecoder("utf8");
  let rest = "";
  return {
    /** @param {Buffer | string} chunk @returns {string[]} */
    write(chunk) {
      const parts = (rest + (typeof chunk === "string" ? chunk : decoder.write(chunk))).split("\n");
      rest = parts.pop().slice(0, limit);
      return parts.map((line) => line.slice(0, limit));
    },
  };
}

// A step's log lines begin with the runner's timestamp, DateTime "O" format.
const STAMP = /^\d{4}-\d\d-\d\dT[\d:.]+Z /;

/**
 * The last `count` lines of a step's log, plain and without timestamps.
 * @param {string} text
 * @param {number} count
 * @returns {string[]}
 */
export function lastLines(text, count) {
  return text
    .split("\n")
    .map((line) => plain(line.replace(/^\uFEFF/, "").replace(STAMP, "")))
    .filter((line) => line.trim() !== "")
    .slice(-count);
}

/**
 * One event as a line of the steps file run-optin.sh reads. The name goes last, so nothing in it
 * can pass for another field.
 * @param {StepEvent} event
 */
export function record(event) {
  return event.kind === "start"
    ? `start\t${event.number}\t${event.name}`
    : `finish\t${event.number}\t${event.conclusion}\t${event.seconds}\t${event.name}`;
}

// The runner makes _diag when it first starts and Worker_<time>.log when the job arrives, and
// starts another Worker log every 8 MB. Each one is followed from its first line as it appears.
const FOLLOW =
  `bash -c 'until cd ${DIAG} 2> /dev/null; do sleep 1; done; while :; do for log in Worker_*.log; do ` +
  `[ -e "$log" ] && case " $seen " in *" $log "*) ;; *) seen="$seen $log"; tail -n +1 -f "$log" & ;; esac; done; sleep 1; done'`;

// A step's output is a block file under _diag/blocks, named for the step's timeline record. The
// runner buffers it, closes it when the step ends, uploads it and deletes it: on 2026-09-30 a
// block outlived its step by 1.3 to 2.1 seconds. (_diag/pages holds the same lines and goes in
// under a second.) So the block is read the moment the step's result arrives. A long log is cut
// into blocks of 2 MB, and the newest holds the last lines.
const lastBlock = (id) => `bash -c 'cd ${DIAG}/blocks && tail -c 32768 "$(ls -t ./*_${id}.* | head -1)"'`;

// The code under test can write the log, so it can forge as many steps, and as many failed steps,
// as it likes, and each would cost the host a line on disk or a read of the guest. A real job has
// a few dozen steps and stops at its first failure, bar its post steps, so the host takes this many
// and then says it stopped.
export const LIMITS = { events: 400, failures: 4 };

/**
 * Follow a job's steps inside `vm` and hand `write` one steps-file line per event: every start
 * and finish, and the last lines of a step that failed. Both reads run as the job's user. The
 * logs are that user's files, so following them gives nothing in the guest more than it had.
 * Past `LIMITS.events` events it writes one `capped` line and nothing more; past
 * `LIMITS.failures` failed steps it reads no more step logs.
 * @param {{ exec: (command: string, options?: object) => any }} vm
 * @param {(line: string) => void} write
 * @returns {{ settled: () => Promise<unknown> }} resolves once every failed step's log is read
 */
export function followSteps(vm, write) {
  const reader = createStepReader();
  const lines = createLineSplitter();
  const reads = [];
  let told = 0;

  // A planted block could be a pipe that never ends, so the read is given ten seconds.
  const keepLastLines = async ({ number, id }) => {
    const block = await vm.exec(asRunner(lastBlock(id)), { signal: AbortSignal.timeout(10_000) });
    for (const line of lastLines(block.stdout, 20)) write(`log\t${number}\t${line}`);
  };

  const tail = vm.exec(asRunner(FOLLOW), { stdout: "pipe", stderr: "ignore" });
  tail.stdout.on("data", (chunk) => {
    if (told > LIMITS.events) return;
    for (const line of lines.write(chunk)) {
      const event = reader.read(line);
      if (!event) continue;
      if (++told > LIMITS.events) {
        write(`capped\t${LIMITS.events}`);
        return;
      }
      write(record(event));
      const failed = event.kind === "finish" && (event.conclusion === "failure" || event.conclusion === "cancelled");
      if (failed && event.id && reads.length < LIMITS.failures) reads.push(keepLastLines(event).catch(() => {}));
    }
  });
  // The follower ends when the VM does.
  tail.catch(() => {});
  return { settled: () => Promise.all(reads) };
}
