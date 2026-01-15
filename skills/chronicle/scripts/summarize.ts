#!/usr/bin/env bun
/**
 * Chronicle Summarize - Generate high-quality hierarchical summaries.
 *
 * Usage:
 *   bun summarize.ts              # Daily global + repo summaries
 *   bun summarize.ts --weekly     # Weekly summaries (uses Opus)
 *   bun summarize.ts --repo=name  # Single repo summary
 *
 * Summaries stored in ~/.claude/chronicle/summaries/
 */
import Anthropic from "@anthropic-ai/sdk";
import { loadAllBlocks, type ChronicleBlock } from "./queries.ts";
import { getGlobalUsage, getRepoUsage, getToolBreakdown } from "./usage-queries.ts";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";

const SUMMARIES_DIR = `${process.env.HOME}/.claude/chronicle/summaries`;

interface HierarchicalSummary {
  level: "repo" | "global";
  period: "daily" | "weekly";
  date: string;
  repo?: string;
  narrative: string;
  highlights: string[];
  pending: string[];
  usage: { sessions: number; tools: number; tokens: number };
  generatedBy: string;
  generatedAt: string;
}

async function generateSummary(
  level: "repo" | "global",
  period: "daily" | "weekly",
  repoName?: string
): Promise<HierarchicalSummary> {
  // Opus for weekly (higher quality), Sonnet for daily (balanced)
  const model = period === "weekly"
    ? "claude-opus-4-5-20251101"
    : "claude-sonnet-4-20250514";

  const days = period === "daily" ? 1 : 7;
  const blocks = loadAllBlocks();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const filtered = blocks.filter((b) => {
    const inRange = new Date(b.timestamp) >= cutoff;
    const matchesRepo = !repoName || b.project.toLowerCase().includes(repoName.toLowerCase());
    return inRange && matchesRepo;
  });

  const usage = repoName ? getRepoUsage(repoName, days) : getGlobalUsage(days);
  const tools = getToolBreakdown(repoName, days);

  if (filtered.length === 0) {
    return {
      level,
      period,
      date: new Date().toISOString().split("T")[0],
      repo: repoName,
      narrative: `No activity recorded ${repoName ? `for ${repoName}` : ""} in the last ${period === "daily" ? "day" : "week"}.`,
      highlights: [],
      pending: [],
      usage: { sessions: 0, tools: 0, tokens: 0 },
      generatedBy: model,
      generatedAt: new Date().toISOString(),
    };
  }

  const prompt = `You are summarizing coding activity for a ${period} ${level} summary.

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
      level,
      period,
      date: new Date().toISOString().split("T")[0],
      repo: repoName,
      narrative: parsed.narrative || "Unable to generate summary.",
      highlights: parsed.highlights || [],
      pending: parsed.pending || [],
      usage: {
        sessions: filtered.length,
        tools: tools.reduce((sum, t) => sum + t.uses, 0),
        tokens: (usage as { total_tokens?: number; tokens?: number })?.total_tokens ||
                (usage as { tokens?: number })?.tokens || 0,
      },
      generatedBy: model,
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error(`Error generating summary: ${err}`);
    return {
      level,
      period,
      date: new Date().toISOString().split("T")[0],
      repo: repoName,
      narrative: `Error generating summary: ${err instanceof Error ? err.message : String(err)}`,
      highlights: [],
      pending: [],
      usage: { sessions: filtered.length, tools: 0, tokens: 0 },
      generatedBy: model,
      generatedAt: new Date().toISOString(),
    };
  }
}

function getUniqueRepos(blocks: ChronicleBlock[]): string[] {
  const repos = new Set<string>();
  for (const block of blocks) {
    // Extract repo name (first segment before / or the whole project name)
    const repo = block.project.split("/")[0].toLowerCase();
    if (repo) repos.add(repo);
  }
  return Array.from(repos);
}

async function main() {
  const args = process.argv.slice(2);
  const period = args.includes("--weekly") ? "weekly" : "daily";
  const repoArg = args.find((a) => a.startsWith("--repo="));
  const repoName = repoArg?.split("=")[1];

  // Ensure directories exist
  mkdirSync(`${SUMMARIES_DIR}/global`, { recursive: true });
  mkdirSync(`${SUMMARIES_DIR}/repos`, { recursive: true });

  if (repoName) {
    // Single repo summary
    console.log(`Generating ${period} summary for ${repoName}...`);
    const summary = await generateSummary("repo", period, repoName);
    const path = `${SUMMARIES_DIR}/repos/${repoName.toLowerCase()}`;
    mkdirSync(path, { recursive: true });
    const filename = `${path}/${summary.date}-${period}.json`;
    writeFileSync(filename, JSON.stringify(summary, null, 2));
    console.log(`Wrote: ${filename}`);
    console.log(`Narrative: ${summary.narrative}`);
  } else {
    // Global summary
    console.log(`Generating ${period} global summary...`);
    const globalSummary = await generateSummary("global", period);
    const globalFilename = `${SUMMARIES_DIR}/global/${globalSummary.date}-${period}.json`;
    writeFileSync(globalFilename, JSON.stringify(globalSummary, null, 2));
    console.log(`Wrote: ${globalFilename}`);
    console.log(`Narrative: ${globalSummary.narrative}`);

    // Get unique repos from recent blocks and generate summaries
    const blocks = loadAllBlocks();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (period === "daily" ? 1 : 7));
    const recentBlocks = blocks.filter((b) => new Date(b.timestamp) >= cutoff);
    const repos = getUniqueRepos(recentBlocks);

    console.log(`\nFound ${repos.length} repos with recent activity.`);

    // Limit to 10 repos to avoid excessive API calls
    for (const repo of repos.slice(0, 10)) {
      console.log(`\nGenerating ${period} summary for ${repo}...`);
      const summary = await generateSummary("repo", period, repo);
      const path = `${SUMMARIES_DIR}/repos/${repo}`;
      mkdirSync(path, { recursive: true });
      const filename = `${path}/${summary.date}-${period}.json`;
      writeFileSync(filename, JSON.stringify(summary, null, 2));
      console.log(`Wrote: ${filename}`);
    }
  }

  console.log("\nDone!");
}

main().catch(console.error);
