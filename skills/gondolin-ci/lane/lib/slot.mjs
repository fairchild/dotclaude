// One VM at a time. A VM takes most of the laptop's cores, and two at once make each other's
// tests fail on timeouts that say nothing about the code under test. Guessing at the others with
// pgrep does not hold up: four things once wanted a VM at the same moment, and one guess started a
// fourth VM beside three.
//
// The slot is a directory, because mkdir either makes it or fails, and an owner file naming the
// process that holds it. A holder that died is detected by its pid, so a crash frees the slot.
//
//   node lib/slot.mjs take <pid> <label>     wait for the slot, then hold it for <pid>
//   node lib/slot.mjs release <pid>          give it back
//   node lib/slot.mjs who                    print the holder, if any
//
// GONDOLIN_PARALLEL=1 skips the slot, for a run that is meant to share the host.
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { statePath } from "./guest.mjs";

/** @typedef {{ pid: number, label: string, since: string }} Holder */

export function slotPath() {
  return join(statePath(), "vm.slot");
}

/** @param {number} pid */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/** @param {string} dir @returns {Holder | null} */
export function holder(dir = slotPath()) {
  try {
    return JSON.parse(readFileSync(join(dir, "owner.json"), "utf8"));
  } catch {
    return null;
  }
}

/** One attempt. @returns {boolean} whether `pid` now holds the slot */
function tryTake(dir, pid, label) {
  try {
    mkdirSync(dir);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const current = holder(dir);
    if (current?.pid === pid) return true;
    // A holder that is gone, or a directory with no owner written yet that stays that way, is
    // stale. Removing it and trying again can race another waiter doing the same, which is why
    // the caller re-reads the owner after winning.
    if (current ? !alive(current.pid) : false) rmSync(dir, { recursive: true, force: true });
    return false;
  }
  writeFileSync(join(dir, "owner.json"), JSON.stringify({ pid, label, since: new Date().toISOString() }));
  return true;
}

/**
 * Wait for the slot and hold it for `pid`.
 * @param {{ pid?: number, label?: string, dir?: string, pollMs?: number, onWait?: (holder: Holder | null, waitedMs: number) => void }} [options]
 * @returns {Promise<() => void>} release
 */
export async function takeSlot({ pid = process.pid, label = "", dir = slotPath(), pollMs = 5000, onWait } = {}) {
  const release = () => releaseSlot({ pid, dir });
  if (process.env.GONDOLIN_PARALLEL === "1") return () => {};
  mkdirSync(join(dir, ".."), { recursive: true });
  const started = Date.now();
  let ownerless = 0;
  for (;;) {
    if (tryTake(dir, pid, label)) {
      // Two waiters can both clear a stale slot; the second removes the first's fresh one. Look
      // again after a beat, and only a holder that still sees its own name keeps the slot.
      await sleep(Math.min(pollMs, 200));
      if (holder(dir)?.pid === pid) return release;
      continue;
    }
    const current = holder(dir);
    // A directory whose owner never appears was left by a taker that died between the two steps.
    ownerless = current ? 0 : ownerless + 1;
    if (ownerless > 3) rmSync(dir, { recursive: true, force: true });
    onWait?.(current, Date.now() - started);
    await sleep(pollMs);
  }
}

/** Give the slot back, if `pid` holds it. @param {{ pid?: number, dir?: string }} [options] */
export function releaseSlot({ pid = process.pid, dir = slotPath() } = {}) {
  if (holder(dir)?.pid === pid) rmSync(dir, { recursive: true, force: true });
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const [verb, pidText, ...words] = process.argv.slice(2);
  const pid = Number(pidText);
  if (verb === "who") {
    const current = holder();
    console.log(current && alive(current.pid) ? `${current.pid}  ${current.label}  since ${current.since}` : "free");
  } else if (verb === "take" && pid > 0) {
    let told = 0;
    await takeSlot({
      pid,
      label: words.join(" "),
      onWait: (current, waitedMs) => {
        if (waitedMs - told < 60_000 && told !== 0) return;
        told = waitedMs || 1;
        console.error(`  waiting for the VM slot: ${current ? `${current.label || "another run"} (pid ${current.pid}) has it` : "being taken"}`);
      },
    });
  } else if (verb === "release" && pid > 0) {
    releaseSlot({ pid });
  } else {
    console.error("usage: node lib/slot.mjs take <pid> <label> | release <pid> | who");
    process.exit(2);
  }
}
