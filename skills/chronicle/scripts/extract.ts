#!/usr/bin/env bun
/**
 * Extract chronicle block from session on SessionEnd.
 * Captures accomplishments, pending threads, and session summary.
 */
import { existsSync, readFileSync } from "fs";
import { extractChronicleBlock } from "./extract-lib.ts";

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

async function main() {
  const input = await Bun.stdin.text();
  if (!input.trim()) process.exit(0);

  const { session_id, cwd, transcript_path } = JSON.parse(input);
  if (!session_id || !cwd || !transcript_path) process.exit(0);

  await extractChronicleBlock(session_id, cwd, transcript_path);
}

main().catch(() => process.exit(1));
