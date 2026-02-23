#!/usr/bin/env bun
import { chmodSync, copyFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import {
  ensureMemoryHome,
  failureEnvelope,
  getMemoryHome,
  getProfilePath,
  successEnvelope,
} from "./memory-lib.ts";

function getArg(name: string): string | null {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= process.argv.length) return null;
  return process.argv[idx + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function applyCommonFlags(): void {
  const memoryHome = getArg("memory-home");
  const now = getArg("now");
  if (memoryHome) process.env.AI_MEMORY_HOME = memoryHome;
  if (now) process.env.AI_MEMORY_NOW = now;
}

function installLauncher(force: boolean): { installed: boolean; path: string; reason?: string } {
  const home = homedir();
  const binDir = join(home, ".local", "bin");
  const destination = join(binDir, "claude-persona");
  const source = `${import.meta.dir}/launch-claude.sh`;

  mkdirSync(binDir, { recursive: true });

  if (!existsSync(source)) {
    return { installed: false, path: destination, reason: `launcher source missing: ${source}` };
  }

  if (existsSync(destination) && !force) {
    return { installed: false, path: destination, reason: "already exists (use --force to overwrite)" };
  }

  copyFileSync(source, destination);
  chmodSync(destination, 0o755);
  return { installed: true, path: destination };
}

function main() {
  applyCommonFlags();

  const profile = getArg("profile") || process.env.AI_MEMORY_PROFILE || "default";
  const doInstallLauncher = hasFlag("install-launcher");
  const force = hasFlag("force");
  const asJson = hasFlag("json");

  try {
    ensureMemoryHome(profile);

    const result = doInstallLauncher ? installLauncher(force) : null;
    const details = {
      memory_home: getMemoryHome(),
      profile,
      personality_path: getProfilePath(profile),
      launcher: result
        ? {
            attempted: true,
            installed: result.installed,
            path: result.path,
            reason: result.reason || null,
          }
        : {
            attempted: false,
            installed: false,
            path: null,
            reason: "launcher install skipped",
          },
    };

    if (asJson) {
      console.log(JSON.stringify(successEnvelope("BOOTSTRAP_OK", details), null, 2));
      return;
    }

    console.log("persona-memory bootstrap complete");
    console.log(`memory root: ${details.memory_home}`);
    console.log(`profile: ${details.profile}`);
    console.log(`personality: ${details.personality_path}`);
    if (result) {
      if (result.installed) {
        console.log(`installed launcher: ${result.path}`);
      } else {
        console.log(`launcher not installed: ${result.reason}`);
        console.log(`expected launcher path: ${result.path}`);
      }
    } else {
      console.log("launcher install skipped (add --install-launcher to install ~/.local/bin/claude-persona)");
    }
    console.log("");
    console.log("next steps:");
    console.log("1) edit your personality profile if needed");
    console.log("2) launch with: claude-persona");
    console.log("3) optionally configure SessionStart/SessionEnd hooks (see references/hook-setup.md)");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (asJson) {
      console.log(
        JSON.stringify(
          failureEnvelope("BOOTSTRAP_ERROR", {
            message,
            memory_home: getMemoryHome(),
            profile,
          }),
          null,
          2,
        ),
      );
    } else {
      console.error(`persona-memory bootstrap failed: ${message}`);
    }
    process.exit(1);
  }
}

main();
