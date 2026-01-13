/**
 * Library for extracting chronicle blocks from session transcripts.
 * Testable module - exports functions for unit testing.
 */
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { basename } from "path";
import { execSync } from "child_process";
import { ChronicleBlock } from "./queries.ts";

export type { ChronicleBlock };

const CHRONICLE_DIR = `${process.env.HOME}/.claude/chronicle/blocks`;

export interface SessionContext {
  projectName: string;
  worktreeName: string | null;
  gitBranch: string | null;
  messageCount: number;
  userMessages: string[];
  assistantActions: string[];
  filesModified: string[];
  toolsUsed: Set<string>;
}

/**
 * Extract context from a session transcript.
 */
export function extractSessionContext(transcriptPath: string, cwd: string): SessionContext {
  const { project, worktree } = getProjectInfo(cwd);
  const ctx: SessionContext = {
    projectName: project,
    worktreeName: worktree,
    gitBranch: null,
    messageCount: 0,
    userMessages: [],
    assistantActions: [],
    filesModified: [],
    toolsUsed: new Set(),
  };

  if (!existsSync(transcriptPath)) return ctx;

  const seenFiles = new Set<string>();

  for (const line of readFileSync(transcriptPath, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);

      // Extract git branch
      if (entry.gitBranch && !ctx.gitBranch) {
        ctx.gitBranch = entry.gitBranch;
      }

      // Extract user messages
      if (entry.type === "user" && entry.message?.role === "user") {
        const text = extractText(entry.message.content);
        if (text && text.length > 20 && !text.startsWith("<")) {
          ctx.userMessages.push(truncate(text, 200));
          ctx.messageCount++;
        }
      }

      // Extract assistant tool usage and actions
      if (entry.type === "assistant" && Array.isArray(entry.message?.content)) {
        for (const block of entry.message.content) {
          if (block.type === "tool_use") {
            ctx.toolsUsed.add(block.name);

            // Track file modifications
            if (block.name === "Edit" || block.name === "Write") {
              const filePath = block.input?.file_path;
              if (filePath && !seenFiles.has(filePath)) {
                seenFiles.add(filePath);
                ctx.filesModified.push(basename(filePath));
              }
            }

            // Track bash commands as actions
            if (block.name === "Bash" && block.input?.command) {
              const cmd = block.input.command.split("\n")[0].substring(0, 80);
              ctx.assistantActions.push(`ran: ${cmd}`);
            }

            // Track commits
            if (block.name === "Bash" && block.input?.command?.includes("git commit")) {
              ctx.assistantActions.push("created git commit");
            }
          }

          // Track text responses for context
          if (block.type === "text" && block.text) {
            // Look for accomplishment signals
            if (block.text.includes("✓") || block.text.includes("done") || block.text.includes("completed")) {
              const snippet = truncate(block.text, 100);
              if (snippet.length > 20) {
                ctx.assistantActions.push(snippet);
              }
            }
          }
        }
      }
    } catch {}
  }

  return ctx;
}

function extractText(content: string | { type: string; text?: string }[]): string | null {
  if (typeof content === "string") return content;
  const textBlock = content?.find((c) => c.type === "text");
  return textBlock?.text || null;
}

function truncate(text: string, max: number): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return cleaned.substring(0, max - 3) + "...";
}

// Worktree space configuration
// Each space defines a location where worktrees are organized as {basePath}/{repo}/{worktree}
interface WorktreeSpace {
  name: string;
  basePath: string;
  // Optional project name overrides (e.g., ".claude" -> "dotclaude")
  projectAliases?: Record<string, string>;
}

const WORKTREE_SPACES: WorktreeSpace[] = [
  {
    name: "conductor",
    basePath: `${process.env.HOME}/conductor/workspaces`,
    projectAliases: { ".claude": "dotclaude" },
  },
  {
    name: "worktrees",
    basePath: `${process.env.HOME}/.worktrees`,
  },
];

interface ProjectInfo {
  project: string;
  worktree: string | null;
}

function getProjectInfo(cwd: string): ProjectInfo {
  const parsed = parseFromWorktreeSpace(cwd);
  const worktree = parsed?.worktree ?? null;

  try {
    const url = execSync(`git -C "${cwd}" config --get remote.origin.url`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const project = url.replace(/\.git$/, "").split("/").pop() || basename(cwd);
    return { project, worktree };
  } catch {
    if (parsed) return parsed;
    return { project: basename(cwd), worktree };
  }
}

function parseFromWorktreeSpace(cwd: string): ProjectInfo | null {
  for (const space of WORKTREE_SPACES) {
    if (!cwd.startsWith(space.basePath)) continue;

    const relativePath = cwd.slice(space.basePath.length + 1);
    const parts = relativePath.split("/").filter(Boolean);

    if (parts.length >= 2) {
      const repo = parts[0];
      const worktree = parts[1];
      const project = space.projectAliases?.[repo] ?? repo;
      return { project, worktree };
    } else if (parts.length === 1) {
      const project = space.projectAliases?.[parts[0]] ?? parts[0];
      return { project, worktree: null };
    }
  }

  return null;
}

/**
 * Build prompt for Haiku to extract chronicle information.
 */
function buildExtractionPrompt(ctx: SessionContext): string {
  const parts: string[] = [];

  parts.push("Analyze this coding session and extract a chronicle entry.\n");

  parts.push(`Project: ${ctx.projectName}`);
  if (ctx.gitBranch) {
    parts.push(`Branch: ${ctx.gitBranch}`);
  }
  parts.push(`Message count: ${ctx.messageCount}`);

  if (ctx.userMessages.length > 0) {
    parts.push("\nUser requests (chronological):");
    // First 3 and last 2 messages for context
    const messages = ctx.userMessages.length <= 5
      ? ctx.userMessages
      : [...ctx.userMessages.slice(0, 3), "...", ...ctx.userMessages.slice(-2)];
    messages.forEach((m, i) => parts.push(`${i + 1}. "${m}"`));
  }

  if (ctx.filesModified.length > 0) {
    parts.push(`\nFiles modified: ${ctx.filesModified.slice(0, 10).join(", ")}`);
  }

  if (ctx.assistantActions.length > 0) {
    parts.push("\nKey actions taken:");
    ctx.assistantActions.slice(0, 8).forEach((a) => parts.push(`- ${a}`));
  }

  parts.push("\n---\n");
  parts.push("Output JSON with these fields:");
  parts.push('- "summary": 1-2 sentence summary of what was accomplished');
  parts.push('- "accomplished": array of 2-5 specific completions (past tense)');
  parts.push('- "pending": array of 0-3 unfinished items or next steps (if any)');
  parts.push("\nBe specific and actionable. Use past tense for accomplished, imperative for pending.");
  parts.push("If the session was trivial (just questions, no real work), use minimal entries.");
  parts.push("\nOutput ONLY valid JSON, no markdown formatting.");

  return parts.join("\n");
}

/**
 * Call Haiku to analyze the session.
 */
async function callHaiku(prompt: string): Promise<{
  summary: string;
  accomplished: string[];
  pending: string[];
} | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  try {
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    });

    const text = res.content[0];
    if (text.type !== "text") return null;

    // Parse JSON from response (handle potential markdown wrapping)
    let jsonStr = text.text.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```json?\n?/, "").replace(/\n?```$/, "");
    }

    return JSON.parse(jsonStr);
  } catch {
    // API call failed - fallback will be used
    return null;
  }
}

/**
 * Generate a URL-friendly slug from text.
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 40);
}

/**
 * Generate fallback chronicle entry without API.
 */
function fallbackEntry(ctx: SessionContext): { summary: string; accomplished: string[]; pending: string[] } {
  const summary = ctx.userMessages[0]
    ? `Session: ${truncate(ctx.userMessages[0], 80)}`
    : `${ctx.projectName} session`;

  const accomplished: string[] = [];
  if (ctx.filesModified.length > 0) {
    accomplished.push(`Modified ${ctx.filesModified.length} file(s): ${ctx.filesModified.slice(0, 3).join(", ")}`);
  }
  if (ctx.toolsUsed.has("Bash")) {
    accomplished.push("Ran shell commands");
  }
  if (ctx.messageCount > 0) {
    accomplished.push(`Processed ${ctx.messageCount} user message(s)`);
  }

  return { summary, accomplished, pending: [] };
}

/**
 * Main entry point: extract and write a chronicle block.
 */
export async function extractChronicleBlock(
  sessionId: string,
  cwd: string,
  transcriptPath: string
): Promise<ChronicleBlock | null> {
  const ctx = extractSessionContext(transcriptPath, cwd);

  // Skip very short sessions (likely just startup/exit)
  if (ctx.messageCount < 2 && ctx.filesModified.length === 0) {
    return null;
  }

  // Extract via Haiku or use fallback
  const prompt = buildExtractionPrompt(ctx);
  const extracted = await callHaiku(prompt) || fallbackEntry(ctx);

  // Build the chronicle block
  const block: ChronicleBlock = {
    timestamp: new Date().toISOString(),
    sessionId,
    project: ctx.projectName,
    ...(ctx.worktreeName && { worktree: ctx.worktreeName }),
    branch: ctx.gitBranch,
    summary: extracted.summary,
    accomplished: extracted.accomplished,
    pending: extracted.pending,
    filesModified: ctx.filesModified.slice(0, 10),
    messageCount: ctx.messageCount,
  };

  // Write to file
  mkdirSync(CHRONICLE_DIR, { recursive: true });

  const date = new Date().toISOString().split("T")[0];
  const slug = slugify(extracted.summary) || sessionId.substring(0, 8);
  const filename = `${date}-${slug}.json`;
  const filepath = `${CHRONICLE_DIR}/${filename}`;

  // Don't overwrite existing blocks (use session ID suffix if needed)
  const finalPath = existsSync(filepath)
    ? `${CHRONICLE_DIR}/${date}-${slug}-${sessionId.substring(0, 6)}.json`
    : filepath;

  writeFileSync(finalPath, JSON.stringify(block, null, 2));

  return block;
}
