// Boot one disposable VM, run exactly one Actions job in it, then throw the VM away.
//   node run-job.mjs --jit <file> --repo <owner/name> [--profile actions|build] [--memory 8G] [--cpus 6]
// The JIT config is written into the guest, removed from the host at once, and removed from the
// guest before the runner starts. It stays on the runner's command line, which is why the commands
// below that report on the guest name processes by comm, never by args: their output reaches the
// host's log.
import { appendFileSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { VM, MemoryProvider } from "@earendil-works/gondolin";
import { createProxy, loadAllowlist } from "./lib/proxy.mjs";
import { createCap, createSanitizer, sanitize } from "./lib/terminal.mjs";
import { asRunner, assetsPath, ROOT_SETUP } from "./lib/guest.mjs";
import { followSteps } from "./lib/steps.mjs";

const { values } = parseArgs({
  options: {
    jit: { type: "string" },
    profile: { type: "string", default: "actions" },
    memory: { type: "string", default: "6G" },
    cpus: { type: "string", default: "4" },
    repo: { type: "string" },
    report: { type: "string" },
    steps: { type: "string" },
  },
});
if (!values.jit || !values.repo) {
  console.error("usage: node run-job.mjs --jit <file with encoded jit config> --repo <owner/name> [--profile actions|build]");
  process.exit(2);
}

const ALLOWED = loadAllowlist(values.profile === "build" ? "build" : "actions");
// GONDOLIN_EGRESS=report logs what the egress policy would refuse without refusing it, to
// diagnose a job the policy breaks. A run with it set is not contained.
const enforceEgress = process.env.GONDOLIN_EGRESS !== "report";
const { network, report } = createProxy({ allowed: ALLOWED, repo: values.repo, enforce: enforceEgress });

// The runner's console says little; a job's own output goes to its step logs, not here.
const GUEST_LOG_LIMIT = 8 * 1024 * 1024;

const started = Date.now();
const debug = process.env.GONDOLIN_DEBUG_HTTP === "1";

// Debug-only: gondolin reports "fetch failed" with no cause. Wrapping the bridge's own
// fetch keeps the cause — and, because a supplied fetch skips gondolin's guarded DNS
// lookup, tells us whether that guard is what fails.
let bridgeFetch = null;
if (debug) {
  const { fetch: undiciFetch } = await import("undici");
  bridgeFetch = async (url, init) => {
    try {
      return await undiciFetch(url, init);
    } catch (err) {
      const cause = err?.cause;
      console.log(`[bridge-fetch-fail] ${String(url).slice(0, 90)} :: cause ${cause?.code}: ${cause?.message}`);
      throw err;
    }
  };
}

if (debug) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    try {
      return await realFetch(input, init);
    } catch (err) {
      const url = typeof input === "string" ? input : (input?.url ?? String(input));
      console.log(`[fetch-error] ${url.slice(0, 120)} :: ${err?.message} :: cause ${err?.cause?.code ?? err?.cause?.message ?? err?.cause}`);
      throw err;
    }
  };
}
// The JIT file is a live single-use credential; it must not outlive a failed boot either.
const removeJit = () => {
  try {
    unlinkSync(values.jit);
  } catch {}
};
const vm = await VM.create({
  sandbox: { imagePath: assetsPath(), ...(debug ? { debug: ["net"] } : {}) },
  rootfs: { mode: "cow" },
  memory: values.memory,
  cpus: Number(values.cpus),
  ...network,
  // Supplying fetch bypasses gondolin's guarded DNS lookup, so it stays behind its own flag.
  ...(bridgeFetch && process.env.GONDOLIN_BRIDGE_FETCH === "1" ? { fetch: bridgeFetch } : {}),
  ...(debug
    ? {
        debugLog: (...args) =>
          console.log(
            "[gondolin]",
            ...args.map((a) => (a instanceof Error ? (a.stack ?? a.message) : typeof a === "object" && a !== null ? JSON.stringify(a) : String(a))),
          ),
      }
    : {}),
  vfs: { mounts: { "/scratch": new MemoryProvider() } },
  sessionLabel: "gondolin-runner-job",
}).catch((error) => {
  removeJit();
  throw error;
});

const mark = (label) => console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s] ${label}`);

// The egress report is this run's evidence, so it is written however the run ends: when the
// runner exits after its one job, or when run-optin.sh or Ctrl-C stops it first. Node's default
// SIGTERM exit would skip the finally below, leaving no report, a live VM and the JIT file.
let cleaning = null;
const cleanup = () =>
  (cleaning ??= (async () => {
    // The job log carries guest output, which could print lines shaped like this report, so
    // with --report the report goes to a file of its own and the log only points at it.
    const lines = report().join("\n");
    if (values.report) {
      writeFileSync(values.report, `${lines}\n`);
      console.log(`\negress report written to ${values.report}`);
    } else {
      console.log(`\n${lines}`);
    }
    await vm.close().catch(() => {});
    removeJit();
  })());
for (const [signal, code] of [["SIGTERM", 143], ["SIGINT", 130]]) {
  process.once(signal, () => cleanup().then(() => process.exit(code)));
}

let exitCode = 1;
try {
  mark(`vm up (profile ${values.profile}, ${ALLOWED.length} allowed hosts, egress policy ${enforceEgress ? "enforced" : "REPORT ONLY"}); handing in the runner config`);
  await vm.fs.writeFile("/run/jit", jitConfig(), { mode: 0o600 });
  removeJit();
  const proc = vm.exec(
    [
      "cd /home/runner/actions-runner",
      "chown -R runner:runner .",
      ...ROOT_SETUP,
      "jit=$(cat /run/jit)",
      "rm -f /run/jit",
      asRunner('./run.sh --jitconfig "$jit"'),
    ].join(" && "),
    { stdout: "pipe", stderr: "pipe", pty: true },
  );
  // Guest bytes never reach the log or a terminal unfiltered; see lib/terminal.mjs. run-optin.sh
  // sends this output to a file on the laptop, so the guest's share of it is capped.
  let sawOutput = false;
  const guestOut = createSanitizer();
  const guestErr = createSanitizer();
  const toLog = createCap((text) => process.stdout.write(text), GUEST_LOG_LIMIT);
  proc.stdout.on("data", (chunk) => {
    sawOutput = true;
    toLog(guestOut.write(chunk));
  });
  proc.stderr.on("data", (chunk) => {
    sawOutput = true;
    toLog(guestErr.write(chunk));
  });
  mark("runner starting");

  // The console only says a job started. With --steps, the steps are read from the runner's own
  // log in the guest. They go to a file of their own for the egress report's reason: the job log
  // carries guest output, which could print lines shaped like them.
  let steps = null;
  if (values.steps) {
    writeFileSync(values.steps, "");
    steps = followSteps(vm, (line) => appendFileSync(values.steps, `${line}\n`));
  }

  // A silent runner is the failure worth diagnosing: report what it is actually doing.
  const watchdog = setTimeout(async () => {
    if (sawOutput) return;
    mark("no runner output after 45s; looking inside");
    const inside = await vm.exec(
      "ps -eo pid,etime,comm | grep -E 'run\\.sh|Runner\\.|dotnet' | head -5; echo '--- diag'; ls -t /home/runner/actions-runner/_diag/*.log 2>/dev/null | head -2; tail -30 $(ls -t /home/runner/actions-runner/_diag/*.log 2>/dev/null | head -1) 2>/dev/null",
    );
    console.log(sanitize(`${inside.stdout}${inside.stderr}`.trim()));
  }, 45_000);
  watchdog.unref?.();

  // GONDOLIN_TRACE=1: look inside while a step is stuck, since a second CLI client on the
  // session socket crashes and the job's own logs stop at the point of the hang.
  let tracer = null;
  if (process.env.GONDOLIN_TRACE === "1") {
    tracer = setInterval(async () => {
      try {
        const r = await vm.exec(
          "date -u +%H:%M:%S; ss -ltnp 2>/dev/null | head -8; " +
            "ps -eo pid,etime,rss,comm --sort=-rss | head -8",
        );
        console.log(`\n[trace]\n${sanitize(`${r.stdout}${r.stderr}`.trim())}`);
      } catch {}
    }, 20_000);
    tracer.unref?.();
  }
  const result = await proc;
  toLog(guestOut.end() + guestErr.end());
  await steps?.settled();
  if (tracer) clearInterval(tracer);
  exitCode = result.exitCode;
  console.log(`\nrunner exited ${exitCode} after ${((Date.now() - started) / 1000).toFixed(0)}s`);
} finally {
  await cleanup();
}
process.exit(exitCode);

function jitConfig() {
  return readFileSync(values.jit, "utf8").trim();
}
