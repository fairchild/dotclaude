/**
 * Testable module for session title generation.
 * Exports functions for unit testing.
 */
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from "fs";
import { basename } from "path";
import { execSync } from "child_process";
import { createFeedbackEntry, PROMPT_VERSION, MODEL_USED } from "../title-feedback/schema.ts";
import { savePendingFeedback } from "../title-feedback/store.ts";

// Legacy interface for backwards compatibility
export interface Messages { first: string | null; last: string | null }

// Rich context for title generation
export interface SessionContext {
  firstMessage: string | null;
  lastMessage: string | null;
  gitBranch: string | null;
  projectName: string;
  modifiedFiles: string[];
  explicitSummary: string | null;
  messageCount: number;
  // Enhanced fields for better context extraction
  primaryRequest: string | null;  // Longest substantive user message
  latestActivity: string | null;  // Most recent non-confirmation message
}

// Patterns that indicate trivial confirmations (not substantive requests)
const CONFIRMATION_PATTERNS = /^(yes|no|ok|okay|sure|thanks|thank you|got it|sounds good|please|do it|go ahead|yep|yeah|nope|perfect|great|good|fine|correct|right|exactly|absolutely|definitely|indeed|proceed|continue|lgtm|ship it|approved|ack|k|y|n)\b/i;

// System instruction wrapper pattern
const SYSTEM_INSTRUCTION_PATTERN = /<system_instruction>[\s\S]*?<\/system_instruction>/g;

/**
 * Extract and clean user text from message content.
 * Strips system tags, skips trivial confirmations.
 * Returns null if message is not substantive.
 */
export function extractUserText(content: string | { type: string; text?: string }[]): string | null {
  let text = typeof content === "string"
    ? content
    : content?.find((c: { type: string; text?: string }) => c.type === "text")?.text;

  if (!text) return null;

  // Strip system instruction wrappers
  text = text.replace(SYSTEM_INSTRUCTION_PATTERN, "").trim();

  // Skip messages starting with < (remaining system/command tags)
  if (text.startsWith("<")) return null;

  // Skip Caveat: prefixes (system injected context)
  if (text.startsWith("Caveat:")) return null;

  // Skip trivial messages
  if (text.length < 15) return null;

  // Skip confirmation patterns
  if (CONFIRMATION_PATTERNS.test(text)) return null;

  return text;
}

/**
 * Get the first sentence from text, handling edge cases like ~/.
 */
function getFirstSentence(text: string): string {
  // Split on sentence boundaries, but not on things like ~/. or 2.5
  const sentence = text.split(/(?<=[.!?])\s+|\n/)[0].replace(/\s+/g, " ").trim();
  return sentence.substring(0, 100);
}

// Metadata stored alongside title
export interface TitleMetadata {
  title: string;
  shiftCount: number;
  lastMessageHash: string;
  lastMessage: string | null;
}

/**
 * Extract rich context from a session transcript.
 * Parses user messages, git branch, summary entries, and modified files.
 * Finds the most substantive request (longest qualifying message).
 */
export function extractSessionContext(path: string | undefined, projectName: string): SessionContext {
  const ctx: SessionContext = {
    firstMessage: null,
    lastMessage: null,
    gitBranch: null,
    projectName,
    modifiedFiles: [],
    explicitSummary: null,
    messageCount: 0,
    primaryRequest: null,
    latestActivity: null,
  };

  if (!path || !existsSync(path)) return ctx;

  const seenFiles = new Set<string>();
  let longestSubstantive = "";  // Track the longest substantive message
  let messageIndex = 0;

  for (const line of readFileSync(path, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);

      // Extract explicit summary (usually first entry if present)
      if (entry.type === "summary" && entry.summary && !ctx.explicitSummary) {
        ctx.explicitSummary = entry.summary.substring(0, 100);
        continue;
      }

      // Extract user messages
      if (entry.type === "user" && entry.message?.role === "user") {
        // Extract git branch from metadata
        if (entry.gitBranch && !ctx.gitBranch) {
          ctx.gitBranch = entry.gitBranch;
        }

        // Use the new extractUserText for smarter filtering
        const cleanText = extractUserText(entry.message.content);

        if (cleanText) {
          const sentence = getFirstSentence(cleanText);
          ctx.messageCount++;
          messageIndex++;

          // Legacy: first/last message (for backward compat)
          if (!ctx.firstMessage) ctx.firstMessage = sentence;
          ctx.lastMessage = sentence;

          // Enhanced: track longest substantive message (from first 10 turns)
          if (messageIndex <= 10 && cleanText.length > longestSubstantive.length) {
            longestSubstantive = cleanText;
            ctx.primaryRequest = getFirstSentence(cleanText);
          }

          // Enhanced: latest activity is always the most recent valid message
          ctx.latestActivity = sentence;
        }
        continue;
      }

      // Extract modified files from assistant tool calls
      if (entry.type === "assistant" && Array.isArray(entry.message?.content)) {
        for (const block of entry.message.content) {
          if (block.type === "tool_use" && (block.name === "Edit" || block.name === "Write")) {
            const filePath = block.input?.file_path;
            if (filePath && !seenFiles.has(filePath)) {
              seenFiles.add(filePath);
              // Extract just the filename for brevity
              ctx.modifiedFiles.push(basename(filePath));
            }
          }
        }
      }
    } catch {}
  }

  // If no primaryRequest was found, fall back to firstMessage
  if (!ctx.primaryRequest && ctx.firstMessage) {
    ctx.primaryRequest = ctx.firstMessage;
  }

  return ctx;
}

/**
 * Legacy function for backwards compatibility with existing tests.
 */
export function getBookendMessages(path?: string): Messages {
  const ctx = extractSessionContext(path, "unknown");
  return { first: ctx.firstMessage, last: ctx.lastMessage };
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

/**
 * Simple hash for detecting if message has changed.
 */
function hashMessage(msg: string | null): string {
  if (!msg) return "";
  let hash = 0;
  for (let i = 0; i < msg.length; i++) {
    hash = ((hash << 5) - hash) + msg.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(36);
}

/**
 * Humanize a git branch name.
 * "feat/add-auth-flow" → "add auth flow"
 */
function humanizeBranch(branch: string): string {
  return branch
    .replace(/^(feat|fix|chore|docs|refactor|test|style)\//i, "")
    .replace(/[-_]/g, " ")
    .trim();
}

async function callHaiku(
  apiKey: string,
  prompt: string,
  options: { sanitize?: boolean; systemPrompt?: string } = {}
): Promise<string | null> {
  const { sanitize = true, systemPrompt } = options;
  try {
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 30,
      ...(systemPrompt && { system: systemPrompt }),
      messages: [{ role: "user", content: prompt }],
    });
    const text = res.content[0];
    if (text.type !== "text") return null;
    return sanitize ? sanitizeTitle(text.text) : text.text.trim();
  } catch {
    return null;
  }
}

/**
 * Sanitize a raw title response from the model.
 * Strips verbose preambles, quotes, and validates length.
 * Returns null if the title is malformed.
 */
export function sanitizeTitle(raw: string): string | null {
  const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) return null;

  // Find the actual title - it might be on the first line or a subsequent line
  // if the first line is just preamble ending with ":"
  let title = lines[0];

  // If first line ends with ":" and there's a second line, use the second line
  if (title.endsWith(':') && lines.length > 1) {
    title = lines[1];
  }

  // Remove common verbose preambles (patterns that precede the actual title)
  const preambles = [
    /^Based on[^,:\n]*[,:]\s*/i,        // "Based on the context," or "Based on X:"
    /^Here's[^:]*:\s*/i,                 // "Here's a title:" or "Here's the title:"
    /^Here is[^:]*:\s*/i,                // "Here is a title:"
    /^The title\s*(is|:)\s*/i,           // "The title is" or "The title:"
    /^Title:\s*/i,                       // "Title:"
    /^A title[^:]*:\s*/i,                // "A title for this:"
    /^Session title:\s*/i,               // "Session title:"
  ];
  for (const pattern of preambles) {
    title = title.replace(pattern, '').trim();
  }

  // Remove surrounding quotes
  title = title.replace(/^["'](.+)["']$/, '$1').trim();

  // Validate length (max 10 words, max 60 chars)
  const words = title.split(/\s+/);
  if (words.length > 10 || title.length > 60) {
    return null;  // Reject and use fallback
  }

  // Must have at least 2 words
  if (words.length < 2 || title.length < 5) {
    return null;
  }

  return title || null;
}

/**
 * Build the initial title prompt with rich context.
 * Uses primaryRequest (longest substantive message) as the main signal.
 */
function buildInitialPrompt(ctx: SessionContext): string {
  const parts: string[] = [];

  parts.push(`Project: ${ctx.projectName}`);
  if (ctx.gitBranch && ctx.gitBranch !== "main" && ctx.gitBranch !== "master") {
    parts.push(`Branch: ${ctx.gitBranch}`);
  }
  if (ctx.explicitSummary) {
    parts.push(`Session summary: ${ctx.explicitSummary}`);
  }
  // Use primaryRequest (longest substantive) over firstMessage
  const request = ctx.primaryRequest || ctx.firstMessage;
  if (request) {
    parts.push(`User's request: "${request}"`);
  }
  if (ctx.modifiedFiles.length > 0) {
    parts.push(`Files touched: ${ctx.modifiedFiles.slice(0, 5).join(", ")}`);
  }

  parts.push("");
  parts.push("Generate a specific, actionable title (4-7 words) for this coding session.");
  parts.push("- Use active voice: \"Fix X\", \"Add Y\", \"Debug Z\"");
  parts.push("- NO meta-language like \"user wants\" or \"working on\"");
  parts.push("- Focus on the WHAT, not the WHO");
  parts.push("");
  parts.push("Examples of GOOD titles:");
  parts.push("- \"Fix OAuth redirect loop\" (from session debugging auth flow)");
  parts.push("- \"Add rate limiting to API\" (from session improving API security)");
  parts.push("- \"Debug flaky pytest CI\" (from session fixing test failures)");
  parts.push("- \"Refactor user settings page\" (from session about UI changes)");
  parts.push("- \"Implement session title eval\" (from session about building evaluation system)");
  parts.push("");
  parts.push("BAD titles to avoid:");
  parts.push("- \"Session about fixing things\" (uses meta-language)");
  parts.push("- \"Working on code\" (too vague)");
  parts.push("- \"User wants to update auth\" (uses meta-language + vague)");
  parts.push("- \"Help with bug\" (too generic)");

  return parts.join("\n");
}

/**
 * Build the evolution prompt for detecting shifts.
 */
function buildEvolutionPrompt(
  currentTitle: string,
  previousLastMessage: string | null,
  ctx: SessionContext
): string {
  const parts: string[] = [];

  parts.push(`Current title: "${currentTitle}"`);
  if (previousLastMessage) {
    parts.push(`Previous focus: "${previousLastMessage}"`);
  }
  if (ctx.lastMessage) {
    parts.push(`Latest activity: "${ctx.lastMessage}"`);
  }
  parts.push(`Messages in session: ${ctx.messageCount}`);

  parts.push("");
  parts.push("Evaluate if the session focus has SIGNIFICANTLY shifted:");
  parts.push("- Minor continuation of same work → Output exactly: KEEP");
  parts.push("- Major topic change or new problem → Output: NEW: <new title>");
  parts.push("");
  parts.push("Only generate a new title if the work has fundamentally changed direction.");
  parts.push("If outputting NEW, use 4-7 words, active voice, no meta-language.");

  return parts.join("\n");
}

/**
 * Generate the best fallback title without API.
 */
function fallbackTitle(ctx: SessionContext): string {
  // Priority 1: Explicit summary
  if (ctx.explicitSummary) {
    return ctx.explicitSummary.substring(0, 60);
  }

  // Priority 2: Primary request (longest substantive message)
  if (ctx.primaryRequest) {
    return ctx.primaryRequest.substring(0, 60);
  }

  // Priority 3: Descriptive branch name
  if (ctx.gitBranch && ctx.gitBranch !== "main" && ctx.gitBranch !== "master") {
    const humanized = humanizeBranch(ctx.gitBranch);
    if (humanized.length >= 5) {
      return humanized.substring(0, 60);
    }
  }

  // Priority 4: First message (legacy fallback)
  if (ctx.firstMessage) {
    return ctx.firstMessage.substring(0, 60);
  }

  // Priority 5: Project name (never bare timestamp)
  return `${ctx.projectName} session`;
}

/**
 * Load title metadata from file.
 */
function loadMetadata(metaPath: string): TitleMetadata | null {
  if (!existsSync(metaPath)) return null;
  try {
    return JSON.parse(readFileSync(metaPath, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Save title metadata to file.
 */
function saveMetadata(metaPath: string, meta: TitleMetadata): void {
  writeFileSync(metaPath, JSON.stringify(meta, null, 2));
}

/**
 * Format title with shift indicator if applicable.
 * Returns "(N) Title" when shiftCount > 0.
 */
export function formatTitleWithShift(title: string, shiftCount: number): string {
  if (shiftCount <= 0) return title;
  return `(${shiftCount}) ${title}`;
}

/**
 * Evolve a session title based on context and API availability.
 * Returns both the new title and whether a shift occurred.
 */
export async function evolveTitle(
  currentTitle: string | null,
  first: string | null,
  last: string | null,
  apiKey?: string
): Promise<string> {
  // Legacy wrapper - create minimal context
  const ctx: SessionContext = {
    firstMessage: first,
    lastMessage: last,
    gitBranch: null,
    projectName: "unknown",
    modifiedFiles: [],
    explicitSummary: null,
    messageCount: first ? 1 : 0,
  };
  const result = await evolveTitleWithContext(currentTitle, ctx, null, apiKey);
  return result.title;
}

/**
 * Full evolution with rich context and shift tracking.
 */
export async function evolveTitleWithContext(
  currentTitle: string | null,
  ctx: SessionContext,
  previousMeta: TitleMetadata | null,
  apiKey?: string
): Promise<{ title: string; shifted: boolean; meta: TitleMetadata }> {
  const currentHash = hashMessage(ctx.lastMessage);

  // No messages yet - use fallback
  if (!ctx.firstMessage && !ctx.lastMessage) {
    const title = fallbackTitle(ctx);
    return {
      title,
      shifted: false,
      meta: { title, shiftCount: 0, lastMessageHash: "", lastMessage: null },
    };
  }

  // First run or timestamp-only title - generate initial title
  if (!currentTitle || currentTitle.startsWith("Session ") || currentTitle.endsWith(" session")) {
    let title: string;

    if (apiKey) {
      const prompt = buildInitialPrompt(ctx);
      const polished = await callHaiku(apiKey, prompt, {
        systemPrompt: "Output ONLY the session title. No explanations, no preambles, no quotes. Just the 4-7 word title.",
      });
      title = polished || fallbackTitle(ctx);
    } else {
      title = fallbackTitle(ctx);
    }

    return {
      title,
      shifted: false,
      meta: { title, shiftCount: 0, lastMessageHash: currentHash, lastMessage: ctx.lastMessage },
    };
  }

  // Check if context has actually changed
  if (previousMeta && previousMeta.lastMessageHash === currentHash) {
    // No change - return current title
    return {
      title: currentTitle,
      shifted: false,
      meta: previousMeta,
    };
  }

  // Evolution: check for significant shift
  // Don't sanitize evolution responses - they use "KEEP" / "NEW: <title>" protocol
  if (apiKey && ctx.lastMessage) {
    const prompt = buildEvolutionPrompt(
      currentTitle,
      previousMeta?.lastMessage || null,
      ctx
    );
    const response = await callHaiku(apiKey, prompt, { sanitize: false });

    if (response) {
      if (response.toUpperCase() === "KEEP") {
        // No shift - update hash but keep title
        return {
          title: currentTitle,
          shifted: false,
          meta: {
            title: currentTitle,
            shiftCount: previousMeta?.shiftCount || 0,
            lastMessageHash: currentHash,
            lastMessage: ctx.lastMessage,
          },
        };
      }

      if (response.toUpperCase().startsWith("NEW:")) {
        // Shift detected - sanitize just the title portion
        const rawTitle = response.substring(4).trim();
        const newTitle = sanitizeTitle(rawTitle) || rawTitle.substring(0, 60);
        const newShiftCount = (previousMeta?.shiftCount || 0) + 1;
        return {
          title: newTitle,
          shifted: true,
          meta: {
            title: newTitle,
            shiftCount: newShiftCount,
            lastMessageHash: currentHash,
            lastMessage: ctx.lastMessage,
          },
        };
      }

      // Unexpected response format - treat as new title if it looks valid
      const sanitized = sanitizeTitle(response);
      if (sanitized) {
        const newShiftCount = (previousMeta?.shiftCount || 0) + 1;
        return {
          title: sanitized,
          shifted: true,
          meta: {
            title: sanitized,
            shiftCount: newShiftCount,
            lastMessageHash: currentHash,
            lastMessage: ctx.lastMessage,
          },
        };
      }
    }
  }

  // Fallback: keep current title but update tracking
  return {
    title: currentTitle,
    shifted: false,
    meta: {
      title: currentTitle,
      shiftCount: previousMeta?.shiftCount || 0,
      lastMessageHash: currentHash,
      lastMessage: ctx.lastMessage,
    },
  };
}

/**
 * Write title and metadata to disk.
 * Also saves pending feedback for later scoring via /rate-title.
 */
export async function writeTitle(
  dir: string,
  sessionId: string,
  currentTitle: string | null,
  transcriptPath?: string,
  projectName?: string
): Promise<string> {
  const project = projectName || "unknown";
  const ctx = extractSessionContext(transcriptPath, project);
  const apiKey = process.env.ANTHROPIC_API_KEY;

  const metaPath = `${dir}/${sessionId}.meta`;
  const previousMeta = loadMetadata(metaPath);

  const { title, shifted, meta } = await evolveTitleWithContext(
    currentTitle,
    ctx,
    previousMeta,
    apiKey
  );

  // Format title with shift indicator
  const displayTitle = formatTitleWithShift(title, meta.shiftCount);

  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/${sessionId}.txt`, displayTitle);
  saveMetadata(metaPath, meta);

  // Append to evolution log (only if title changed)
  if (title !== currentTitle || shifted) {
    const logFile = `${dir}/${sessionId}.log`;
    const ts = new Date().toISOString();
    const shiftMarker = shifted ? " [SHIFT]" : "";
    appendFileSync(logFile, `${ts}\t${displayTitle}${shiftMarker}\n`);

    // Save pending feedback for /rate-title (only on new/changed titles)
    try {
      const feedbackEntry = createFeedbackEntry(sessionId, project, ctx, title);
      savePendingFeedback(feedbackEntry);
    } catch {
      // Non-critical - don't fail title generation if feedback save fails
    }
  }

  return displayTitle;
}
