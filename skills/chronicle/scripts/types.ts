/**
 * Shared types for Chronicle scripts.
 * Extracted to avoid circular imports between queries.ts and resolve-lib.ts.
 */

export interface ChronicleBlock {
  timestamp: string;
  sessionId: string;
  project: string;
  worktree?: string;
  branch: string | null;
  summary: string;
  accomplished: string[];
  pending: string[];
  filesModified?: string[];
  messageCount?: number;
  // Extended fields (manual/curator blocks)
  goal?: string;
  challenges?: string[];
  nextSteps?: string[];
  notes?: string;
  relatedSessions?: string[];
}

export interface PendingItem {
  text: string;
  project: string;
  sessionId: string;
  timestamp: string;
  branch: string | null;
}

export interface PendingItemWithAge extends PendingItem {
  firstSeen: Date;
  ageInDays: number;
  isStale: boolean;
}

export interface Resolution {
  pendingText: string;
  pendingKey: string;
  resolvedBy: string;
  signal: "auto" | "explicit";
  matchScore: number;
  resolvedAt: string;
  project: string;
  sessionId?: string;
}

export interface ResolvedOverlay {
  version: 1;
  resolutions: Resolution[];
  lastUpdated: string;
}
