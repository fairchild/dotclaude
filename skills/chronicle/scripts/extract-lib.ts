/**
 * Library for extracting chronicle blocks from session transcripts.
 * Testable module - exports functions for unit testing.
 */
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "fs";
import { basename } from "path";
import { execSync } from "child_process";
import { ChronicleBlock } from "./queries.ts";

export type { ChronicleBlock };

const CHRONICLE_DIR = `${process.env.HOME}/.claude/chronicle/blocks`;  // portability: allow

const DEBUG = process.env.CHRONICLE_DEBUG === "1";
function dbg(...args: unknown[]): void {
  if (DEBUG) console.error("[chronicle:debug]", ...args);
}

/** Find an existing block file for a given sessionId. */
function findExistingBlock(sessionId: string): string | null {
  if (!existsSync(CHRONICLE_DIR)) return null;
  const shortId = sessionId.substring(0, 8);
  const files = readdirSync(CHRONICLE_DIR).filter(f => f.endsWith(".json"));

  // Fast path: filename contains the shortId
  const byName = files.find(f => f.includes(`-${shortId}.json`));
  if (byName) return `${CHRONICLE_DIR}/${byName}`;

  // Slow path: content scan (handles legacy filenames)
  for (const file of files) {
    try {
      const content = JSON.parse(readFileSync(`${CHRONICLE_DIR}/${file}`, "utf-8"));
      if (content.sessionId === sessionId) return `${CHRONICLE_DIR}/${file}`;
    } catch {}
  }
  return null;
}

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
  parts.push('- "summary": 1-2 sentence summary of what was accomplished (describe the work, NOT the user\'s prompt)');
  parts.push('- "goal": the high-level objective of this session (what the user was trying to achieve)');
  parts.push('- "accomplished": array of 2-5 specific completions (past tense, be specific about what changed)');
  parts.push('- "challenges": array of 0-3 obstacles encountered or tricky parts (empty array if none)');
  parts.push('- "pending": array of 0-3 unfinished items (if any)');
  parts.push('- "nextSteps": array of 0-3 logical follow-up actions (what should happen next)');
  parts.push('- "threadGroup": (optional) if pending items are sub-tasks of a larger goal, include:');
  parts.push('    - "slug": short kebab-case identifier (max 30 chars, e.g., "build-auth-system")');
  parts.push('    - "items": array of pending item texts that belong to this thread');
  parts.push("\nBe specific and actionable. Use past tense for accomplished, imperative for pending/nextSteps.");
  parts.push("The summary should describe the WORK DONE, not echo the user's prompt text.");
  parts.push("Only include threadGroup if there are 2+ related pending items from a decomposed task.");
  parts.push("If the session was trivial (just questions, no real work), use minimal entries.");
  parts.push("\nOutput ONLY valid JSON, no markdown formatting.");

  return parts.join("\n");
}

export interface ExtractionResult {
  summary: string;
  goal?: string;
  accomplished: string[];
  challenges?: string[];
  pending: string[];
  nextSteps?: string[];
  threadGroup?: {
    slug: string;
    items: string[];
  };
}

/**
 * Call Haiku to analyze the session.
 */
const DEFAULT_HAIKU_MODEL = "claude-haiku-4-5-20251001";

async function callHaiku(prompt: string): Promise<ExtractionResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.CHRONICLE_EXTRACT_MODEL || DEFAULT_HAIKU_MODEL;
  if (!apiKey) {
    dbg("callHaiku: ANTHROPIC_API_KEY absent → returning null (fallback path)");
    return null;
  }
  dbg("callHaiku: key present, model=", model, "prompt-bytes=", prompt.length);

  let res;
  try {
    const client = new Anthropic({ apiKey });
    res = await client.messages.create({
      model,
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }],
    });
  } catch (err) {
    const e = err as { name?: string; message?: string; status?: number };
    dbg("callHaiku: API error:", e.name, e.status, e.message);
    return null;
  }
  dbg("callHaiku: response stop_reason=", res.stop_reason, "usage=", res.usage);

  const text = res.content[0];
  if (text?.type !== "text") {
    dbg("callHaiku: first content block is not text:", text?.type);
    return null;
  }

  try {
    return parseExtractionJson(text.text);
  } catch (err) {
    dbg("callHaiku: JSON.parse failed:", (err as Error).message, "raw-prefix=", text.text.slice(0, 200));
    return null;
  }
}

export function parseExtractionJson(response: string): ExtractionResult {
  const trimmed = response.trim();
  const fenced = trimmed.match(/^```(?:json|JSON)?\s*([\s\S]*?)\s*```$/);
  const jsonStr = fenced ? fenced[1].trim() : trimmed;

  try {
    return JSON.parse(jsonStr);
  } catch (firstError) {
    const objectStart = jsonStr.indexOf("{");
    const objectEnd = jsonStr.lastIndexOf("}");
    if (objectStart !== -1 && objectEnd > objectStart) {
      return JSON.parse(jsonStr.slice(objectStart, objectEnd + 1));
    }
    throw firstError;
  }
}

/**
 * Generate a URL-friendly slug from text.
 * Max 30 chars for thread slugs, alphanumeric + hyphens.
 */
export function slugify(text: string, maxLen = 40): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, maxLen);
}

/**
 * Generate fallback chronicle entry without API.
 *
 * Exported so the extract-bench classifier can pin its FALLBACK_PATTERNS
 * regexes against the actual summary templates this function produces.
 */
export function fallbackEntry(ctx: SessionContext): ExtractionResult {
  // Build a meaningful summary from context rather than echoing the prompt
  const fileList = ctx.filesModified.slice(0, 3).join(", ");
  const summary = ctx.filesModified.length > 0
    ? `Worked on ${ctx.projectName}: modified ${fileList}${ctx.filesModified.length > 3 ? ` and ${ctx.filesModified.length - 3} more` : ""}`
    : ctx.assistantActions.length > 0
      ? `${ctx.projectName} session with ${ctx.assistantActions.length} actions`
      : `${ctx.projectName} session (${ctx.messageCount} messages)`;

  const goal = ctx.userMessages[0] ? truncate(ctx.userMessages[0], 120) : undefined;

  const accomplished: string[] = [];
  if (ctx.filesModified.length > 0) {
    accomplished.push(`Modified ${ctx.filesModified.slice(0, 5).join(", ")}`);
  }
  for (const action of ctx.assistantActions.slice(0, 3)) {
    if (action.startsWith("created git commit")) {
      accomplished.push("Created git commit");
    }
  }
  if (accomplished.length === 0 && ctx.messageCount > 0) {
    accomplished.push(`Completed ${ctx.messageCount}-message session`);
  }

  return { summary, goal, accomplished, pending: [] };
}

/**
 * Main entry point: extract and write a chronicle block.
 * Upserts by sessionId — if a block for this session already exists, it's overwritten in place.
 */
export async function extractChronicleBlock(
  sessionId: string,
  cwd: string,
  transcriptPath: string
): Promise<ChronicleBlock | null> {
  const ctx = extractSessionContext(transcriptPath, cwd);
  dbg("extractChronicleBlock: ctx", {
    project: ctx.projectName,
    worktree: ctx.worktreeName,
    branch: ctx.gitBranch,
    messageCount: ctx.messageCount,
    userMessages: ctx.userMessages.length,
    filesModified: ctx.filesModified.length,
    actions: ctx.assistantActions.length,
    tools: Array.from(ctx.toolsUsed).sort(),
    transcriptPath,
    transcriptExists: existsSync(transcriptPath),
  });

  // Skip very short sessions (likely just startup/exit)
  if (ctx.messageCount < 2 && ctx.filesModified.length === 0) {
    dbg("extractChronicleBlock: gated out (messageCount<2 && no files) → null");
    return null;
  }

  // Extract via Haiku or use fallback
  const prompt = buildExtractionPrompt(ctx);
  const haikuResult = await callHaiku(prompt);
  dbg("extractChronicleBlock: source=", haikuResult ? "haiku" : "fallback");
  const extracted = haikuResult || fallbackEntry(ctx);

  // Build pendingThreads map from threadGroup if present
  let pendingThreads: Record<string, string> | undefined;
  if (extracted.threadGroup && extracted.threadGroup.items.length > 0) {
    const threadSlug = slugify(extracted.threadGroup.slug, 30);
    pendingThreads = {};
    for (const item of extracted.threadGroup.items) {
      if (extracted.pending.includes(item)) {
        pendingThreads[item] = threadSlug;
      }
    }
    if (Object.keys(pendingThreads).length === 0) {
      pendingThreads = undefined;
    }
  }

  // Build the chronicle block with enriched fields
  const block: ChronicleBlock = {
    timestamp: new Date().toISOString(),
    sessionId,
    project: ctx.projectName,
    ...(ctx.worktreeName && { worktree: ctx.worktreeName }),
    branch: ctx.gitBranch,
    summary: extracted.summary,
    ...(extracted.goal && { goal: extracted.goal }),
    accomplished: extracted.accomplished,
    ...(extracted.challenges?.length && { challenges: extracted.challenges }),
    pending: extracted.pending,
    ...(extracted.nextSteps?.length && { nextSteps: extracted.nextSteps }),
    filesModified: ctx.filesModified.slice(0, 10),
    messageCount: ctx.messageCount,
    ...(pendingThreads && { pendingThreads }),
  };

  // Write to file — upsert by sessionId
  mkdirSync(CHRONICLE_DIR, { recursive: true });

  // Check for existing block with this sessionId
  const existingPath = findExistingBlock(sessionId);

  let finalPath: string;
  if (existingPath) {
    // Overwrite existing block in place (same filename)
    finalPath = existingPath;
  } else {
    // Deterministic filename: date-project-shortSessionId.json
    const date = new Date().toISOString().split("T")[0];
    const projectSlug = slugify(ctx.projectName, 20);
    const shortId = sessionId.substring(0, 8);
    finalPath = `${CHRONICLE_DIR}/${date}-${projectSlug}-${shortId}.json`;
  }

  writeFileSync(finalPath, JSON.stringify(block, null, 2));

  return block;
}
