#!/usr/bin/env bun
/**
 * GEPA-inspired reflective prompt evolution for session title generation.
 *
 * Evolves the title generation prompt by:
 * 1. Evaluating the current prompt on a diverse "Pareto set" of sessions
 * 2. Reflecting on failures with aggregated diagnostics (GEPA's feedback engineering)
 * 3. Proposing targeted prompt mutations via LLM reflection
 * 4. Keeping mutations that improve scores, tracking ancestry
 * 5. Using Pareto-based candidate selection to avoid local optima
 *
 * Usage:
 *   bun skills/session-titles/scripts/evolve-prompt.ts                     # 3 iterations
 *   bun skills/session-titles/scripts/evolve-prompt.ts --iterations 5      # more iterations
 *   bun skills/session-titles/scripts/evolve-prompt.ts --pareto-size 30    # larger validation set
 */
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
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

// --- Types ---

interface PromptCandidate {
  id: number;
  parentId: number | null;
  systemPrompt: string;
  instructions: string;
  generation: number;
  diagnosis: string;
}

interface EntryEval {
  entryId: string;
  title: string;
  score: number;
  issues: string[];
}

interface CandidateEval {
  candidateId: number;
  entries: EntryEval[];
  avgScore: number;
  cleanRate: number;
}

type Issue =
  | "fallback"
  | "template_leak"
  | "meta_language"
  | "shift_prefix"
  | "too_short"
  | "too_long"
  | "quoted"
  | "user_echo";

// --- Data Loading ---

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
      if (entry.context.projectName === "test-project") continue;
      const existing = byId.get(entry.id);
      if (!existing || entry.timestamp > existing.timestamp) {
        byId.set(entry.id, entry);
      }
    } catch {}
  }
  return [...byId.values()];
}

// --- Pattern Checks ---

function checkPatterns(title: string, ctx: TitleFeedback["context"]): Issue[] {
  const issues: Issue[] = [];
  if (/^Session /i.test(title) || / session$/i.test(title)) issues.push("fallback");
  if (
    /\n/.test(title) ||
    /Rationale:/i.test(title) ||
    /Explanation:/i.test(title) ||
    /Reasoning:/i.test(title)
  )
    issues.push("template_leak");
  if (
    /user wants/i.test(title) ||
    /working on/i.test(title) ||
    /based on the context/i.test(title)
  )
    issues.push("meta_language");
  if (/^\(\d+\)\s/.test(title)) issues.push("shift_prefix");
  if (title.split(/\s+/).length < 2) issues.push("too_short");
  if (title.split(/\s+/).length > 10 || title.length > 60) issues.push("too_long");
  if (/^["'].*["']$/.test(title)) issues.push("quoted");
  if (ctx.primaryRequest && title === ctx.primaryRequest) issues.push("user_echo");
  return issues;
}

function scoreFromIssues(issues: Issue[]): number {
  if (issues.length === 0) return 1.0;
  return Math.max(0, 1.0 - issues.length * 0.3);
}

// --- Seed Prompt (extracted from generate-session-title-testable.ts v3.0) ---

function seedPrompt(): PromptCandidate {
  return {
    id: 0,
    parentId: null,
    systemPrompt:
      "Output ONLY a 4-7 word title. Nothing else. No explanations, apologies, preambles, or quotes.",
    instructions: [
      'Generate a 4-7 word title for this coding session.',
      '',
      'Rules:',
      '- Active voice: "Fix X", "Add Y", "Debug Z"',
      '- NO meta-language ("user wants", "working on")',
      '- Focus on WHAT, not WHO',
      '',
      'GOOD: "Fix OAuth redirect loop", "Add rate limiting to API", "Debug flaky pytest CI", "Refactor user settings page"',
      'BAD: "Session about fixing things", "Working on code", "User wants to update auth"',
    ].join("\n"),
    generation: 0,
    diagnosis: "Seed prompt (v3.0 from generate-session-title-testable.ts)",
  };
}

// --- Prompt Construction ---

function buildUserPrompt(ctx: TitleFeedback["context"], instructions: string): string {
  const parts: string[] = [];
  parts.push(`Project: ${ctx.projectName}`);
  if (ctx.gitBranch && ctx.gitBranch !== "main" && ctx.gitBranch !== "master") {
    parts.push(`Branch: ${ctx.gitBranch}`);
  }
  if (ctx.explicitSummary) {
    parts.push(`Session summary: ${ctx.explicitSummary}`);
  }
  const request = ctx.primaryRequest || ctx.latestActivity;
  if (request) {
    parts.push(`User's request: "${request}"`);
  }
  if (ctx.modifiedFiles.length > 0) {
    parts.push(`Files touched: ${ctx.modifiedFiles.slice(0, 5).join(", ")}`);
  }
  parts.push("");
  parts.push(instructions);
  return parts.join("\n");
}

// --- Title Generation ---

async function generateTitle(
  ctx: TitleFeedback["context"],
  candidate: PromptCandidate,
  client: Anthropic,
): Promise<string> {
  try {
    const res = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 60,
      system: candidate.systemPrompt,
      messages: [{ role: "user", content: buildUserPrompt(ctx, candidate.instructions) }],
    });
    const block = res.content[0];
    if (block.type !== "text") return "(generation failed)";
    return block.text.trim();
  } catch {
    return "(generation failed)";
  }
}

// --- Pareto Set Selection ---

function selectParetoSet(entries: TitleFeedback[], size: number): TitleFeedback[] {
  const withIssues = entries.filter(
    (e) => checkPatterns(e.generatedTitle, e.context).length > 0,
  );
  const clean = entries.filter(
    (e) => checkPatterns(e.generatedTitle, e.context).length === 0,
  );

  const shuffle = <T>(arr: T[]): T[] => [...arr].sort(() => Math.random() - 0.5);

  // Stratify: 50% entries that had issues, 30% clean, 20% random
  const failSample = shuffle(withIssues).slice(0, Math.ceil(size * 0.5));
  const cleanSample = shuffle(clean).slice(0, Math.ceil(size * 0.3));
  const randomSample = shuffle(entries).slice(0, Math.ceil(size * 0.2));

  const seen = new Set<string>();
  const result: TitleFeedback[] = [];
  for (const e of [...failSample, ...cleanSample, ...randomSample]) {
    if (!seen.has(e.id) && result.length < size) {
      seen.add(e.id);
      result.push(e);
    }
  }
  return result;
}

// --- Candidate Evaluation ---

async function evaluateCandidate(
  candidate: PromptCandidate,
  paretoSet: TitleFeedback[],
  client: Anthropic,
): Promise<CandidateEval> {
  const entries: EntryEval[] = [];
  let totalScore = 0;
  let cleanCount = 0;

  for (const entry of paretoSet) {
    const title = await generateTitle(entry.context, candidate, client);
    const issues = checkPatterns(title, entry.context);
    const score = scoreFromIssues(issues);
    entries.push({ entryId: entry.id, title, score, issues });
    totalScore += score;
    if (issues.length === 0) cleanCount++;
  }

  return {
    candidateId: candidate.id,
    entries,
    avgScore: totalScore / paretoSet.length,
    cleanRate: cleanCount / paretoSet.length,
  };
}

// --- Reflective Mutation (GEPA's core) ---

async function reflectAndMutate(
  candidate: PromptCandidate,
  paretoSet: TitleFeedback[],
  evalResult: CandidateEval,
  client: Anthropic,
  nextId: number,
): Promise<PromptCandidate> {
  // Partition into failures and successes
  const failures = evalResult.entries.filter((e) => e.issues.length > 0);
  const successes = evalResult.entries.filter((e) => e.issues.length === 0);
  const entryMap = new Map(paretoSet.map((e) => [e.id, e]));

  // Aggregate failure diagnostics — GEPA's "feedback engineering"
  const issueCounts = new Map<string, number>();
  const issueExamples = new Map<string, string[]>();
  for (const f of failures) {
    for (const issue of f.issues) {
      issueCounts.set(issue, (issueCounts.get(issue) || 0) + 1);
      const examples = issueExamples.get(issue) || [];
      if (examples.length < 3) examples.push(`"${f.title.substring(0, 80)}"`);
      issueExamples.set(issue, examples);
    }
  }

  // Build reflection prompt
  const p: string[] = [];
  p.push("You are optimizing a prompt for a session title generator.");
  p.push("The system takes coding session context (project, branch, user request, files) and generates a concise 4-7 word title.");
  p.push("");
  p.push("## Current Prompt");
  p.push("");
  p.push("System prompt:");
  p.push("```");
  p.push(candidate.systemPrompt);
  p.push("```");
  p.push("");
  p.push("Instruction block (appended after context variables like Project, Branch, Request, Files):");
  p.push("```");
  p.push(candidate.instructions);
  p.push("```");
  p.push("");

  // Evaluation results summary
  p.push(`## Evaluation: ${failures.length} failures, ${successes.length} successes out of ${evalResult.entries.length}`);
  p.push("");

  // Aggregated diagnostics
  if (issueCounts.size > 0) {
    p.push("### Failure Patterns (aggregated)");
    for (const [issue, count] of [...issueCounts.entries()].sort((a, b) => b[1] - a[1])) {
      const ex = issueExamples.get(issue) || [];
      p.push(`- **${issue}** (${count}x): ${ex.join(", ")}`);
    }
    p.push("");
  }

  // Specific failures with context
  p.push("### Example Failures (with context)");
  for (const f of failures.slice(0, 8)) {
    const entry = entryMap.get(f.entryId);
    if (!entry) continue;
    const ctx = entry.context;
    p.push(
      `- project=${ctx.projectName}, branch=${ctx.gitBranch || "N/A"}, request="${(ctx.primaryRequest || "N/A").substring(0, 60)}"`,
    );
    p.push(`  Generated: "${f.title.substring(0, 100)}"`);
    p.push(`  Issues: ${f.issues.join(", ")}`);
  }
  p.push("");

  // Successes to preserve
  if (successes.length > 0) {
    p.push("### Successes (preserve what works)");
    for (const s of successes.slice(0, 5)) {
      const entry = entryMap.get(s.entryId);
      if (!entry) continue;
      p.push(
        `- project=${entry.context.projectName}, request="${(entry.context.primaryRequest || "N/A").substring(0, 50)}" → "${s.title}"`,
      );
    }
    p.push("");
  }

  p.push("## Task");
  p.push("");
  p.push("1. Diagnose what causes the failures (1-2 sentences)");
  p.push("2. Propose targeted changes that fix failures without breaking successes");
  p.push("3. Keep the prompt concise — shorter prompts generalize better");
  p.push("");
  p.push("Output in this exact format:");
  p.push("");
  p.push("DIAGNOSIS: <your diagnosis>");
  p.push("");
  p.push("SYSTEM_PROMPT:");
  p.push("<complete system prompt>");
  p.push("");
  p.push("INSTRUCTIONS:");
  p.push("<complete instruction block>");

  const res = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1500,
    messages: [{ role: "user", content: p.join("\n") }],
  });

  const text = res.content[0];
  if (text.type !== "text") throw new Error("Reflection produced no text");

  const response = text.text;
  const diagnosisMatch = response.match(/DIAGNOSIS:\s*(.*?)(?=\n\s*\nSYSTEM_PROMPT:)/s);
  const systemMatch = response.match(/SYSTEM_PROMPT:\s*\n?(.*?)(?=\n\s*\nINSTRUCTIONS:)/s);
  const instructionsMatch = response.match(/INSTRUCTIONS:\s*\n?([\s\S]*)$/);

  if (!systemMatch || !instructionsMatch) {
    throw new Error("Failed to parse reflection response:\n" + response.substring(0, 300));
  }

  // Strip markdown code fences if the model wrapped them
  const cleanBlock = (s: string) => s.replace(/^```\w*\n?/, "").replace(/\n?```$/, "").trim();

  return {
    id: nextId,
    parentId: candidate.id,
    systemPrompt: cleanBlock(systemMatch[1]),
    instructions: cleanBlock(instructionsMatch[1]),
    generation: candidate.generation + 1,
    diagnosis: diagnosisMatch?.[1]?.trim() || "(no diagnosis)",
  };
}

// --- Pareto-based Candidate Selection (Algorithm 2 from GEPA paper) ---

function selectCandidatePareto(
  candidates: PromptCandidate[],
  evalCache: Map<number, CandidateEval>,
): PromptCandidate {
  if (candidates.length === 1) return candidates[0];

  // Collect all entry IDs from the first eval
  const firstEval = evalCache.values().next().value;
  if (!firstEval) return candidates[0];
  const entryIds = firstEval.entries.map((e: EntryEval) => e.entryId);

  // For each entry, find best score and which candidates achieve it
  const bestPerEntry = new Map<string, { score: number; candidateIds: Set<number> }>();
  for (const entryId of entryIds) {
    let best = -1;
    const winners = new Set<number>();
    for (const [candId, evalR] of evalCache) {
      const entryEval = evalR.entries.find((e) => e.entryId === entryId);
      const score = entryEval?.score ?? 0;
      if (score > best) {
        best = score;
        winners.clear();
        winners.add(candId);
      } else if (score === best) {
        winners.add(candId);
      }
    }
    bestPerEntry.set(entryId, { score: best, candidateIds: winners });
  }

  // Count "wins" per candidate (how many entries they're best at)
  const frequency = new Map<number, number>();
  for (const { candidateIds } of bestPerEntry.values()) {
    for (const id of candidateIds) {
      frequency.set(id, (frequency.get(id) || 0) + 1);
    }
  }

  // Filter to candidates with at least one win
  const eligible = candidates.filter((c) => (frequency.get(c.id) || 0) > 0);
  if (eligible.length === 0) return candidates[candidates.length - 1];

  // Weighted random sample proportional to win frequency
  const totalFreq = eligible.reduce((s, c) => s + (frequency.get(c.id) || 0), 0);
  let r = Math.random() * totalFreq;
  for (const c of eligible) {
    r -= frequency.get(c.id) || 0;
    if (r <= 0) return c;
  }
  return eligible[eligible.length - 1];
}

// --- Report ---

function printReport(
  candidates: PromptCandidate[],
  evalCache: Map<number, CandidateEval>,
  paretoSet: TitleFeedback[],
  best: PromptCandidate,
) {
  console.log("# Prompt Evolution Results (GEPA-inspired)");
  console.log(`Date: ${new Date().toISOString().split("T")[0]}`);
  console.log(`Pareto set: ${paretoSet.length} entries`);
  console.log(`Candidates explored: ${candidates.length}`);
  console.log();

  // Evolution tree
  console.log("## Evolution Tree");
  console.log();
  for (const c of candidates) {
    const evalR = evalCache.get(c.id);
    const marker = c.id === best.id ? " **← BEST**" : "";
    const parent = c.parentId !== null ? `parent=${c.parentId}` : "seed";
    console.log(
      `- **[${c.id}]** gen=${c.generation} ${parent} clean=${((evalR?.cleanRate ?? 0) * 100).toFixed(0)}% avg=${(evalR?.avgScore ?? 0).toFixed(3)}${marker}`,
    );
    console.log(`  ${c.diagnosis}`);
  }
  console.log();

  // Before/after comparison
  const seedEval = evalCache.get(0);
  const bestEval = evalCache.get(best.id);
  if (seedEval && bestEval) {
    console.log("## Improvement");
    console.log();
    console.log(`| Metric | Seed | Best |`);
    console.log(`|--------|------|------|`);
    console.log(
      `| Clean rate | ${(seedEval.cleanRate * 100).toFixed(1)}% | ${(bestEval.cleanRate * 100).toFixed(1)}% |`,
    );
    console.log(
      `| Avg score | ${seedEval.avgScore.toFixed(3)} | ${bestEval.avgScore.toFixed(3)} |`,
    );
    console.log();

    // Show titles that improved
    const improved: { entry: TitleFeedback; before: string; after: string }[] = [];
    for (let i = 0; i < paretoSet.length; i++) {
      const seedEntry = seedEval.entries[i];
      const bestEntry = bestEval.entries[i];
      if (seedEntry && bestEntry && bestEntry.score > seedEntry.score) {
        improved.push({
          entry: paretoSet[i],
          before: seedEntry.title,
          after: bestEntry.title,
        });
      }
    }

    if (improved.length > 0) {
      console.log("### Titles That Improved");
      console.log();
      for (const imp of improved.slice(0, 10)) {
        console.log(`- **${imp.entry.context.projectName}** (${imp.entry.context.gitBranch || "no branch"})`);
        console.log(`  Before: "${imp.before.substring(0, 80)}"`);
        console.log(`  After: "${imp.after}"`);
      }
      console.log();
    }
  }

  // Best prompt
  console.log("## Best Prompt (candidate " + best.id + ")");
  console.log();
  console.log("### System Prompt");
  console.log("```");
  console.log(best.systemPrompt);
  console.log("```");
  console.log();
  console.log("### Instructions");
  console.log("```");
  console.log(best.instructions);
  console.log("```");
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);
  let iterations = 3;
  let paretoSize = 20;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--iterations" && args[i + 1]) {
      iterations = parseInt(args[i + 1]);
      i++;
    }
    if (args[i] === "--pareto-size" && args[i + 1]) {
      paretoSize = parseInt(args[i + 1]);
      i++;
    }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("Error: ANTHROPIC_API_KEY required");
    process.exit(1);
  }

  const client = new Anthropic({ apiKey });

  // Load data
  const entries = loadAndDedup();
  console.error(`Loaded ${entries.length} unique entries`);

  // Select diverse Pareto set
  const paretoSet = selectParetoSet(entries, paretoSize);
  const paretoFails = paretoSet.filter(
    (e) => checkPatterns(e.generatedTitle, e.context).length > 0,
  ).length;
  console.error(`Pareto set: ${paretoSet.length} entries (${paretoFails} originally had issues)`);

  // Initialize
  const seed = seedPrompt();
  const candidates: PromptCandidate[] = [seed];
  const evalCache = new Map<number, CandidateEval>();
  let nextId = 1;

  // Evaluate seed
  console.error("\n--- Baseline: evaluating seed prompt ---");
  const seedEval = await evaluateCandidate(seed, paretoSet, client);
  evalCache.set(seed.id, seedEval);
  console.error(
    `Seed: clean=${(seedEval.cleanRate * 100).toFixed(0)}% avg=${seedEval.avgScore.toFixed(3)}`,
  );

  // Evolution loop
  for (let iter = 0; iter < iterations; iter++) {
    console.error(`\n--- Iteration ${iter + 1}/${iterations} ---`);

    // Select candidate to mutate (Pareto-based)
    const selected = selectCandidatePareto(candidates, evalCache);
    const selectedEval = evalCache.get(selected.id)!;
    console.error(
      `Selected candidate ${selected.id} (gen ${selected.generation}, clean=${(selectedEval.cleanRate * 100).toFixed(0)}%)`,
    );

    // Reflect on failures and propose mutation
    try {
      const mutated = await reflectAndMutate(
        selected,
        paretoSet,
        selectedEval,
        client,
        nextId,
      );
      console.error(`Diagnosis: ${mutated.diagnosis}`);

      // Evaluate mutation on Pareto set
      const mutatedEval = await evaluateCandidate(mutated, paretoSet, client);
      console.error(
        `Result: clean=${(mutatedEval.cleanRate * 100).toFixed(0)}% avg=${mutatedEval.avgScore.toFixed(3)}`,
      );

      // Accept if improved over parent (GEPA: keep if better on minibatch)
      if (mutatedEval.avgScore >= selectedEval.avgScore) {
        console.error(
          `  Accepted (${selectedEval.avgScore.toFixed(3)} → ${mutatedEval.avgScore.toFixed(3)})`,
        );
        candidates.push(mutated);
        evalCache.set(mutated.id, mutatedEval);
        nextId++;
      } else {
        console.error(
          `  Rejected (${selectedEval.avgScore.toFixed(3)} → ${mutatedEval.avgScore.toFixed(3)})`,
        );
        // Still track it for Pareto diversity — it might be best on some entries
        candidates.push(mutated);
        evalCache.set(mutated.id, mutatedEval);
        nextId++;
      }
    } catch (e) {
      console.error(`  Mutation failed: ${e}`);
    }
  }

  // Find best candidate by avg score on Pareto set
  let best = candidates[0];
  let bestScore = 0;
  for (const c of candidates) {
    const avg = evalCache.get(c.id)?.avgScore ?? 0;
    if (avg > bestScore) {
      bestScore = avg;
      best = c;
    }
  }

  // Print report to stdout
  printReport(candidates, evalCache, paretoSet, best);
}

main().catch(console.error);
