/**
 * Resolution detection library for Chronicle.
 * Tracks when pending items have been resolved, using a separate overlay file
 * to maintain immutability of original blocks.
 */
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, existsSync, renameSync } from "fs";
import type { ChronicleBlock, PendingItem, Resolution, ResolvedOverlay } from "./types.ts";

// Re-export types for backward compatibility
export type { Resolution, ResolvedOverlay } from "./types.ts";

const RESOLVED_PATH = `${process.env.HOME}/.claude/chronicle/resolved.json`;

export interface AccomplishedCandidate {
  text: string;
  sessionId: string;
  timestamp: string;
  project: string;
}

export interface ResolutionCheckResult {
  resolved: Resolution[];
  checked: number;
  skipped: number;
}

// Stopwords to filter out during tokenization
const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "must", "shall", "can", "to", "of", "in",
  "for", "on", "with", "at", "by", "from", "as", "into", "through",
  "during", "before", "after", "above", "below", "between", "under",
  "again", "further", "then", "once", "here", "there", "when", "where",
  "why", "how", "all", "each", "few", "more", "most", "other", "some",
  "such", "no", "nor", "not", "only", "own", "same", "so", "than",
  "too", "very", "just", "also", "now", "and", "but", "or", "if",
]);

export function loadResolved(): ResolvedOverlay {
  if (!existsSync(RESOLVED_PATH)) {
    return { version: 1, resolutions: [], lastUpdated: "" };
  }
  try {
    const content = readFileSync(RESOLVED_PATH, "utf-8");
    return JSON.parse(content);
  } catch {
    // Corrupt file - reinitialize
    return { version: 1, resolutions: [], lastUpdated: "" };
  }
}

export function saveResolved(overlay: ResolvedOverlay): void {
  overlay.lastUpdated = new Date().toISOString();
  const tmpPath = `${RESOLVED_PATH}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(overlay, null, 2));
  renameSync(tmpPath, RESOLVED_PATH);
}

export function generatePendingKey(project: string, text: string): string {
  return `${project.toLowerCase()}:${text.toLowerCase().trim()}`;
}

export function isAlreadyResolved(pendingKey: string): boolean {
  const overlay = loadResolved();
  return overlay.resolutions.some(r => r.pendingKey === pendingKey);
}

export function loadResolvedKeys(): Set<string> {
  const overlay = loadResolved();
  return new Set(overlay.resolutions.map(r => r.pendingKey));
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOPWORDS.has(t));
}

export function stem(word: string): string {
  // Simple suffix stripping
  if (word.endsWith("ing") && word.length > 5) {
    return word.slice(0, -3);
  }
  if (word.endsWith("ed") && word.length > 4) {
    return word.slice(0, -2);
  }
  if (word.endsWith("es") && word.length > 4) {
    return word.slice(0, -2);
  }
  if (word.endsWith("s") && word.length > 3 && !word.endsWith("ss")) {
    return word.slice(0, -1);
  }
  if (word.endsWith("ly") && word.length > 4) {
    return word.slice(0, -2);
  }
  return word;
}

export function matchScore(pendingText: string, accomplishedText: string): number {
  const pTokens = tokenize(pendingText).map(stem);
  const aTokens = tokenize(accomplishedText).map(stem);

  if (pTokens.length === 0 || aTokens.length === 0) return 0;

  const pSet = new Set(pTokens);
  const aSet = new Set(aTokens);

  const intersection = [...pSet].filter(t => aSet.has(t)).length;
  const union = new Set([...pSet, ...aSet]).size;

  return union > 0 ? intersection / union : 0;
}

function buildResolutionPrompt(
  pending: PendingItem,
  accomplished: AccomplishedCandidate,
  score: number
): string {
  const scoreLevel = score > 0.5 ? "high" : score > 0.25 ? "medium" : "low";

  return `Does this accomplished item resolve this pending item?

Pending: "${pending.text}" (project: ${pending.project})
Accomplished: "${accomplished.text}" (from session on ${accomplished.timestamp.split("T")[0]})
Keyword overlap: ${scoreLevel} (${(score * 100).toFixed(0)}%)

Consider semantic equivalence, not just keyword match.
An item is resolved if the accomplished work addresses the pending task, even if phrased differently.

Answer with ONLY "YES" or "NO".`;
}

async function callHaikuForResolution(prompt: string): Promise<boolean | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  try {
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 10,
      messages: [{ role: "user", content: prompt }],
    });

    const text = res.content[0];
    if (text.type !== "text") return null;

    const answer = text.text.trim().toUpperCase();
    return answer.startsWith("YES");
  } catch {
    return null;
  }
}

export async function isResolved(
  pending: PendingItem,
  accomplished: AccomplishedCandidate,
  score: number
): Promise<boolean> {
  const prompt = buildResolutionPrompt(pending, accomplished, score);
  const result = await callHaikuForResolution(prompt);
  return result === true;
}

export function getAccomplishedItems(
  blocks: ChronicleBlock[],
  days: number = 7
): AccomplishedCandidate[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const items: AccomplishedCandidate[] = [];

  for (const block of blocks) {
    if (new Date(block.timestamp) < cutoff) continue;

    for (const text of block.accomplished || []) {
      items.push({
        text,
        sessionId: block.sessionId,
        timestamp: block.timestamp,
        project: block.project,
      });
    }
  }

  return items;
}

export async function checkForResolutions(
  pendingItems: PendingItem[],
  accomplishedItems: AccomplishedCandidate[]
): Promise<ResolutionCheckResult> {
  const resolvedKeys = loadResolvedKeys();
  const result: ResolutionCheckResult = {
    resolved: [],
    checked: 0,
    skipped: 0,
  };

  for (const pending of pendingItems) {
    const key = generatePendingKey(pending.project, pending.text);

    // Skip already resolved
    if (resolvedKeys.has(key)) {
      result.skipped++;
      continue;
    }

    // Filter to same project accomplished items
    const projectAccomplished = accomplishedItems.filter(
      a => a.project.toLowerCase() === pending.project.toLowerCase()
    );

    // Score and rank candidates
    const candidates = projectAccomplished
      .map(a => ({ accomplished: a, score: matchScore(pending.text, a.text) }))
      .filter(c => c.score > 0.15) // Min threshold to bother checking
      .sort((a, b) => b.score - a.score)
      .slice(0, 3); // Top 3 candidates

    for (const { accomplished, score } of candidates) {
      result.checked++;

      const resolved = await isResolved(pending, accomplished, score);
      if (resolved) {
        result.resolved.push({
          pendingText: pending.text,
          pendingKey: key,
          resolvedBy: accomplished.text,
          signal: "auto",
          matchScore: score,
          resolvedAt: new Date().toISOString(),
          project: pending.project,
          sessionId: accomplished.sessionId,
          ...(pending.thread && { thread: pending.thread }),
        });
        break; // Found resolution, move to next pending item
      }
    }
  }

  return result;
}
