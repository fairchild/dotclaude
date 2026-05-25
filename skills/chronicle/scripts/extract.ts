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

// Load ~/.claude/.env if present
const envPath = `${process.env.HOME}/.claude/.env`;
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const [key, ...rest] = line.split("=");
    if (key?.trim() && !key.startsWith("#") && !process.env[key.trim()]) {
      process.env[key.trim()] = rest.join("=").trim().replace(/^["']|["']$/g, "");
    }
  }
}
dbg("extract.ts: env loaded, ANTHROPIC_API_KEY=", process.env.ANTHROPIC_API_KEY ? "present" : "absent");

async function main() {
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

main().catch((err) => {
  dbg("extract.ts: top-level error:", (err as Error).name, (err as Error).message);
  process.exit(1);
});
