#!/usr/bin/env bun
/**
 * Extract chronicle block from session on SessionEnd.
 * Captures accomplishments, pending threads, and session summary.
 */
import { existsSync, readFileSync } from "fs";
import { extractChronicleBlock } from "./extract-lib.ts";

const DEBUG = process.env.CHRONICLE_DEBUG === "1";
function dbg(...args: unknown[]): void {
  if (DEBUG) console.error("[chronicle:debug]", ...args);
}

export function parseEnvAssignment(line: string): [string, string] | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const assignment = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
  const match = assignment.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!match) return null;

  const [, key, rawValue] = match;
  const value = rawValue.trim().replace(/^["']|["']$/g, "");
  return [key, value];
}

function loadEnvFile(path: string, allowedKeys?: Set<string>): void {
  if (!existsSync(path)) return;

  for (const line of readFileSync(path, "utf-8").split("\n")) {
    const parsed = parseEnvAssignment(line);
    if (!parsed) continue;

    const [key, value] = parsed;
    if (allowedKeys && !allowedKeys.has(key)) continue;
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

export function loadEnvAssignments(home = process.env.HOME): void {
  if (!home) return;

  loadEnvFile(`${home}/.claude/.env`);
  loadEnvFile(`${home}/.env`);
  loadEnvFile(`${home}/.zprofile`, new Set(["ANTHROPIC_API_KEY"]));
}

async function main() {
  loadEnvAssignments();
  dbg("extract.ts: env loaded, ANTHROPIC_API_KEY=", process.env.ANTHROPIC_API_KEY ? "present" : "absent");

  const input = await Bun.stdin.text();
  if (!input.trim()) {
    dbg("extract.ts: empty stdin → exit 0");
    process.exit(0);
  }

  const { session_id, cwd, transcript_path } = JSON.parse(input);
  dbg("extract.ts: input", {
    session_id: !!session_id,
    cwd,
    transcript_path,
    transcript_exists: transcript_path ? existsSync(transcript_path) : false,
  });
  if (!session_id || !cwd || !transcript_path) {
    dbg("extract.ts: missing required field → exit 0");
    process.exit(0);
  }

  await extractChronicleBlock(session_id, cwd, transcript_path);
}

if (import.meta.main) {
  main().catch((err) => {
    dbg("extract.ts: top-level error:", (err as Error).name, (err as Error).message);
    process.exit(1);
  });
}
