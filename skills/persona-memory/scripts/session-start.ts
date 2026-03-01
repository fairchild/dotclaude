#!/usr/bin/env bun
import {
  ensureMemoryHome,
  failureEnvelope,
  formatRecallPrompt,
  getRecallResult,
  getRuntimeSessionStartPath,
  successEnvelope,
  writeText,
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

  let hookInput: Record<string, unknown> = {};
  const stdin = (await Bun.stdin.text()).trim();
  if (stdin) {
    try {
      hookInput = JSON.parse(stdin) as Record<string, unknown>;
    } catch {}
  }

  try {
    const cwd = (getArg("cwd") || (hookInput.cwd as string) || process.cwd()).toString();
    const sessionId = (hookInput.session_id as string) || `manual-${Date.now()}`;
    const profile = process.env.AI_MEMORY_PROFILE || "default";
    const maxChars = Number.parseInt(process.env.AI_MEMORY_MAX_CONTEXT || "2200", 10);

    const recall = getRecallResult({ cwd, profile, maxChars });
    const prompt = formatRecallPrompt(recall);
    const snapshotPath = getRuntimeSessionStartPath(sessionId);
    writeText(snapshotPath, `${prompt}\n`);

    const includeContext = process.env.AI_MEMORY_SESSIONSTART_CONTEXT === "1";
    const details = {
      session_id: sessionId,
      cwd,
      profile,
      project_key: recall.projectKey,
      snippet_count: recall.snippets.length,
      snapshot_path: snapshotPath,
    };

    const payload: Record<string, unknown> = {
      continue: true,
      systemMessage: `persona-memory: recalled ${recall.snippets.length} snippets for ${recall.projectKey}`,
      ...successEnvelope("SESSION_START_OK", details),
    };

    if (includeContext) {
      payload.hookSpecificOutput = {
        hookEventName: "SessionStart",
        additionalContext: prompt,
      };
    }

    console.log(JSON.stringify(payload));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`session-start.ts failed: ${message}`);
    console.log(
      JSON.stringify({
        continue: true,
        systemMessage: "persona-memory: session-start failed open",
        ...failureEnvelope("SESSION_START_ERROR", {
          message,
        }),
      }),
    );
    process.exit(0);
  }
}

main();
