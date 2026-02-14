#!/usr/bin/env bun
import {
  consolidateMemory,
  ensureMemoryHome,
  failureEnvelope,
  successEnvelope,
} from "./memory-lib.ts";

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

async function main() {
  applyCommonFlags();
  ensureMemoryHome(process.env.AI_MEMORY_PROFILE || "default");

  const stdin = (await Bun.stdin.text()).trim();
  if (stdin) {
    try {
      JSON.parse(stdin);
    } catch {}
  }

  try {
    const result = consolidateMemory();
    console.log(
      JSON.stringify({
        continue: true,
        systemMessage:
          `persona-memory: session-end consolidation processed=${result.processed}, ` +
          `promoted=${result.promoted}, duplicates=${result.duplicates}, skipped=${result.skipped}`,
        ...successEnvelope("SESSION_END_OK", {
          result,
        }),
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`session-end.ts failed: ${message}`);
    console.log(
      JSON.stringify({
        continue: true,
        systemMessage: "persona-memory: session-end failed open",
        ...failureEnvelope("SESSION_END_ERROR", {
          message,
        }),
      }),
    );
    process.exit(0);
  }
}

main();
