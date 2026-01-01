/**
 * Schema for title feedback collection.
 * Used to build a golden dataset for DSPy optimization.
 *
 * We capture both AI (judge) and human ratings to train:
 * 1. The judge prompt (learns to rate like the human)
 * 2. The journalist prompt (learns to generate titles humans rate highly)
 */

import type { SessionContext } from "../scripts/generate-session-title-testable.ts";

export const PROMPT_VERSION = "v1.0";
export const MODEL_USED = "claude-3-5-haiku-20241022";
export const JUDGE_PROMPT_VERSION = "v1.0";

/**
 * AI judge assessment of a title.
 */
export interface JudgeAssessment {
  score: number;              // 1-5 rating
  reasoning: string;          // Why this score
  proposedTitle: string;      // What the judge thinks would be better
  judgePromptVersion: string; // For tracking prompt evolution
}

/**
 * Human assessment of a title.
 */
export interface HumanAssessment {
  score: number;              // 1-5 rating
  reasoning?: string;         // Why they agree/disagree with judge
  proposedTitle?: string;     // Their better title (if any)
  agreedWithJudge: boolean;   // Quick signal for analysis
}

/**
 * Feedback entry for a generated session title.
 * Captures the full context + both AI and human perspectives.
 */
export interface TitleFeedback {
  // Identity
  id: string;           // Hash of session ID + project
  timestamp: string;    // ISO date

  // Input context (what was extracted from session)
  context: {
    projectName: string;
    gitBranch: string | null;
    primaryRequest: string | null;
    latestActivity: string | null;
    modifiedFiles: string[];
    messageCount: number;
    explicitSummary: string | null;
  };

  // Output (what was generated)
  generatedTitle: string;

  // AI Judge assessment (filled during /rate-title)
  judgeAssessment?: JudgeAssessment;

  // Human assessment (filled during /rate-title)
  humanAssessment?: HumanAssessment;

  // Legacy fields for backward compatibility
  humanScore?: number;        // Deprecated: use humanAssessment.score
  idealTitle?: string;        // Deprecated: use humanAssessment.proposedTitle

  // Metadata for analysis
  promptVersion: string;      // Title generation prompt version
  modelUsed: string;          // "haiku-3.5" etc.
}

/**
 * Create a TitleFeedback entry from session context.
 */
export function createFeedbackEntry(
  sessionId: string,
  projectName: string,
  ctx: SessionContext,
  generatedTitle: string
): TitleFeedback {
  // Simple hash for ID
  const id = hashString(`${sessionId}:${projectName}`);

  return {
    id,
    timestamp: new Date().toISOString(),
    context: {
      projectName: ctx.projectName,
      gitBranch: ctx.gitBranch,
      primaryRequest: ctx.primaryRequest,
      latestActivity: ctx.latestActivity,
      modifiedFiles: ctx.modifiedFiles.slice(0, 10),
      messageCount: ctx.messageCount,
      explicitSummary: ctx.explicitSummary,
    },
    generatedTitle,
    promptVersion: PROMPT_VERSION,
    modelUsed: MODEL_USED,
  };
}

/**
 * Simple string hash for ID generation.
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}
