/**
 * Shared query utilities for Chronicle data.
 * Used by both the digest generator and web dashboard.
 */
import { readdirSync, readFileSync, existsSync } from "fs";
import type { ChronicleBlock, PendingItem, PendingItemWithAge, Resolution } from "./types.ts";
import { loadResolved, loadResolvedKeys, generatePendingKey } from "./resolve-lib.ts";

// Re-export types for backward compatibility
export type { ChronicleBlock, PendingItem, PendingItemWithAge } from "./types.ts";

const CHRONICLE_DIR = `${process.env.HOME}/.claude/chronicle/blocks`;

export interface ProjectStats {
  project: string;
  sessionCount: number;
  totalMessages: number;
  filesModified: string[];
  accomplishedCount: number;
  pendingCount: number;
  branches: string[];
  firstSession: string;
  lastSession: string;
}

export interface DateRange {
  start: Date;
  end: Date;
}

/**
 * Load all Chronicle blocks from disk.
 */
export function loadAllBlocks(): ChronicleBlock[] {
  if (!existsSync(CHRONICLE_DIR)) return [];

  const files = readdirSync(CHRONICLE_DIR).filter((f) => f.endsWith(".json"));
  const blocks: ChronicleBlock[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(`${CHRONICLE_DIR}/${file}`, "utf-8");
      blocks.push(JSON.parse(content));
    } catch {
      // Skip malformed files
    }
  }

  return blocks.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

/**
 * Get blocks within a date range.
 */
export function getBlocksInRange(range: DateRange): ChronicleBlock[] {
  const all = loadAllBlocks();
  return all.filter((block) => {
    const ts = new Date(block.timestamp);
    return ts >= range.start && ts <= range.end;
  });
}

/**
 * Get blocks for a specific project.
 */
export function getBlocksByProject(project: string): ChronicleBlock[] {
  const all = loadAllBlocks();
  return all.filter(
    (block) => block.project.toLowerCase() === project.toLowerCase()
  );
}

/**
 * Get all pending items across all blocks.
 * @param includeResolved - If true, includes resolved items (default: false)
 */
export function getPendingItems(includeResolved = false): PendingItem[] {
  const blocks = loadAllBlocks();
  const resolvedKeys = includeResolved ? new Set<string>() : loadResolvedKeys();
  const items: PendingItem[] = [];

  for (const block of blocks) {
    for (const text of block.pending) {
      const key = generatePendingKey(block.project, text);
      if (!resolvedKeys.has(key)) {
        items.push({
          text,
          project: block.project,
          sessionId: block.sessionId,
          timestamp: block.timestamp,
          branch: block.branch,
        });
      }
    }
  }

  return items;
}

export const STALE_THRESHOLD_DAYS = 14;

/**
 * Get pending items with age tracking.
 * @param includeResolved - If true, includes resolved items (default: false)
 */
export function getPendingWithAge(includeResolved = false): PendingItemWithAge[] {
  const blocks = loadAllBlocks();
  const resolvedKeys = includeResolved ? new Set<string>() : loadResolvedKeys();
  const seen = new Map<string, PendingItemWithAge>();
  const now = new Date();

  for (const block of [...blocks].reverse()) {
    for (const text of block.pending) {
      // Key includes project to avoid cross-project deduplication
      const key = generatePendingKey(block.project, text);
      if (resolvedKeys.has(key)) continue;
      if (!seen.has(key)) {
        const firstSeen = new Date(block.timestamp);
        const ageInDays = Math.floor(
          (now.getTime() - firstSeen.getTime()) / (1000 * 60 * 60 * 24)
        );
        seen.set(key, {
          text,
          project: block.project,
          sessionId: block.sessionId,
          timestamp: block.timestamp,
          branch: block.branch,
          firstSeen,
          ageInDays,
          isStale: ageInDays > STALE_THRESHOLD_DAYS,
        });
      }
    }
  }

  return Array.from(seen.values()).sort((a, b) => b.ageInDays - a.ageInDays);
}

/**
 * Get all resolved items.
 */
export function getResolvedItems(): Resolution[] {
  const overlay = loadResolved();
  return overlay.resolutions.sort(
    (a, b) => new Date(b.resolvedAt).getTime() - new Date(a.resolvedAt).getTime()
  );
}

/**
 * Get aggregate stats per project.
 */
export function getProjectStats(): ProjectStats[] {
  const blocks = loadAllBlocks();
  const statsMap = new Map<string, ProjectStats>();

  for (const block of blocks) {
    const existing = statsMap.get(block.project);

    if (existing) {
      existing.sessionCount++;
      existing.totalMessages += block.messageCount ?? 0;
      existing.accomplishedCount += block.accomplished.length;
      existing.pendingCount += block.pending.length;

      if (block.filesModified) {
        for (const f of block.filesModified) {
          if (!existing.filesModified.includes(f)) {
            existing.filesModified.push(f);
          }
        }
      }
      if (block.branch && !existing.branches.includes(block.branch)) {
        existing.branches.push(block.branch);
      }
      if (block.timestamp < existing.firstSession) {
        existing.firstSession = block.timestamp;
      }
      if (block.timestamp > existing.lastSession) {
        existing.lastSession = block.timestamp;
      }
    } else {
      statsMap.set(block.project, {
        project: block.project,
        sessionCount: 1,
        totalMessages: block.messageCount ?? 0,
        filesModified: block.filesModified ? [...block.filesModified] : [],
        accomplishedCount: block.accomplished.length,
        pendingCount: block.pending.length,
        branches: block.branch ? [block.branch] : [],
        firstSession: block.timestamp,
        lastSession: block.timestamp,
      });
    }
  }

  return Array.from(statsMap.values()).sort(
    (a, b) => b.sessionCount - a.sessionCount
  );
}

/**
 * Search blocks by text query (summary, accomplished, pending).
 */
export function searchBlocks(query: string): ChronicleBlock[] {
  const blocks = loadAllBlocks();
  const lower = query.toLowerCase();

  return blocks.filter((block) => {
    if (block.summary.toLowerCase().includes(lower)) return true;
    if (block.accomplished.some((a) => a.toLowerCase().includes(lower)))
      return true;
    if (block.pending.some((p) => p.toLowerCase().includes(lower))) return true;
    if (block.project.toLowerCase().includes(lower)) return true;
    if (block.branch?.toLowerCase().includes(lower)) return true;
    return false;
  });
}

/**
 * Get unique projects from all blocks.
 */
export function getProjects(): string[] {
  const blocks = loadAllBlocks();
  const projects = new Set<string>();
  for (const block of blocks) {
    projects.add(block.project);
  }
  return Array.from(projects).sort();
}

/**
 * Get most frequently modified files across all sessions.
 */
export function getTopFiles(
  limit = 10
): { file: string; count: number; projects: string[] }[] {
  const blocks = loadAllBlocks();
  const fileStats = new Map<string, { count: number; projects: Set<string> }>();

  for (const block of blocks) {
    for (const file of block.filesModified ?? []) {
      const existing = fileStats.get(file);
      if (existing) {
        existing.count++;
        existing.projects.add(block.project);
      } else {
        fileStats.set(file, { count: 1, projects: new Set([block.project]) });
      }
    }
  }

  return Array.from(fileStats.entries())
    .map(([file, stats]) => ({
      file,
      count: stats.count,
      projects: Array.from(stats.projects),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/**
 * Get date range helpers.
 */
export function getDateRanges() {
  const now = new Date();

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  return {
    daily: { start: startOfToday, end: now },
    weekly: { start: startOfWeek, end: now },
    monthly: { start: startOfMonth, end: now },
    last7Days: {
      start: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
      end: now,
    },
    last30Days: {
      start: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      end: now,
    },
  };
}

/**
 * Get ISO week number for a date.
 */
export function getISOWeek(date: Date): { year: number; week: number } {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
  );
  return { year: d.getFullYear(), week };
}

/**
 * Format a date range for display.
 */
export function formatDateRange(range: DateRange): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(range.start)} - ${fmt(range.end)}`;
}

/**
 * Group blocks by date (YYYY-MM-DD).
 */
export function groupByDate(
  blocks: ChronicleBlock[]
): Map<string, ChronicleBlock[]> {
  const groups = new Map<string, ChronicleBlock[]>();

  for (const block of blocks) {
    const date = block.timestamp.split("T")[0];
    const existing = groups.get(date);
    if (existing) {
      existing.push(block);
    } else {
      groups.set(date, [block]);
    }
  }

  return groups;
}

/**
 * Group blocks by project.
 */
export function groupByProject(
  blocks: ChronicleBlock[]
): Map<string, ChronicleBlock[]> {
  const groups = new Map<string, ChronicleBlock[]>();

  for (const block of blocks) {
    const existing = groups.get(block.project);
    if (existing) {
      existing.push(block);
    } else {
      groups.set(block.project, [block]);
    }
  }

  return groups;
}
