#!/usr/bin/env bun
/**
 * Evaluate session title quality from pending feedback data.
 * Works without a golden dataset — uses pattern checks + optional LLM judge.
 *
 * Usage:
 *   bun skills/session-titles/scripts/eval-quality.ts              # pattern checks only
 *   bun skills/session-titles/scripts/eval-quality.ts --judge       # + LLM scoring (sample)
 *   bun skills/session-titles/scripts/eval-quality.ts --judge --sample 100
 */
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import Anthropic from "@anthropic-ai/sdk";
import type { TitleFeedback } from "./schema.ts";

const HOME = process.env.HOME!;
const PENDING_FILE = join(HOME, ".claude", "title-feedback", "pending.jsonl");

// Load API key from ~/.claude/.env
const envPath = join(HOME, ".claude", ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const [key, ...rest] = line.split("=");
    if (key?.trim() && !key.startsWith("#") && !process.env[key.trim()]) {
      process.env[key.trim()] = rest.join("=").trim().replace(/^["']|["']$/g, "");
    }
  }
}

// --- Data loading ---

function loadAndDedup(): TitleFeedback[] {
  if (!existsSync(PENDING_FILE)) {
    console.error(`Error: ${PENDING_FILE} not found`);
    process.exit(1);
  }

  const byId = new Map<string, TitleFeedback>();

  for (const line of readFileSync(PENDING_FILE, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as TitleFeedback;
      // Filter test data
      if (entry.context.projectName === "test-project") continue;
      // Keep latest by timestamp (later lines win for same ID)
      const existing = byId.get(entry.id);
      if (!existing || entry.timestamp > existing.timestamp) {
        byId.set(entry.id, entry);
      }
    } catch {}
  }

  return [...byId.values()];
}

// --- Pattern checks ---

type Issue =
  | "fallback"
  | "template_leak"
  | "meta_language"
  | "shift_prefix"
  | "too_short"
  | "too_long"
  | "quoted"
  | "user_echo";

function checkPatterns(entry: TitleFeedback): Issue[] {
  const title = entry.generatedTitle;
  const issues: Issue[] = [];

  // Fallback titles
  if (/^Session /i.test(title) || / session$/i.test(title)) {
    issues.push("fallback");
  }

  // Template/reasoning leaks
  if (/\n/.test(title) || /Rationale:/i.test(title) || /Explanation:/i.test(title) || /Reasoning:/i.test(title)) {
    issues.push("template_leak");
  }

  // Meta-language
  if (/user wants/i.test(title) || /working on/i.test(title) || /based on the context/i.test(title)) {
    issues.push("meta_language");
  }

  // Shift prefix (N) still present
  if (/^\(\d+\)\s/.test(title)) {
    issues.push("shift_prefix");
  }

  // Too short (<2 words)
  if (title.split(/\s+/).length < 2) {
    issues.push("too_short");
  }

  // Too long (>10 words or >60 chars)
  if (title.split(/\s+/).length > 10 || title.length > 60) {
    issues.push("too_long");
  }

  // Wrapped in quotes
  if (/^["'].*["']$/.test(title)) {
    issues.push("quoted");
  }

  // User echo — title is the primary request verbatim (fallback, not generated)
  if (entry.context.primaryRequest && title === entry.context.primaryRequest) {
    issues.push("user_echo");
  }

  return issues;
}

// --- LLM judge ---

interface JudgeResult {
  score: number;
  reasoning: string;
}

async function judgeTitle(
  entry: TitleFeedback,
  client: Anthropic,
): Promise<JudgeResult | null> {
  const ctx = entry.context;
  const prompt = `Rate this session title's quality from 1 to 5.

Context:
- Project: ${ctx.projectName}
- Branch: ${ctx.gitBranch || "N/A"}
- User's request: "${ctx.primaryRequest || ctx.latestActivity || "N/A"}"
- Files touched: ${ctx.modifiedFiles.slice(0, 5).join(", ") || "N/A"}
- Messages in session: ${ctx.messageCount}

Generated title: "${entry.generatedTitle}"

Rubric:
1 = Useless (timestamp, generic, or completely wrong)
2 = Poor (vague, meta-language like "user wants", or too long/short)
3 = Acceptable (captures the topic but could be more specific)
4 = Good (specific, actionable, right length)
5 = Excellent (would immediately orient someone returning to this session)

Output ONLY valid JSON: {"score": N, "reasoning": "brief explanation"}`;

  try {
    const res = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 150,
      messages: [{ role: "user", content: prompt }],
    });
    const text = res.content[0];
    if (text.type !== "text") return null;
    const match = text.text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]) as JudgeResult;
  } catch {
    return null;
  }
}

// --- Report generation ---

interface EntryResult {
  entry: TitleFeedback;
  issues: Issue[];
  judge?: JudgeResult | null;
}

function printReport(
  results: EntryResult[],
  rawLineCount: number,
  judged: boolean,
  sampleSize: number,
) {
  const date = new Date().toISOString().split("T")[0];

  console.log("# Session Title Quality Report");
  console.log(`Date: ${date}`);
  console.log(`Entries: ${results.length} (after dedup, excluding test data)`);
  console.log(`Raw lines in pending.jsonl: ${rawLineCount}`);
  console.log();

  // Automated quality checks
  const issueCounts = new Map<string, number>();
  let cleanCount = 0;

  for (const r of results) {
    if (r.issues.length === 0) {
      cleanCount++;
    }
    for (const issue of r.issues) {
      issueCounts.set(issue, (issueCounts.get(issue) || 0) + 1);
    }
  }

  console.log("## Automated Quality Checks");
  console.log();
  console.log("| Issue | Count | % |");
  console.log("|-------|------:|----:|");
  console.log(`| Clean | ${cleanCount} | ${pct(cleanCount, results.length)} |`);

  const sortedIssues = [...issueCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [issue, count] of sortedIssues) {
    console.log(`| ${issue} | ${count} | ${pct(count, results.length)} |`);
  }
  console.log();

  // By prompt version
  const byVersion = new Map<string, { total: number; clean: number; judgeScores: number[] }>();
  for (const r of results) {
    const v = r.entry.promptVersion || "unknown";
    if (!byVersion.has(v)) byVersion.set(v, { total: 0, clean: 0, judgeScores: [] });
    const bucket = byVersion.get(v)!;
    bucket.total++;
    if (r.issues.length === 0) bucket.clean++;
    if (r.judge?.score) bucket.judgeScores.push(r.judge.score);
  }

  console.log("## By Prompt Version");
  console.log();
  console.log("| Version | Count | Clean % | Avg Judge |");
  console.log("|---------|------:|--------:|----------:|");
  for (const [version, data] of [...byVersion.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const avgJudge = data.judgeScores.length > 0
      ? (data.judgeScores.reduce((a, b) => a + b, 0) / data.judgeScores.length).toFixed(1)
      : "-";
    console.log(`| ${version} | ${data.total} | ${pct(data.clean, data.total)} | ${avgJudge} |`);
  }
  console.log();

  // By model
  const byModel = new Map<string, number>();
  for (const r of results) {
    const m = r.entry.modelUsed || "unknown";
    byModel.set(m, (byModel.get(m) || 0) + 1);
  }

  console.log("## By Model");
  console.log();
  console.log("| Model | Count |");
  console.log("|-------|------:|");
  for (const [model, count] of [...byModel.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`| ${model} | ${count} |`);
  }
  console.log();

  // Worst titles (by issue count, then alphabetically)
  const worst = results
    .filter(r => r.issues.length > 0)
    .sort((a, b) => b.issues.length - a.issues.length)
    .slice(0, 10);

  if (worst.length > 0) {
    console.log("## Worst Titles");
    console.log();
    for (let i = 0; i < worst.length; i++) {
      const r = worst[i];
      console.log(`${i + 1}. "${r.entry.generatedTitle}" — project: ${r.entry.context.projectName} (${r.issues.join(", ")})`);
    }
    console.log();
  }

  // LLM judge distribution
  if (judged) {
    const judgedResults = results.filter(r => r.judge?.score != null);
    if (judgedResults.length > 0) {
      const dist = [0, 0, 0, 0, 0];
      let total = 0;
      for (const r of judgedResults) {
        const s = Math.min(Math.max(Math.round(r.judge!.score), 1), 5);
        dist[s - 1]++;
        total += r.judge!.score;
      }

      console.log(`## LLM Judge Distribution (N=${judgedResults.length})`);
      console.log();
      console.log(`${dist.map((c, i) => `${i + 1}★: ${c}`).join("  ")}`);
      console.log(`Avg: ${(total / judgedResults.length).toFixed(1)}/5`);
      console.log();

      // Show lowest-scored titles from judge
      const lowestJudged = judgedResults
        .sort((a, b) => a.judge!.score - b.judge!.score)
        .slice(0, 5);

      console.log("### Lowest Judged Titles");
      console.log();
      for (const r of lowestJudged) {
        console.log(`- ${r.judge!.score}★ "${r.entry.generatedTitle}" — ${r.judge!.reasoning}`);
      }
      console.log();
    }
  }
}

function pct(n: number, total: number): string {
  return total > 0 ? (n / total * 100).toFixed(1) : "0.0";
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);
  let useJudge = false;
  let sampleSize = 50;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--judge") useJudge = true;
    if (args[i] === "--sample" && args[i + 1]) {
      sampleSize = parseInt(args[i + 1], 10);
      i++;
    }
  }

  // Count raw lines
  const rawLines = readFileSync(PENDING_FILE, "utf-8").split("\n").filter(l => l.trim()).length;

  // Load and deduplicate
  const entries = loadAndDedup();
  console.error(`Loaded ${entries.length} unique entries (${rawLines} raw, filtered test data)`);

  // Run pattern checks on all entries
  const results: EntryResult[] = entries.map(entry => ({
    entry,
    issues: checkPatterns(entry),
  }));

  // Optionally run LLM judge on a random sample
  if (useJudge) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error("Error: ANTHROPIC_API_KEY not set. Skipping judge.");
    } else {
      const client = new Anthropic({ apiKey });
      // Shuffle and take sample
      const shuffled = [...results].sort(() => Math.random() - 0.5);
      const sample = shuffled.slice(0, Math.min(sampleSize, results.length));

      console.error(`Running LLM judge on ${sample.length} entries...`);
      let done = 0;
      for (const r of sample) {
        r.judge = await judgeTitle(r.entry, client);
        done++;
        if (done % 10 === 0) console.error(`  ${done}/${sample.length}`);
      }
      console.error(`Judge complete.`);
    }
  }

  // Print report to stdout
  printReport(results, rawLines, useJudge, sampleSize);
}

main().catch(console.error);
