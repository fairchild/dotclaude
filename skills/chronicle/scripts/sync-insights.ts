/**
 * Sync Insights - Hybrid insight generation for Chronicle sync UX.
 *
 * Lightweight stats: Updated on block extraction, always available.
 * Deep analysis: Generated on-demand or scheduled.
 *
 * Usage:
 *   bun skills/chronicle/scripts/sync-insights.ts --update    # Update lightweight stats
 *   bun skills/chronicle/scripts/sync-insights.ts --preview   # Show current insights
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { loadAllBlocks, type ChronicleBlock, getTopFiles } from "./queries";

const CHRONICLE_DIR = `${process.env.HOME}/.claude/chronicle`;
const INSIGHTS_DIR = `${CHRONICLE_DIR}/insights`;
const LIGHTWEIGHT_STATS_FILE = `${INSIGHTS_DIR}/lightweight-stats.json`;

export interface ThreadDuration {
  key: string;
  text: string;
  project: string;
  branch: string | null;
  firstSeen: string;
  lastSeen: string;
  daysActive: number;
  occurrences: number;
  resolved: boolean;
}

export interface HotFile {
  file: string;
  count: number;
  projects: string[];
  lastModified: string;
}

export interface RecurringPending {
  text: string;
  normalizedText: string;
  count: number;
  projects: string[];
  firstSeen: string;
  lastSeen: string;
}

export interface LightweightStats {
  updatedAt: string;
  blockCount: number;
  projectCount: number;
  threadDurations: ThreadDuration[];
  hotFiles: HotFile[];
  recurringPending: RecurringPending[];
  crossProjectFiles: { file: string; projects: string[] }[];
}

export interface ContinuityInsight {
  type: "thread_duration" | "resolution" | "stalled" | "pattern";
  title: string;
  detail: string;
  project: string;
  daysActive?: number;
  evidence?: string[];
}

export interface TechnicalPattern {
  type: "hot_file" | "tech_debt" | "cross_project";
  file?: string;
  pattern: string;
  frequency: number;
  projects?: string[];
}

export interface SyncInsights {
  continuity: ContinuityInsight[];
  technical: TechnicalPattern[];
  crossProject: { projects: string[]; sharedFiles: string[]; description: string }[];
}

function ensureInsightsDir(): void {
  if (!existsSync(INSIGHTS_DIR)) {
    mkdirSync(INSIGHTS_DIR, { recursive: true });
  }
}

function normalizeText(text: string): string {
  return text.toLowerCase().trim().replace(/[^\w\s]/g, "");
}

function computeThreadDurations(blocks: ChronicleBlock[]): ThreadDuration[] {
  const threadMap = new Map<string, {
    text: string;
    project: string;
    branch: string | null;
    firstSeen: Date;
    lastSeen: Date;
    occurrences: number;
  }>();

  // Track accomplished items for resolution detection
  const accomplishedTexts = new Set<string>();
  for (const block of blocks) {
    for (const acc of block.accomplished) {
      accomplishedTexts.add(normalizeText(acc));
    }
  }

  for (const block of blocks) {
    for (const pending of block.pending) {
      const normalized = normalizeText(pending);
      const key = `${block.project}:${normalized}`;
      const blockDate = new Date(block.timestamp);

      const existing = threadMap.get(key);
      if (existing) {
        existing.occurrences++;
        if (blockDate < existing.firstSeen) existing.firstSeen = blockDate;
        if (blockDate > existing.lastSeen) existing.lastSeen = blockDate;
      } else {
        threadMap.set(key, {
          text: pending,
          project: block.project,
          branch: block.branch,
          firstSeen: blockDate,
          lastSeen: blockDate,
          occurrences: 1,
        });
      }
    }
  }

  const now = new Date();
  return Array.from(threadMap.entries())
    .map(([key, t]) => {
      const normalized = normalizeText(t.text);
      const resolved = accomplishedTexts.has(normalized) ||
        Array.from(accomplishedTexts).some(acc =>
          acc.includes(normalized) || normalized.includes(acc)
        );

      return {
        key,
        text: t.text,
        project: t.project,
        branch: t.branch,
        firstSeen: t.firstSeen.toISOString(),
        lastSeen: t.lastSeen.toISOString(),
        daysActive: Math.ceil((now.getTime() - t.firstSeen.getTime()) / (1000 * 60 * 60 * 24)),
        occurrences: t.occurrences,
        resolved,
      };
    })
    .sort((a, b) => b.daysActive - a.daysActive);
}

function computeHotFiles(blocks: ChronicleBlock[]): HotFile[] {
  const fileMap = new Map<string, {
    count: number;
    projects: Set<string>;
    lastModified: Date;
  }>();

  for (const block of blocks) {
    const blockDate = new Date(block.timestamp);
    for (const file of block.filesModified ?? []) {
      const existing = fileMap.get(file);
      if (existing) {
        existing.count++;
        existing.projects.add(block.project);
        if (blockDate > existing.lastModified) {
          existing.lastModified = blockDate;
        }
      } else {
        fileMap.set(file, {
          count: 1,
          projects: new Set([block.project]),
          lastModified: blockDate,
        });
      }
    }
  }

  return Array.from(fileMap.entries())
    .map(([file, data]) => ({
      file,
      count: data.count,
      projects: Array.from(data.projects),
      lastModified: data.lastModified.toISOString(),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
}

function computeRecurringPending(blocks: ChronicleBlock[]): RecurringPending[] {
  const pendingMap = new Map<string, {
    text: string;
    count: number;
    projects: Set<string>;
    firstSeen: Date;
    lastSeen: Date;
  }>();

  for (const block of blocks) {
    const blockDate = new Date(block.timestamp);
    for (const pending of block.pending) {
      const normalized = normalizeText(pending);

      const existing = pendingMap.get(normalized);
      if (existing) {
        existing.count++;
        existing.projects.add(block.project);
        if (blockDate < existing.firstSeen) existing.firstSeen = blockDate;
        if (blockDate > existing.lastSeen) existing.lastSeen = blockDate;
      } else {
        pendingMap.set(normalized, {
          text: pending,
          count: 1,
          projects: new Set([block.project]),
          firstSeen: blockDate,
          lastSeen: blockDate,
        });
      }
    }
  }

  return Array.from(pendingMap.entries())
    .filter(([_, data]) => data.count > 1) // Only recurring
    .map(([normalized, data]) => ({
      text: data.text,
      normalizedText: normalized,
      count: data.count,
      projects: Array.from(data.projects),
      firstSeen: data.firstSeen.toISOString(),
      lastSeen: data.lastSeen.toISOString(),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

function computeCrossProjectFiles(blocks: ChronicleBlock[]): { file: string; projects: string[] }[] {
  const fileProjects = new Map<string, Set<string>>();

  for (const block of blocks) {
    for (const file of block.filesModified ?? []) {
      const existing = fileProjects.get(file);
      if (existing) {
        existing.add(block.project);
      } else {
        fileProjects.set(file, new Set([block.project]));
      }
    }
  }

  return Array.from(fileProjects.entries())
    .filter(([_, projects]) => projects.size > 1)
    .map(([file, projects]) => ({
      file,
      projects: Array.from(projects),
    }))
    .sort((a, b) => b.projects.length - a.projects.length)
    .slice(0, 10);
}

export function computeLightweightStats(): LightweightStats {
  const blocks = loadAllBlocks();
  const projects = new Set(blocks.map(b => b.project));

  return {
    updatedAt: new Date().toISOString(),
    blockCount: blocks.length,
    projectCount: projects.size,
    threadDurations: computeThreadDurations(blocks),
    hotFiles: computeHotFiles(blocks),
    recurringPending: computeRecurringPending(blocks),
    crossProjectFiles: computeCrossProjectFiles(blocks),
  };
}

export function saveLightweightStats(stats: LightweightStats): void {
  ensureInsightsDir();
  writeFileSync(LIGHTWEIGHT_STATS_FILE, JSON.stringify(stats, null, 2));
}

export function loadLightweightStats(): LightweightStats | null {
  if (!existsSync(LIGHTWEIGHT_STATS_FILE)) return null;

  try {
    return JSON.parse(readFileSync(LIGHTWEIGHT_STATS_FILE, "utf-8"));
  } catch {
    return null;
  }
}

export function generateSyncInsights(stats?: LightweightStats): SyncInsights {
  const s = stats ?? loadLightweightStats() ?? computeLightweightStats();

  const continuity: ContinuityInsight[] = [];
  const technical: TechnicalPattern[] = [];
  const crossProject: { projects: string[]; sharedFiles: string[]; description: string }[] = [];

  // Continuity insights from thread durations
  for (const thread of s.threadDurations.filter(t => !t.resolved).slice(0, 5)) {
    if (thread.daysActive > 7) {
      continuity.push({
        type: "stalled",
        title: `"${thread.text.slice(0, 40)}${thread.text.length > 40 ? "..." : ""}" stalled`,
        detail: `Blocked for ${thread.daysActive} days in ${thread.project}`,
        project: thread.project,
        daysActive: thread.daysActive,
      });
    } else if (thread.occurrences > 2) {
      continuity.push({
        type: "thread_duration",
        title: `${thread.project} work spans ${thread.occurrences} sessions`,
        detail: thread.text,
        project: thread.project,
        daysActive: thread.daysActive,
      });
    }
  }

  // Resolution insights
  const recentlyResolved = s.threadDurations
    .filter(t => t.resolved && t.daysActive > 3)
    .slice(0, 3);

  for (const thread of recentlyResolved) {
    continuity.push({
      type: "resolution",
      title: `Resolved after ${thread.daysActive} days`,
      detail: thread.text,
      project: thread.project,
    });
  }

  // Technical patterns from hot files
  for (const file of s.hotFiles.slice(0, 5)) {
    if (file.count > 5) {
      technical.push({
        type: "hot_file",
        file: file.file,
        pattern: `Modified ${file.count} times across ${file.projects.length} project(s)`,
        frequency: file.count,
        projects: file.projects,
      });
    }
  }

  // Recurring pending as potential tech debt
  for (const pending of s.recurringPending.slice(0, 3)) {
    if (pending.count > 3) {
      technical.push({
        type: "tech_debt",
        pattern: `"${pending.text}" appears ${pending.count} times`,
        frequency: pending.count,
        projects: pending.projects,
      });
    }
  }

  // Cross-project connections
  const projectGroups = new Map<string, string[]>();
  for (const { file, projects } of s.crossProjectFiles) {
    const key = projects.sort().join(",");
    const existing = projectGroups.get(key);
    if (existing) {
      existing.push(file);
    } else {
      projectGroups.set(key, [file]);
    }
  }

  for (const [projectKey, files] of projectGroups) {
    const projects = projectKey.split(",");
    if (files.length >= 2) {
      crossProject.push({
        projects,
        sharedFiles: files.slice(0, 5),
        description: `${files.length} shared files between ${projects.join(" and ")}`,
      });
    }
  }

  return { continuity, technical, crossProject };
}

export function getSyncHistory(): { date: string; sessions: number; insights: string[] }[] {
  // Read sync timestamps from blocks grouped by date
  const blocks = loadAllBlocks();
  const byDate = new Map<string, ChronicleBlock[]>();

  for (const block of blocks) {
    const date = block.timestamp.split("T")[0];
    const existing = byDate.get(date);
    if (existing) {
      existing.push(block);
    } else {
      byDate.set(date, [block]);
    }
  }

  return Array.from(byDate.entries())
    .map(([date, blocks]) => {
      const insights: string[] = [];

      const pending = blocks.flatMap(b => b.pending);
      const accomplished = blocks.flatMap(b => b.accomplished);

      if (pending.length > 0) {
        insights.push(`${pending.length} pending items`);
      }
      if (accomplished.length > 5) {
        insights.push(`${accomplished.length} accomplishments`);
      }

      return {
        date,
        sessions: blocks.length,
        insights,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10);
}

// CLI entry point
if (import.meta.main) {
  const args = process.argv.slice(2);

  if (args.includes("--update")) {
    console.log("Computing lightweight stats...");
    const stats = computeLightweightStats();
    saveLightweightStats(stats);
    console.log(`Updated: ${stats.blockCount} blocks, ${stats.projectCount} projects`);
    console.log(`Threads: ${stats.threadDurations.length}, Hot files: ${stats.hotFiles.length}`);
    console.log(`Saved to ${LIGHTWEIGHT_STATS_FILE}`);
  } else if (args.includes("--preview")) {
    const stats = loadLightweightStats();
    if (!stats) {
      console.log("No stats found. Run with --update first.");
      process.exit(1);
    }

    const insights = generateSyncInsights(stats);

    console.log("\n=== CONTINUITY INSIGHTS ===");
    for (const i of insights.continuity) {
      console.log(`[${i.type}] ${i.title}`);
      console.log(`  ${i.detail}`);
    }

    console.log("\n=== TECHNICAL PATTERNS ===");
    for (const t of insights.technical) {
      console.log(`[${t.type}] ${t.pattern}`);
      if (t.file) console.log(`  File: ${t.file}`);
    }

    console.log("\n=== CROSS-PROJECT ===");
    for (const c of insights.crossProject) {
      console.log(`${c.description}`);
      console.log(`  Files: ${c.sharedFiles.join(", ")}`);
    }
  } else {
    console.log("Usage:");
    console.log("  bun sync-insights.ts --update   Update lightweight stats");
    console.log("  bun sync-insights.ts --preview  Show current insights");
  }
}
