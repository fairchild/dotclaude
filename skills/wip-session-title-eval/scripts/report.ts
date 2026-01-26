#!/usr/bin/env bun
/**
 * Generate human-readable report from latest eval results.
 *
 * Usage:
 *   bun report.ts [--file PATH]
 */
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";

const HOME = process.env.HOME!;
const SKILL_DIR = join(HOME, ".claude", "skills", "session-title-eval");
const RESULTS_DIR = join(SKILL_DIR, "data", "results");
const GOLDEN_FILE = join(SKILL_DIR, "data", "golden.jsonl");

interface EvalResult {
  id: string;
  generated_title: string;
  ideal_title: string;
  human_score: number | null;
  metrics: {
    fuzzy_match: number;
    llm_judge_score: number | null;
    llm_judge_reasoning: string | null;
  };
}

interface TestCase {
  id: string;
  context: {
    firstMessage: string | null;
    lastMessage: string | null;
    gitBranch: string | null;
    projectName: string;
  };
}

function getLatestResultFile(): string | null {
  if (!existsSync(RESULTS_DIR)) return null;
  const files = readdirSync(RESULTS_DIR)
    .filter(f => f.endsWith(".jsonl"))
    .sort()
    .reverse();
  return files[0] ? join(RESULTS_DIR, files[0]) : null;
}

function loadResults(path: string): EvalResult[] {
  return readFileSync(path, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function loadGolden(): Map<string, TestCase> {
  const map = new Map<string, TestCase>();
  if (!existsSync(GOLDEN_FILE)) return map;

  for (const line of readFileSync(GOLDEN_FILE, "utf-8").trim().split("\n")) {
    if (!line) continue;
    const tc = JSON.parse(line);
    map.set(tc.id, tc);
  }
  return map;
}

function histogram(values: number[], buckets: number[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const b of buckets) {
    counts.set(`${b}`, 0);
  }

  for (const v of values) {
    for (const b of buckets) {
      if (v <= b / 5) {
        counts.set(`${b}`, (counts.get(`${b}`) || 0) + 1);
        break;
      }
    }
  }
  return counts;
}

function main() {
  const args = process.argv.slice(2);
  let resultFile: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--file" && args[i + 1]) {
      resultFile = args[i + 1];
      i++;
    }
  }

  if (!resultFile) {
    resultFile = getLatestResultFile();
  }

  if (!resultFile || !existsSync(resultFile)) {
    console.error("Error: No eval results found.");
    console.error("Run run-eval.ts first.");
    process.exit(1);
  }

  const results = loadResults(resultFile);
  const golden = loadGolden();

  console.log("# Session Title Evaluation Report\n");
  console.log(`**Date:** ${new Date().toISOString().split("T")[0]}`);
  console.log(`**Results file:** ${resultFile}`);
  console.log(`**Test cases:** ${results.length}\n`);

  // Overall metrics
  const fuzzyScores = results.map(r => r.metrics.fuzzy_match);
  const llmScores = results.filter(r => r.metrics.llm_judge_score !== null).map(r => r.metrics.llm_judge_score!);
  const humanScores = results.filter(r => r.human_score !== null).map(r => r.human_score!);

  const avgFuzzy = fuzzyScores.reduce((a, b) => a + b, 0) / fuzzyScores.length;
  const avgLlm = llmScores.length > 0 ? llmScores.reduce((a, b) => a + b, 0) / llmScores.length : null;
  const avgHuman = humanScores.length > 0 ? humanScores.reduce((a, b) => a + b, 0) / humanScores.length : null;

  console.log("## Overall Metrics\n");
  console.log(`| Metric | Value |`);
  console.log(`|--------|-------|`);
  console.log(`| Avg Fuzzy Match | ${avgFuzzy.toFixed(3)} |`);
  if (avgLlm !== null) {
    console.log(`| Avg LLM Score | ${avgLlm.toFixed(2)} / 5 |`);
  }
  if (avgHuman !== null) {
    console.log(`| Avg Human Score | ${avgHuman.toFixed(2)} / 5 |`);
  }
  console.log();

  // Distribution
  console.log("## Score Distribution\n");

  if (llmScores.length > 0) {
    const dist = [0, 0, 0, 0, 0];
    for (const s of llmScores) {
      dist[Math.min(Math.max(Math.round(s) - 1, 0), 4)]++;
    }
    console.log("### LLM Judge Scores\n");
    console.log("```");
    for (let i = 0; i < 5; i++) {
      const bar = "█".repeat(Math.round(dist[i] / results.length * 30));
      console.log(`${i + 1}: ${bar} (${dist[i]})`);
    }
    console.log("```\n");
  }

  // Worst performers
  const sorted = [...results].sort((a, b) => {
    const aScore = a.metrics.llm_judge_score ?? a.metrics.fuzzy_match * 5;
    const bScore = b.metrics.llm_judge_score ?? b.metrics.fuzzy_match * 5;
    return aScore - bScore;
  });

  console.log("## Worst Performers\n");
  console.log("Cases with lowest scores that need attention:\n");

  for (const r of sorted.slice(0, 5)) {
    const tc = golden.get(r.id);
    console.log(`### ${r.id}\n`);
    console.log(`- **Generated:** "${r.generated_title}"`);
    console.log(`- **Ideal:** "${r.ideal_title}"`);
    console.log(`- **Fuzzy:** ${r.metrics.fuzzy_match.toFixed(2)}`);
    if (r.metrics.llm_judge_score !== null) {
      console.log(`- **LLM Score:** ${r.metrics.llm_judge_score}/5`);
      console.log(`- **Reasoning:** ${r.metrics.llm_judge_reasoning}`);
    }
    if (tc) {
      console.log(`- **Context:** "${tc.context.firstMessage?.substring(0, 50)}..."`);
    }
    console.log();
  }

  // Best performers
  console.log("## Best Performers\n");
  console.log("Top scoring titles to learn from:\n");

  for (const r of sorted.slice(-3).reverse()) {
    console.log(`### ${r.id}\n`);
    console.log(`- **Generated:** "${r.generated_title}"`);
    console.log(`- **Ideal:** "${r.ideal_title}"`);
    console.log(`- **Fuzzy:** ${r.metrics.fuzzy_match.toFixed(2)}`);
    if (r.metrics.llm_judge_score !== null) {
      console.log(`- **LLM Score:** ${r.metrics.llm_judge_score}/5`);
    }
    console.log();
  }

  // Recommendations
  console.log("## Recommendations\n");

  const lowFuzzy = results.filter(r => r.metrics.fuzzy_match < 0.3).length;
  const lowLlm = results.filter(r => r.metrics.llm_judge_score !== null && r.metrics.llm_judge_score <= 2).length;

  if (lowFuzzy > results.length * 0.3) {
    console.log("- **High divergence:** Many titles differ significantly from ideal. Consider reviewing prompt examples.");
  }
  if (lowLlm > results.length * 0.3) {
    console.log("- **Quality issues:** Many titles scored 1-2. Check for meta-language patterns.");
  }
  if (avgLlm !== null && avgLlm >= 4) {
    console.log("- **Good performance:** Average score is high. Focus on edge cases.");
  }

  console.log("\n---\n");
  console.log("*Run `bun run-eval.ts` after prompt changes to track improvement.*");
}

main();
