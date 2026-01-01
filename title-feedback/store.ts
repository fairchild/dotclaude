/**
 * Feedback storage utilities.
 * Manages pending.jsonl and scored.jsonl files.
 */
import { appendFileSync, readFileSync, writeFileSync, existsSync } from "fs";
import type { TitleFeedback } from "./schema.ts";

const FEEDBACK_DIR = `${process.env.HOME}/.claude/title-feedback`;
const PENDING_FILE = `${FEEDBACK_DIR}/pending.jsonl`;
const SCORED_FILE = `${FEEDBACK_DIR}/scored.jsonl`;

/**
 * Save a new feedback entry (pending human scoring).
 */
export function savePendingFeedback(entry: TitleFeedback): void {
  const line = JSON.stringify(entry) + "\n";
  appendFileSync(PENDING_FILE, line);
}

/**
 * Get the most recent pending feedback entry (for /rate-title).
 */
export function getLatestPending(): TitleFeedback | null {
  if (!existsSync(PENDING_FILE)) return null;

  const lines = readFileSync(PENDING_FILE, "utf-8")
    .split("\n")
    .filter(line => line.trim());

  if (lines.length === 0) return null;

  try {
    return JSON.parse(lines[lines.length - 1]);
  } catch {
    return null;
  }
}

/**
 * Get pending entry by ID.
 */
export function getPendingById(id: string): TitleFeedback | null {
  if (!existsSync(PENDING_FILE)) return null;

  const lines = readFileSync(PENDING_FILE, "utf-8")
    .split("\n")
    .filter(line => line.trim());

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as TitleFeedback;
      if (entry.id === id) return entry;
    } catch {}
  }

  return null;
}

/**
 * Mark a pending entry as scored and move to scored.jsonl.
 * Supports both legacy (score only) and new (full assessment) modes.
 */
export function scoreFeedback(
  id: string,
  humanAssessment: {
    score: number;
    reasoning?: string;
    proposedTitle?: string;
    agreedWithJudge: boolean;
  },
  judgeAssessment?: {
    score: number;
    reasoning: string;
    proposedTitle: string;
    judgePromptVersion: string;
  }
): boolean {
  if (!existsSync(PENDING_FILE)) return false;

  const lines = readFileSync(PENDING_FILE, "utf-8")
    .split("\n")
    .filter(line => line.trim());

  const remaining: string[] = [];
  let found: TitleFeedback | null = null;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as TitleFeedback;
      if (entry.id === id) {
        found = entry;
      } else {
        remaining.push(line);
      }
    } catch {
      remaining.push(line);
    }
  }

  if (!found) return false;

  // Add assessments
  found.humanAssessment = humanAssessment;
  if (judgeAssessment) {
    found.judgeAssessment = judgeAssessment;
  }

  // Legacy fields for backward compatibility
  found.humanScore = humanAssessment.score;
  if (humanAssessment.proposedTitle) {
    found.idealTitle = humanAssessment.proposedTitle;
  }

  // Move to scored file
  appendFileSync(SCORED_FILE, JSON.stringify(found) + "\n");

  // Rewrite pending without this entry
  writeFileSync(PENDING_FILE, remaining.join("\n") + (remaining.length ? "\n" : ""));

  return true;
}

/**
 * Get all entries where human disagreed with judge (for analysis).
 */
export function getDisagreements(): TitleFeedback[] {
  return getAllScored().filter(
    entry => entry.humanAssessment && !entry.humanAssessment.agreedWithJudge
  );
}

/**
 * Get all scored entries (for analysis/training).
 */
export function getAllScored(): TitleFeedback[] {
  if (!existsSync(SCORED_FILE)) return [];

  const lines = readFileSync(SCORED_FILE, "utf-8")
    .split("\n")
    .filter(line => line.trim());

  const entries: TitleFeedback[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {}
  }

  return entries;
}

/**
 * Get count of pending and scored entries.
 */
export function getStats(): { pending: number; scored: number } {
  let pending = 0;
  let scored = 0;

  if (existsSync(PENDING_FILE)) {
    pending = readFileSync(PENDING_FILE, "utf-8")
      .split("\n")
      .filter(line => line.trim()).length;
  }

  if (existsSync(SCORED_FILE)) {
    scored = readFileSync(SCORED_FILE, "utf-8")
      .split("\n")
      .filter(line => line.trim()).length;
  }

  return { pending, scored };
}
