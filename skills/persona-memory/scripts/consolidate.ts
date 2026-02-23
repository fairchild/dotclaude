#!/usr/bin/env bun
import {
  consolidateMemory,
  ensureMemoryHome,
  failureEnvelope,
  successEnvelope,
} from "./memory-lib.ts";

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function getArg(name: string): string | null {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= process.argv.length) return null;
  return process.argv[idx + 1];
}

function applyCommonFlags(): void {
  const memoryHome = getArg("memory-home");
  const now = getArg("now");
  if (memoryHome) process.env.AI_MEMORY_HOME = memoryHome;
  if (now) process.env.AI_MEMORY_NOW = now;
}

function main() {
  applyCommonFlags();
  ensureMemoryHome(process.env.AI_MEMORY_PROFILE || "default");
  const dryRun = hasFlag("dry-run");
  const json = hasFlag("json");

  try {
    const result = consolidateMemory({ dryRun });

    if (json) {
      console.log(
        JSON.stringify(
          successEnvelope("CONSOLIDATE_OK", {
            dry_run: dryRun,
            result,
          }),
          null,
          2,
        ),
      );
      return;
    }

    console.log(`consolidation ${dryRun ? "(dry-run) " : ""}complete`);
    console.log(`processed: ${result.processed}`);
    console.log(`promoted: ${result.promoted}`);
    console.log(`duplicates: ${result.duplicates}`);
    console.log(`skipped: ${result.skipped}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json) {
      console.log(
        JSON.stringify(
          failureEnvelope("CONSOLIDATE_ERROR", {
            message,
            dry_run: dryRun,
          }),
          null,
          2,
        ),
      );
    } else {
      console.error(`consolidate.ts failed: ${message}`);
    }
    process.exit(1);
  }
}

main();
