/**
 * Testable module for session title generation.
 * Exports functions for unit testing.
 */
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from "fs";
import { basename } from "path";
import { execSync } from "child_process";

export interface Messages { first: string | null; last: string | null }

export function getBookendMessages(path?: string): Messages {
  if (!path || !existsSync(path)) return { first: null, last: null };

  let first: string | null = null;
  let last: string | null = null;

  for (const line of readFileSync(path, "utf-8").split("\n")) {
    try {
      const { message } = JSON.parse(line);
      if (message?.role !== "user") continue;

      const text = typeof message.content === "string"
        ? message.content
        : message.content?.find((c: any) => c.type === "text")?.text;

      if (!text || text.startsWith("<") || text.startsWith("Caveat:") || text.length < 10) continue;

      const sentence = text.split(/(?<=[.!?])\s+|\n/)[0].replace(/\s+/g, " ").trim().substring(0, 100);

      if (!first) first = sentence;
      last = sentence;
    } catch {}
  }

  return { first, last };
}

export function getProjectName(cwd: string): string {
  try {
    const url = execSync(`git -C "${cwd}" config --get remote.origin.url`, { encoding: "utf-8" }).trim();
    return url.replace(/\.git$/, "").split("/").pop() || basename(cwd);
  } catch {
    return basename(cwd);
  }
}

export function timestamp(): string {
  return `Session ${new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })}`;
}

async function callHaiku(apiKey: string, prompt: string): Promise<string | null> {
  try {
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 20,
      messages: [{ role: "user", content: prompt }],
    });
    const text = res.content[0];
    return text.type === "text" ? text.text.trim() : null;
  } catch {
    return null;
  }
}

export async function evolveTitle(
  currentTitle: string | null,
  first: string | null,
  last: string | null,
  apiKey?: string
): Promise<string> {
  // No messages yet
  if (!first && !last) return timestamp();

  // First run or timestamp-only title - seed from first message
  if (!currentTitle || currentTitle.startsWith("Session ")) {
    const seed = first || last;
    if (!seed) return timestamp();

    if (apiKey) {
      const polished = await callHaiku(apiKey, `Summarize this coding task in 3-6 words: "${seed}"`);
      if (polished) return polished;
    }
    return seed.substring(0, 60);
  }

  // Evolution: update title based on new activity
  if (apiKey && last) {
    const evolved = await callHaiku(apiKey,
      `Session summary: "${currentTitle}"\nNew activity: "${last}"\n\nUpdate the summary to reflect the session's evolution. Keep it under 8 words.`
    );
    if (evolved) return evolved;
  }

  // Fallback: keep current title
  return currentTitle;
}

export async function writeTitle(
  dir: string,
  sessionId: string,
  currentTitle: string | null,
  transcriptPath?: string
): Promise<string> {
  const { first, last } = getBookendMessages(transcriptPath);
  const apiKey = process.env.ANTHROPIC_API_KEY;

  const newTitle = await evolveTitle(currentTitle, first, last, apiKey);

  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/${sessionId}.txt`, newTitle);

  // Append to evolution log (only if title changed)
  if (newTitle !== currentTitle) {
    const logFile = `${dir}/${sessionId}.log`;
    const ts = new Date().toISOString();
    appendFileSync(logFile, `${ts}\t${newTitle}\n`);
  }

  return newTitle;
}
