#!/usr/bin/env bun
/**
 * Chronicle Recap - Multi-session narrative recap for a project.
 *
 * Produces a Themes / Wins / Open threads / Friction narrative across the
 * last N sessions, grounded in ChronicleBlocks + git log + curated memory.
 *
 * Usage:
 *   bun recap.ts                          # current project (from cwd), last 7 days
 *   bun recap.ts workspaces               # specific project
 *   bun recap.ts --days=14                # extend window
 *   bun recap.ts --sessions=5             # window by session count instead
 *   bun recap.ts --stdout-only            # skip writing to disk
 */
import Anthropic from "@anthropic-ai/sdk";
import {
  loadAllBlocks,
  getBlocksByProject,
  type ChronicleBlock,
} from "./queries.ts";
import { detectContext } from "./context.ts";
import { execSync } from "child_process";
import {
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  readdirSync,
} from "fs";

// Load ~/.claude/.env if present (mirrors extract.ts) so ANTHROPIC_API_KEY
// resolves when the script is invoked outside a Claude Code session.
const envPath = `${process.env.HOME}/.claude/.env`;
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const [key, ...rest] = line.split("=");
    if (key?.trim() && !key.startsWith("#") && !process.env[key.trim()]) {
      process.env[key.trim()] = rest.join("=").trim().replace(/^["']|["']$/g, "");
    }
  }
}

const RECAPS_DIR = `${process.env.HOME}/.claude/chronicle/recaps`;
const PROJECTS_DIR = `${process.env.HOME}/.claude/projects`;

interface Args {
  project: string | null;
  days: number | null;
  sessions: number | null;
  stdoutOnly: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { project: null, days: null, sessions: null, stdoutOnly: false };
  for (const arg of argv) {
    if (arg.startsWith("--days=")) out.days = parseInt(arg.split("=")[1], 10);
    else if (arg.startsWith("--sessions=")) out.sessions = parseInt(arg.split("=")[1], 10);
    else if (arg === "--stdout-only") out.stdoutOnly = true;
    else if (!arg.startsWith("--") && !out.project) out.project = arg;
  }
  if (out.days === null && out.sessions === null) out.days = 7;
  return out;
}

function filterBlocks(
  blocks: ChronicleBlock[],
  args: Args
): ChronicleBlock[] {
  if (args.sessions !== null) {
    return blocks.slice(0, args.sessions);
  }
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (args.days ?? 7));
  return blocks.filter((b) => new Date(b.timestamp) >= cutoff);
}

function getGitLog(projectPath: string, days: number): string[] {
  try {
    const out = execSync(
      `git -C "${projectPath}" log --oneline --since="${days} days ago"`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );
    return out.trim().split("\n").filter(Boolean).slice(0, 40);
  } catch {
    return [];
  }
}

/**
 * Find a local path for the project. Preference order:
 * 1. cwd if detectContext(cwd).project matches
 * 2. explicit alias (e.g. dotclaude → ~/.claude)
 * 3. ~/code/<project> (user convention per ~/code/CLAUDE.md)
 */
const PROJECT_PATH_ALIASES: Record<string, string> = {
  dotclaude: `${process.env.HOME}/.claude`,
};

function findProjectPath(project: string, cwdProject: string | null, cwd: string): string | null {
  if (cwdProject === project && existsSync(`${cwd}/.git`)) return cwd;
  const aliased = PROJECT_PATH_ALIASES[project];
  if (aliased && existsSync(`${aliased}/.git`)) return aliased;
  const conventional = `${process.env.HOME}/code/${project}`;
  if (existsSync(`${conventional}/.git`)) return conventional;
  return null;
}

/**
 * Locate the ~/.claude/projects/<slug>/memory dir for a project.
 *
 * Preference order:
 * 1. Slugify cwd directly (handles aliased projects like dotclaude where the
 *    project name doesn't appear in the path — e.g. ~/.claude → -Users-fairchild--claude)
 * 2. Scan for any slug ending in "-<project>" (works for conventional ~/code/* layout)
 */
function findProjectsMemoryDir(project: string, cwd: string | null): string | null {
  if (!existsSync(PROJECTS_DIR)) return null;

  if (cwd) {
    const slug = cwd.replace(/\//g, "-");
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

function buildPrompt(
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

const FALLBACK_SESSION_CAP = 15;

function renderFallback(
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

function stripOuterCodeFences(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/);
  return match ? match[1].trim() : trimmed;
}

async function synthesize(prompt: string): Promise<string | null> {
  const client = new Anthropic();
  try {
    const response = await client.messages.create({
      model: "claude-opus-4-5-20251101",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });
    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const cleaned = stripOuterCodeFences(text);
    return cleaned || null;
  } catch (err) {
    console.error(`[recap] API error: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const ctx = detectContext(process.cwd());
  const project = args.project ?? ctx.project;

  if (!project) {
    console.error("[recap] could not determine project — pass one as the first arg");
    process.exit(1);
  }

  const windowLabel =
    args.sessions !== null
      ? `last ${args.sessions} session${args.sessions === 1 ? "" : "s"}`
      : `last ${args.days} day${args.days === 1 ? "" : "s"}`;

  const projectBlocks = getBlocksByProject(project);
  const blocks = filterBlocks(projectBlocks, args);

  // Thin data fallback: less than 2 blocks → list raw session JSONLs so the
  // user at least knows what sessions exist, and exit cleanly.
  if (blocks.length < 2) {
    console.error(`[recap] only ${blocks.length} chronicle block${blocks.length === 1 ? "" : "s"} for "${project}" in ${windowLabel}`);
    const memoryDir = findProjectsMemoryDir(project, ctx.cwd);
    if (memoryDir) {
      const sessionsDir = memoryDir.replace(/\/memory$/, "");
      try {
        const jsonls = readdirSync(sessionsDir)
          .filter((f) => f.endsWith(".jsonl"))
          .map((f) => {
            const { mtimeMs } = require("fs").statSync(`${sessionsDir}/${f}`);
            return { name: f, mtimeMs };
          })
          .sort((a, b) => b.mtimeMs - a.mtimeMs)
          .slice(0, 10);
        if (jsonls.length > 0) {
          console.error(`[recap] raw session JSONLs in ${sessionsDir}:`);
          for (const j of jsonls) {
            console.error(`  ${new Date(j.mtimeMs).toISOString().split("T")[0]}  ${j.name}`);
          }
        }
      } catch {}
    }
    console.error(`[recap] run /chronicle to capture the current session or extend the window with --days=N`);
    process.exit(0);
  }

  // Compute git log window from the actual blocks. When --days is explicit
  // use that; when --sessions is used, derive the span from the oldest block.
  const gitLogDays = (() => {
    if (args.days !== null) return args.days;
    const oldest = new Date(blocks[blocks.length - 1].timestamp);
    const days = Math.ceil((Date.now() - oldest.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(days, 1);
  })();

  const projectPath = findProjectPath(project, ctx.project, ctx.cwd);
  const gitLog = projectPath ? getGitLog(projectPath, gitLogDays) : [];
  const memoryDir = findProjectsMemoryDir(project, ctx.cwd);
  const memory = loadMemoryFiles(memoryDir);

  const prompt = buildPrompt(project, windowLabel, blocks, gitLog, memory);
  const synthesized = await synthesize(prompt);

  let body: string;
  if (synthesized) {
    body = `# Recap: ${project} (${windowLabel})\n\n${synthesized}\n`;
  } else {
    body = renderFallback(project, windowLabel, blocks, gitLog, memory, "API call failed");
  }

  console.log(body);

  if (!args.stdoutOnly) {
    mkdirSync(RECAPS_DIR, { recursive: true });
    const date = new Date().toISOString().split("T")[0];
    const windowSuffix =
      args.sessions !== null ? `${args.sessions}s` : `${args.days}d`;
    const path = `${RECAPS_DIR}/${project}-${date}-${windowSuffix}.md`;
    writeFileSync(path, body);
    console.error(`[recap] wrote ${path}`);
  }
}

main().catch((err) => {
  console.error(`[recap] fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
