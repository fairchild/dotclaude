#!/usr/bin/env bun
import {
  appendMemoryEvent,
  type Confidence,
  ensureMemoryHome,
  failureEnvelope,
  type MemoryType,
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

function isPipedStdin(): boolean {
  try {
    return !process.stdin.isTTY;
  } catch {
    return false;
  }
}

async function readStdinJson(): Promise<Record<string, unknown> | null> {
  if (!isPipedStdin()) return null;
  const raw = (await Bun.stdin.text()).trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function asMemoryType(value: string | null): MemoryType {
  const valid: MemoryType[] = ["fact", "preference", "decision", "thread", "relationship"];
  if (value && valid.includes(value as MemoryType)) return value as MemoryType;
  return "thread";
}

function asConfidence(value: string | null): Confidence {
  const valid: Confidence[] = ["confirmed", "observed", "inferred"];
  if (value && valid.includes(value as Confidence)) return value as Confidence;
  return "observed";
}

async function main() {
  applyCommonFlags();
  ensureMemoryHome(process.env.AI_MEMORY_PROFILE || "default");
  const stdin = await readStdinJson();

  const type = asMemoryType((getArg("type") || (stdin?.type as string) || null) as string | null);
  const content = (getArg("content") || (stdin?.content as string) || "").trim();
  const confidence = asConfidence(
    (getArg("confidence") || (stdin?.confidence as string) || null) as string | null,
  );
  const source = (getArg("source") || (stdin?.source as string) || "manual").trim();
  const projectKey = (getArg("project-key") || (stdin?.project_key as string) || "").trim() || null;

  if (!content) {
    console.log(
      JSON.stringify(
        failureEnvelope("REMEMBER_MISSING_CONTENT", {
          message: "remember.ts requires --content or stdin JSON content",
        }),
        null,
        2,
      ),
    );
    process.exit(1);
  }

  const event = appendMemoryEvent({
    type,
    content,
    confidence,
    source,
    projectKey,
  });

  console.log(
    JSON.stringify(
      successEnvelope("REMEMBER_SAVED", {
        event,
      }),
      null,
      2,
    ),
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.log(
    JSON.stringify(
      failureEnvelope("REMEMBER_ERROR", {
        message,
      }),
      null,
      2,
    ),
  );
  process.exit(1);
});
