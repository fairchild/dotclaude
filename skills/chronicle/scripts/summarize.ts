#!/usr/bin/env bun
/**
 * Chronicle Summarize - Generate Claude-powered summaries from chronicle blocks.
 *
 * Two output formats:
 * - structured (default) — JSON {narrative, highlights, pending} for the dashboard.
 *   This is the format the launchd cron and dashboard depend on; do not break it.
 * - narrative           — 4-section markdown (Themes / Wins / Open threads / Friction)
 *                          for human consumption, written to ~/.claude/chronicle/recaps/.
 *                          Used by /chronicle recap.
 *
 * Usage:
 *   bun summarize.ts                                                # Daily structured summary (cron path)
 *   bun summarize.ts --weekly                                       # Weekly structured summary (cron path)
 *   bun summarize.ts --repo=name                                    # Single repo, structured, daily window
 *   bun summarize.ts --repo=name --days=14                          # Custom window
 *   bun summarize.ts --repo=name --format=narrative --with-context  # Narrative recap, default 14d
 */
import Anthropic from "@anthropic-ai/sdk";
import { loadAllBlocks, type ChronicleBlock } from "./queries.ts";
import { getGlobalUsage, getRepoUsage, getToolBreakdown } from "./usage-queries.ts";
import { execFileSync } from "child_process";
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  readdirSync,
} from "fs";

// Load ~/.claude/.env if present so ANTHROPIC_API_KEY resolves outside Claude Code.
const envPath = `${process.env.HOME}/.claude/.env`;
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const [key, ...rest] = line.split("=");
    if (key?.trim() && !key.startsWith("#") && !process.env[key.trim()]) {
      process.env[key.trim()] = rest.join("=").trim().replace(/^["']|["']$/g, "");
    }
  }
}

const SUMMARIES_DIR = `${process.env.HOME}/.claude/chronicle/summaries`;
const RECAPS_DIR = `${process.env.HOME}/.claude/chronicle/recaps`;
const PROJECTS_DIR = `${process.env.HOME}/.claude/projects`;

export type SummaryFormat = "structured" | "narrative";

export interface GenerateSummaryOptions {
  level: "repo" | "global";
  windowDays: number;
  repoName?: string;
  /** "structured" → JSON for dashboard. "narrative" → 4-section markdown for humans. */
  format?: SummaryFormat;
  /** Pull git log + curated memory into the prompt (narrative format only). */
  withContext?: boolean;
}

export interface HierarchicalSummary {
  level: "repo" | "global";
  period: "daily" | "weekly" | "custom";
  date: string;
  repo?: string;
  narrative: string;
  highlights: string[];
  pending: string[];
  usage: { sessions: number; tools: number; tokens: number };
  generatedBy: string;
  generatedAt: string;
}

export interface GenerateSummaryResult {
  summary: HierarchicalSummary;
  /** Populated when format === "narrative". */
  markdown?: string;
}

// ---------------------------------------------------------------------------
// Context gathering for narrative format
// ---------------------------------------------------------------------------

const PROJECT_PATH_ALIASES: Record<string, string> = {
  dotclaude: `${process.env.HOME}/.claude`,
};

function findProjectPath(project: string): string | null {
  const home = process.env.HOME;
  const aliased = PROJECT_PATH_ALIASES[project];
  if (aliased && existsSync(`${aliased}/.git`)) return aliased;
  const conventional = `${home}/code/${project}`;
  if (existsSync(`${conventional}/.git`)) return conventional;
  return null;
}

function getGitLog(projectPath: string, days: number): string[] {
  try {
    // execFileSync (not execSync) so no shell interpolation — projectPath
    // is passed as a direct argv element, immune to shell metacharacters
    // even if someone planted a malicious directory name in ~/code/.
    const out = execFileSync(
      "git",
      ["-C", projectPath, "log", "--oneline", "--since", `${days} days ago`],
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );
    return out.trim().split("\n").filter(Boolean).slice(0, 40);
  } catch {
    return [];
  }
}

function findProjectsMemoryDir(project: string, hintPath: string | null): string | null {
  if (!existsSync(PROJECTS_DIR)) return null;
  if (hintPath) {
    const slug = hintPath.replace(/\//g, "-");
    const candidate = `${PROJECTS_DIR}/${slug}/memory`;
    if (existsSync(candidate)) return candidate;
  }
  try {
    const entries = readdirSync(PROJECTS_DIR);
    const match = entries.find((e) => e.endsWith(`-${project}`));
    if (match) {
      const memoryDir = `${PROJECTS_DIR}/${match}/memory`;
      if (existsSync(memoryDir)) return memoryDir;
    }
  } catch {}
  return null;
}

interface MemoryFiles {
  feedback: string[];
  project: string[];
}

function loadMemoryFiles(memoryDir: string | null): MemoryFiles {
  const out: MemoryFiles = { feedback: [], project: [] };
  if (!memoryDir || !existsSync(memoryDir)) return out;
  try {
    const files = readdirSync(memoryDir).filter((f) => f.endsWith(".md"));
    for (const f of files) {
      try {
        const content = readFileSync(`${memoryDir}/${f}`, "utf-8");
        if (f.startsWith("feedback_")) out.feedback.push(content);
        else if (f.startsWith("project_")) out.project.push(content);
      } catch {}
    }
  } catch {}
  return out;
}

function compactBlock(b: ChronicleBlock): object {
  return {
    timestamp: b.timestamp.split("T")[0],
    branch: b.branch,
    summary: b.summary,
    accomplished: b.accomplished.slice(0, 8),
    pending: b.pending.slice(0, 8),
    filesModified: (b.filesModified ?? []).slice(0, 10),
    ...(b.goal ? { goal: b.goal } : {}),
    ...(b.notes ? { notes: b.notes } : {}),
  };
}

function stripOuterCodeFences(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/);
  return match ? match[1].trim() : trimmed;
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildStructuredPrompt(
  filtered: ChronicleBlock[],
  level: "repo" | "global",
  period: string,
  usage: unknown,
  tools: { tool: string; uses: number }[]
): string {
  return `You are summarizing coding activity for a ${period} ${level} summary.

Sessions: ${filtered.length}
${filtered.map((b) => `- ${b.project}${b.branch ? ` (${b.branch})` : ""}: ${b.summary}
  Done: ${b.accomplished.join(", ") || "none"}
  Pending: ${b.pending.join(", ") || "none"}`).join("\n")}

Usage stats: ${JSON.stringify(usage || {})}
Top tools: ${tools.map((t) => `${t.tool}: ${t.uses}`).join(", ") || "none"}

Write a concise, high-quality narrative (3-5 sentences) that captures:
1. Main themes and focus areas
2. Key accomplishments
3. What's still pending
4. Any patterns or insights

Return ONLY valid JSON (no markdown, no explanation):
{"narrative": "...", "highlights": ["item1", "item2"], "pending": ["item1", "item2"]}`;
}

function buildNarrativePrompt(
  project: string,
  windowLabel: string,
  blocks: ChronicleBlock[],
  gitLog: string[],
  memory: MemoryFiles
): string {
  return `You are producing a cross-session narrative recap for the "${project}" project covering ${windowLabel}.

You are given three sources:
1. Chronicle session blocks — structured records of what happened each session
2. Git log — what actually shipped to main
3. Curated memory files — the user's codified feedback and project state

---
## Chronicle blocks (${blocks.length} session${blocks.length === 1 ? "" : "s"}, newest first)

${JSON.stringify(blocks.map(compactBlock), null, 2)}

---
## Git log (last ${gitLog.length} commits in window)

${gitLog.length > 0 ? gitLog.join("\n") : "(unavailable or empty)"}

---
## Curated feedback memory (${memory.feedback.length} file${memory.feedback.length === 1 ? "" : "s"})

${memory.feedback.length > 0 ? memory.feedback.join("\n\n---\n\n") : "(none)"}

---
## Curated project memory (${memory.project.length} file${memory.project.length === 1 ? "" : "s"})

${memory.project.length > 0 ? memory.project.join("\n\n---\n\n") : "(none)"}

---

Produce a recap with exactly these four sections, in this order, as Markdown:

## Themes
2-5 bullet points describing what the user has been pushing on. Cluster related sessions into narrative arcs, don't just list them day-by-day.

## Wins
What shipped. Cross-reference the chronicle blocks with the git log — prefer PR numbers and concrete feature names from commit messages where they appear. Bullet points, terse.

## Open threads
Things left unfinished, deferred, or known-broken. Pull from pending items across sessions AND from curated project memory. Bullet points.

## Friction
Recurring gripes or preferences the user has codified. Pull primarily from the feedback memory files. Bullet points, quote the rule verbatim when short.

Rules:
- Be specific. Cite PR numbers, file paths, and feature names when you have them.
- If chronicle data is thin or stale, add a one-line caveat under the final section starting with "Caveat:".
- Do not invent PR numbers, file paths, or facts not present in the sources.
- Do not add a preamble, conclusion, or any sections other than the four requested.
- Terse over verbose. The user is scanning this, not reading it.
- Return only the markdown body. No code fences around the whole thing.`;
}

// ---------------------------------------------------------------------------
// Fallback for narrative format when API call fails or data is thin
// ---------------------------------------------------------------------------

const FALLBACK_SESSION_CAP = 15;

function renderNarrativeFallback(
  project: string,
  windowLabel: string,
  blocks: ChronicleBlock[],
  gitLog: string[],
  memory: MemoryFiles,
  reason: string
): string {
  const lines: string[] = [];
  lines.push(`# Recap: ${project} (${windowLabel})`);
  lines.push("");
  lines.push(`> Fallback output — ${reason}. Raw facts only, no synthesis.`);
  lines.push("");

  const shown = blocks.slice(0, FALLBACK_SESSION_CAP);
  const truncated = blocks.length > FALLBACK_SESSION_CAP;
  lines.push(`## Sessions (${blocks.length}${truncated ? `, showing ${FALLBACK_SESSION_CAP} newest` : ""})`);
  for (const b of shown) {
    lines.push(`- **${b.timestamp.split("T")[0]}** ${b.branch ? `(${b.branch})` : ""} — ${b.summary}`);
    if (b.accomplished.length > 0) {
      lines.push(`  - Done: ${b.accomplished.slice(0, 3).join("; ")}`);
    }
    if (b.pending.length > 0) {
      lines.push(`  - Pending: ${b.pending.slice(0, 3).join("; ")}`);
    }
  }
  if (truncated) {
    lines.push(`- …and ${blocks.length - FALLBACK_SESSION_CAP} more older sessions`);
  }
  lines.push("");

  if (gitLog.length > 0) {
    lines.push(`## Git log (${gitLog.length})`);
    for (const line of gitLog) lines.push(`- ${line}`);
    lines.push("");
  }

  if (memory.feedback.length > 0) {
    lines.push(`## Feedback memory (${memory.feedback.length} file${memory.feedback.length === 1 ? "" : "s"} — see ~/.claude/projects/*/memory/)`);
    lines.push("");
  }

  return lines.join("\n");
}

function renderThinDataFallback(project: string, windowLabel: string, blockCount: number): string {
  return `# Recap: ${project} (${windowLabel})

> Insufficient chronicle data — only ${blockCount} block${blockCount === 1 ? "" : "s"} found in window.

Run \`/chronicle\` to capture the current session, or extend the window with \`--days=N\`.
`;
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

// Project names are interpolated into output filenames. Validate strictly
// to prevent path traversal via --repo=../../etc/foo style inputs. The
// allowed character class matches every real project in ~/code/.
const VALID_REPO_NAME = /^[a-z0-9._-]+$/i;

export async function generateSummary(opts: GenerateSummaryOptions): Promise<GenerateSummaryResult> {
  if (opts.repoName !== undefined && !VALID_REPO_NAME.test(opts.repoName)) {
    throw new Error(
      `Invalid repoName "${opts.repoName}" — must match ${VALID_REPO_NAME}`
    );
  }
  const format: SummaryFormat = opts.format ?? "structured";
  // Narrative recaps always use Opus (lower frequency, higher quality).
  // Structured: Sonnet for short windows, Opus for week+.
  const isLongWindow = opts.windowDays >= 7;
  const model = format === "narrative"
    ? "claude-opus-5"
    : (isLongWindow ? "claude-opus-5" : "claude-sonnet-5");

  const blocks = loadAllBlocks();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - opts.windowDays);
  const filtered = blocks.filter((b) => {
    const inRange = new Date(b.timestamp) >= cutoff;
    const matchesRepo = !opts.repoName || b.project.toLowerCase().includes(opts.repoName.toLowerCase());
    return inRange && matchesRepo;
  });

  const usage = opts.repoName ? getRepoUsage(opts.repoName, opts.windowDays) : getGlobalUsage(opts.windowDays);
  const tools = getToolBreakdown(opts.repoName, opts.windowDays);

  const periodLabel: "daily" | "weekly" | "custom" =
    opts.windowDays === 1 ? "daily" : opts.windowDays === 7 ? "weekly" : "custom";

  const baseSummary: HierarchicalSummary = {
    level: opts.level,
    period: periodLabel,
    date: new Date().toISOString().split("T")[0],
    repo: opts.repoName,
    narrative: "",
    highlights: [],
    pending: [],
    usage: { sessions: filtered.length, tools: 0, tokens: 0 },
    generatedBy: model,
    generatedAt: new Date().toISOString(),
  };

  // Empty data — short-circuit, no API call needed
  if (filtered.length === 0) {
    if (format === "narrative") {
      const windowLabel = `last ${opts.windowDays} day${opts.windowDays === 1 ? "" : "s"}`;
      return {
        summary: { ...baseSummary, narrative: "No activity in window." },
        markdown: renderThinDataFallback(opts.repoName ?? "global", windowLabel, 0),
      };
    }
    return {
      summary: {
        ...baseSummary,
        narrative: `No activity recorded ${opts.repoName ? `for ${opts.repoName}` : ""} in the last ${opts.windowDays} day${opts.windowDays === 1 ? "" : "s"}.`,
      },
    };
  }

  // ----- Narrative format (recap path) -----
  if (format === "narrative") {
    const windowLabel = `last ${opts.windowDays} day${opts.windowDays === 1 ? "" : "s"}`;

    // Thin-data threshold: 1 block isn't worth Opus synthesis
    if (filtered.length < 2) {
      return {
        summary: { ...baseSummary, narrative: "Insufficient chronicle data for narrative recap." },
        markdown: renderThinDataFallback(opts.repoName ?? "global", windowLabel, filtered.length),
      };
    }

    const projectPath = opts.repoName ? findProjectPath(opts.repoName) : null;
    const gitLog = projectPath && opts.withContext ? getGitLog(projectPath, opts.windowDays) : [];
    const memoryDir = opts.repoName && opts.withContext
      ? findProjectsMemoryDir(opts.repoName, projectPath)
      : null;
    const memory = loadMemoryFiles(memoryDir);
    const prompt = buildNarrativePrompt(opts.repoName ?? "(global)", windowLabel, filtered, gitLog, memory);

    const client = new Anthropic();
    let markdown: string;
    try {
      const response = await client.messages.create({
        model,
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      });
      const text = response.content[0].type === "text" ? response.content[0].text : "";
      const cleaned = stripOuterCodeFences(text);
      markdown = cleaned
        ? `# Recap: ${opts.repoName ?? "global"} (${windowLabel})\n\n${cleaned}\n`
        : renderNarrativeFallback(opts.repoName ?? "global", windowLabel, filtered, gitLog, memory, "empty API response");
    } catch (err) {
      console.error(`[summarize] narrative API error: ${err instanceof Error ? err.message : String(err)}`);
      markdown = renderNarrativeFallback(opts.repoName ?? "global", windowLabel, filtered, gitLog, memory, "API call failed");
    }

    return {
      summary: {
        ...baseSummary,
        narrative: "(narrative — see markdown field)",
      },
      markdown,
    };
  }

  // ----- Structured format (existing path, preserved) -----
  const periodLegacy = isLongWindow ? "weekly" : "daily";
  const prompt = buildStructuredPrompt(filtered, opts.level, periodLegacy, usage, tools);

  const client = new Anthropic();
  try {
    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

    return {
      summary: {
        ...baseSummary,
        narrative: parsed.narrative || "Unable to generate summary.",
        highlights: parsed.highlights || [],
        pending: parsed.pending || [],
        usage: {
          sessions: filtered.length,
          tools: tools.reduce((sum, t) => sum + t.uses, 0),
          tokens: (usage as { total_tokens?: number; tokens?: number })?.total_tokens ||
                  (usage as { tokens?: number })?.tokens || 0,
        },
      },
    };
  } catch (err) {
    console.error(`Error generating summary: ${err}`);
    return {
      summary: {
        ...baseSummary,
        narrative: `Error generating summary: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }
}

function getUniqueRepos(blocks: ChronicleBlock[]): string[] {
  const repos = new Set<string>();
  for (const block of blocks) {
    const repo = block.project.split("/")[0].toLowerCase();
    if (repo) repos.add(repo);
  }
  return Array.from(repos);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseFlags(args: string[]) {
  const get = (prefix: string) => {
    const arg = args.find((a) => a.startsWith(prefix));
    return arg ? arg.split("=")[1] : undefined;
  };
  const isWeekly = args.includes("--weekly");
  const daysArg = get("--days=");
  const windowDays = daysArg !== undefined ? parseInt(daysArg, 10) : (isWeekly ? 7 : 1);
  const format: SummaryFormat = args.includes("--format=narrative") ? "narrative" : "structured";
  return {
    isWeekly,
    windowDays,
    repoName: get("--repo="),
    format,
    withContext: args.includes("--with-context"),
    stdoutMd: args.includes("--md"),
  };
}

function periodSuffix(windowDays: number): string {
  if (windowDays === 1) return "daily";
  if (windowDays === 7) return "weekly";
  return `${windowDays}d`;
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));

  mkdirSync(`${SUMMARIES_DIR}/global`, { recursive: true });
  mkdirSync(`${SUMMARIES_DIR}/repos`, { recursive: true });

  if (flags.repoName) {
    // Single-repo path (interactive or new --repo invocations)
    console.log(`Generating ${flags.format} summary for ${flags.repoName} (${flags.windowDays}d)...`);
    const result = await generateSummary({
      level: "repo",
      windowDays: flags.windowDays,
      repoName: flags.repoName,
      format: flags.format,
      withContext: flags.withContext,
    });

    if (flags.format === "narrative") {
      // Narrative path: write markdown to recaps/, skip JSON to keep dashboard clean
      mkdirSync(RECAPS_DIR, { recursive: true });
      const mdFile = `${RECAPS_DIR}/${flags.repoName}-${result.summary.date}-${flags.windowDays}d.md`;
      writeFileSync(mdFile, result.markdown ?? "(no output)");
      console.error(`[summarize] wrote ${mdFile}`);
      if (flags.stdoutMd && result.markdown) console.log(result.markdown);
    } else {
      // Structured path: write JSON to summaries/repos/<repo>/
      const path = `${SUMMARIES_DIR}/repos/${flags.repoName.toLowerCase()}`;
      mkdirSync(path, { recursive: true });
      const filename = `${path}/${result.summary.date}-${periodSuffix(flags.windowDays)}.json`;
      writeFileSync(filename, JSON.stringify(result.summary, null, 2));
      console.log(`Wrote: ${filename}`);
      console.log(`Narrative: ${result.summary.narrative}`);
    }
  } else {
    // Global path — preserves existing daily/weekly cron behavior exactly
    const period = flags.isWeekly ? "weekly" : "daily";
    console.log(`Generating ${period} global summary...`);
    const globalResult = await generateSummary({
      level: "global",
      windowDays: flags.windowDays,
      format: "structured",
    });
    const globalFilename = `${SUMMARIES_DIR}/global/${globalResult.summary.date}-${period}.json`;
    writeFileSync(globalFilename, JSON.stringify(globalResult.summary, null, 2));
    console.log(`Wrote: ${globalFilename}`);
    console.log(`Narrative: ${globalResult.summary.narrative}`);

    // Per-repo runs (cron path)
    const blocks = loadAllBlocks();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - flags.windowDays);
    const recentBlocks = blocks.filter((b) => new Date(b.timestamp) >= cutoff);
    const repos = getUniqueRepos(recentBlocks);
    console.log(`\nFound ${repos.length} repos with recent activity.`);

    for (const repo of repos.slice(0, 10)) {
      console.log(`\nGenerating ${period} summary for ${repo}...`);
      const result = await generateSummary({
        level: "repo",
        windowDays: flags.windowDays,
        repoName: repo,
        format: "structured",
      });
      const path = `${SUMMARIES_DIR}/repos/${repo}`;
      mkdirSync(path, { recursive: true });
      const filename = `${path}/${result.summary.date}-${period}.json`;
      writeFileSync(filename, JSON.stringify(result.summary, null, 2));
      console.log(`Wrote: ${filename}`);
    }
  }

  console.log("\nDone!");
}

// Only run main() when invoked as a script, not when imported.
if (import.meta.main) {
  main().catch(console.error);
}
