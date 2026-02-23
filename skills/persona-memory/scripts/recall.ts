#!/usr/bin/env bun
import {
  ensureMemoryHome,
  failureEnvelope,
  formatRecallPrompt,
  formatRecallText,
  getRecallResult,
  successEnvelope,
} from "./memory-lib.ts";

type OutputFormat = "text" | "prompt" | "json";

function getArg(name: string): string | null {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= process.argv.length) return null;
  return process.argv[idx + 1];
}

function parseFormat(value: string | null): OutputFormat {
  if (value === "prompt" || value === "json" || value === "text") return value;
  return "text";
}

function parseMaxChars(value: string | null): number {
  if (!value) return 2200;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 300) return 2200;
  return parsed;
}

function applyCommonFlags(): void {
  const memoryHome = getArg("memory-home");
  const now = getArg("now");
  if (memoryHome) process.env.AI_MEMORY_HOME = memoryHome;
  if (now) process.env.AI_MEMORY_NOW = now;
}

function main() {
  applyCommonFlags();
  const cwd = getArg("cwd") || process.cwd();
  const query = getArg("query") || "";
  const profile = getArg("profile") || process.env.AI_MEMORY_PROFILE || "default";
  const format = parseFormat(getArg("format"));
  const maxChars = parseMaxChars(getArg("max-chars"));

  try {
    ensureMemoryHome(profile);
    const result = getRecallResult({ cwd, query, maxChars, profile });

    if (format === "json") {
      console.log(
        JSON.stringify(
          successEnvelope("RECALL_OK", {
            result,
          }),
          null,
          2,
        ),
      );
      return;
    }

    if (format === "prompt") {
      console.log(formatRecallPrompt(result));
      return;
    }

    console.log(formatRecallText(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (format === "json") {
      console.log(
        JSON.stringify(
          failureEnvelope("RECALL_ERROR", {
            message,
          }),
          null,
          2,
        ),
      );
    } else {
      console.error(`recall.ts failed: ${message}`);
    }
    process.exit(1);
  }
}

main();
