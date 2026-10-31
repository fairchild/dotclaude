// The guest environment contract. A gondolin guest has no udev, no systemd and a PID 1 that never
// reaps, so what an Actions job takes for granted on ubuntu-latest is set up here, as root, before
// the job's user takes over. ../references/design.md explains each line.
import { homedir } from "node:os";
import { join } from "node:path";

/** Where run records, the VM slot and a refreshed allowlist live. */
export function statePath() {
  return process.env.GONDOLIN_STATE ?? join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "gondolin-runner");
}

/** Where build-image.sh writes the guest; one build serves every worktree. */
export function assetsPath() {
  return process.env.GONDOLIN_ASSETS ?? join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "gondolin-runner", "assets");
}

/** Root-only setup, joined with `&&` so any failure stops the run before the job starts. */
export const ROOT_SETUP = [
  // The init leaves /tmp root-owned and points HOME/XDG into it.
  "chmod 1777 /tmp /var/tmp",
  "install -d -o runner -g runner /home/runner/.cache /home/runner/.config /home/runner/.local/share",
  // devtmpfs carries no /dev/fd, so bash's `<(...)` fails without these.
  "ln -sfn /proc/self/fd /dev/fd",
  "ln -sfn /proc/self/fd/0 /dev/stdin",
  "ln -sfn /proc/self/fd/1 /dev/stdout",
  "ln -sfn /proc/self/fd/2 /dev/stderr",
  // Chromium wants a shared-memory filesystem the job's user can write.
  "mountpoint -q /dev/shm || mount -t tmpfs -o rw,nosuid,nodev,mode=1777,size=2g tmpfs /dev/shm",
  "chmod 1777 /dev/shm",
  // Yama mode 2 lets only a process holding CAP_SYS_PTRACE attach to another or read its memory.
  // The job's user holds no capabilities, so it cannot dump Runner.Worker's memory. Yama does not
  // govern /proc/<pid>/environ or /proc/<pid>/cmdline, so the runtime token in later steps'
  // environment and the --jitconfig on the listener's command line stay readable; egress.mjs is
  // written on that assumption. A guest kernel without Yama would leave memory open silently, so
  // the job does not start unless the setting took.
  "echo 2 > /proc/sys/kernel/yama/ptrace_scope",
  '[ "$(cat /proc/sys/kernel/yama/ptrace_scope)" = 2 ]',
];

// The init's PATH lacks /usr/local/bin, where node and npm live. gondolin points
// NODE_EXTRA_CA_CERTS at a root-only file; the system bundle carries the same certificate.
const RUNNER_ENV = [
  "PATH=/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin",
  "HOME=/home/runner",
  "XDG_CACHE_HOME=/home/runner/.cache",
  "XDG_CONFIG_HOME=/home/runner/.config",
  "XDG_DATA_HOME=/home/runner/.local/share",
  "NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt",
  "SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt",
  // Wrangler posts usage events to sparrow.cloudflare.com, which is off the allowlist. Opting out
  // keeps refusals in the report meaningful.
  "WRANGLER_SEND_METRICS=false",
].join(" ");

/**
 * Run `command` as the unprivileged job user under tini, a child subreaper: sandboxd never reaps,
 * so without it a killed process stays a zombie and "has it exited?" never clears. The image
 * gives that user no route back to root.
 * @param {string} command
 */
export function asRunner(command) {
  return `tini -s -- runuser -u runner -- env ${RUNNER_ENV} ${command}`;
}
