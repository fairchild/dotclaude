#!/usr/bin/env bun
/**
 * Run evaluation against golden dataset.
 * Computes fuzzy match and LLM judge scores.
 *
 * Usage:
 *   bun run-eval.ts [--judge-model MODEL]
 */
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const HOME = process.env.HOME!;
const SKILL_DIR = join(HOME, ".claude", "skills", "session-title-eval");
const GOLDEN_FILE = join(SKILL_DIR, "data", "golden.jsonl");
const RESULTS_DIR = join(SKILL_DIR, "data", "results");

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

interface SessionContext {
  firstMessage: string | null;
  lastMessage: string | null;
  gitBranch: string | null;
  projectName: string;
  modifiedFiles: string[];
  explicitSummary: string | null;
  messageCount: number;
}

interface TestCase {
  id: string;
  source_session: string;
  source_project: string;
  context: SessionContext;
  generated_title: string | null;
  ideal_title: string;
  human_score: number | null;
  notes: string | null;
}

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

/**
 * Compute Levenshtein distance between two strings.
 */
function levenshtein(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Compute fuzzy match score (0-1, higher is better).
 */
function fuzzyMatch(generated: string, ideal: string): number {
  const a = generated.toLowerCase().trim();
  const b = ideal.toLowerCase().trim();
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const distance = levenshtein(a, b);
  return 1 - distance / maxLen;
}

/**
 * Call LLM to judge title quality.
 */
async function llmJudge(
  ctx: SessionContext,
  generated: string,
  ideal: string,
  model: string,
  apiKey: string
): Promise<{ score: number; reasoning: string } | null> {
  const prompt = `Rate this session title on a scale of 1-5.

Context:
- First message: "${ctx.firstMessage || "N/A"}"
- Last message: "${ctx.lastMessage || "N/A"}"
- Branch: ${ctx.gitBranch || "N/A"}
- Files: ${ctx.modifiedFiles.slice(0, 5).join(", ") || "N/A"}

Generated title: "${generated}"
Reference title: "${ideal}"

Criteria:
- Specificity (captures the actual task)
- Actionable (uses active voice)
- Concise (4-7 words)
- No meta-language ("user wants", "working on")

Output ONLY valid JSON: {"score": N, "reasoning": "brief explanation"}`;

  try {
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model,
      max_tokens: 150,
      messages: [{ role: "user", content: prompt }],
    });

    const text = res.content[0];
    if (text.type !== "text") return null;

    // Extract JSON from response
    const jsonMatch = text.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error(`LLM judge error: ${e}`);
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  let judgeModel = "claude-3-5-haiku-20241022";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--judge-model" && args[i + 1]) {
      judgeModel = args[i + 1];
      i++;
    }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("Error: ANTHROPIC_API_KEY not set");
    process.exit(1);
  }

  if (!existsSync(GOLDEN_FILE)) {
    console.error(`Error: Golden dataset not found at ${GOLDEN_FILE}`);
    console.error("Run extract-candidates.ts first and curate some test cases.");
    process.exit(1);
  }

  // Load golden dataset
  const testCases: TestCase[] = readFileSync(GOLDEN_FILE, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(line => JSON.parse(line));

  if (testCases.length === 0) {
    console.error("Error: Golden dataset is empty");
    process.exit(1);
  }

  console.log(`Running evaluation on ${testCases.length} test cases...`);
  console.log(`Judge model: ${judgeModel}\n`);

  const results: EvalResult[] = [];
  let totalFuzzy = 0;
  let totalLlmScore = 0;
  let llmCount = 0;

  for (const tc of testCases) {
    const generated = tc.generated_title || "(no title)";
    const fuzzy = fuzzyMatch(generated, tc.ideal_title);

    process.stdout.write(`[${tc.id}] `);

    const judge = await llmJudge(tc.context, generated, tc.ideal_title, judgeModel, apiKey);

    const result: EvalResult = {
      id: tc.id,
      generated_title: generated,
      ideal_title: tc.ideal_title,
      human_score: tc.human_score,
      metrics: {
        fuzzy_match: Math.round(fuzzy * 100) / 100,
        llm_judge_score: judge?.score || null,
        llm_judge_reasoning: judge?.reasoning || null,
      },
    };

    results.push(result);
    totalFuzzy += fuzzy;

    if (judge?.score) {
      totalLlmScore += judge.score;
      llmCount++;
    }

    console.log(`fuzzy=${result.metrics.fuzzy_match.toFixed(2)} llm=${judge?.score || "N/A"}`);
  }

  // Write results
  mkdirSync(RESULTS_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
  const outputFile = join(RESULTS_DIR, `${timestamp}.jsonl`);
  writeFileSync(outputFile, results.map(r => JSON.stringify(r)).join("\n") + "\n");

  // Print summary
  console.log(`\n${"=".repeat(50)}`);
  console.log("SUMMARY");
  console.log("=".repeat(50));
  console.log(`Test cases: ${testCases.length}`);
  console.log(`Avg fuzzy match: ${(totalFuzzy / testCases.length).toFixed(3)}`);
  if (llmCount > 0) {
    console.log(`Avg LLM score: ${(totalLlmScore / llmCount).toFixed(2)} / 5`);
  }
  console.log(`\nResults saved to: ${outputFile}`);
  console.log(`\nRun report.ts to generate detailed analysis.`);
}

main().catch(console.error);
