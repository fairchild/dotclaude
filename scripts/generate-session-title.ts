#!/usr/bin/env bun
/**
 * Generate evolving session titles via rolling compression.
 * Entry point - delegates to testable module.
 */
import { existsSync, readFileSync } from "fs";
import { getProjectName, writeTitle } from "./generate-session-title-testable.ts";

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
  const { session_id, cwd, transcript_path } = JSON.parse(await Bun.stdin.text());
  if (!session_id || !cwd) process.exit(1);

  const projectName = getProjectName(cwd);
  const dir = `${process.env.HOME}/.claude/session-titles/${projectName}`;
  const titleFile = `${dir}/${session_id}.txt`;

  const currentTitle = existsSync(titleFile) ? readFileSync(titleFile, "utf-8").trim() : null;

  await writeTitle(dir, session_id, currentTitle, transcript_path);
}

main();
