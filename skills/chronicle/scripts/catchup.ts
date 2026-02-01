#!/usr/bin/env bun
/**
 * Chronicle Catchup - Quick context restoration for current project.
 *
 * Shows last session's work and aggregated pending items to help
 * restore context when returning to a project.
 *
 * Usage:
 *   bun catchup.ts              # Detect project from cwd
 *   bun catchup.ts --days=30    # Look back 30 days instead of 7
 */
import {
  loadAllBlocks,
  getPendingItems,
  STALE_THRESHOLD_DAYS,
  type ChronicleBlock,
  type PendingItem,
} from "./queries.ts";
import {
  getAccomplishedItems,
  loadResolved,
  loadResolvedKeys,
  saveResolved,
  generatePendingKey,
  matchScore,
  type Resolution,
  type AccomplishedCandidate,
} from "./resolve-lib.ts";
import { detectContext, type Context } from "./context.ts";

interface AggregatedPending {
  text: string;
  project: string;
  firstSeen: Date;
  ageInDays: number;
  isStale: boolean;
  resolution?: Resolution;
  thread?: string;
}

interface ResolutionCandidate {
  pending: { text: string; project: string };
  accomplished: { text: string; timestamp: string };
  score: number;
}

interface Patterns {
  sessionCount: number;
  focusAreas: Map<string, number>;
}

function filterByProject(blocks: ChronicleBlock[], project: string): ChronicleBlock[] {
  return blocks.filter(b => b.project.toLowerCase() === project.toLowerCase());
}

function filterByWorktree(blocks: ChronicleBlock[], worktree: string | null): ChronicleBlock[] {
  if (!worktree) return blocks;
  return blocks.filter(b => b.worktree === worktree);
}

function filterByDateRange(blocks: ChronicleBlock[], days: number): ChronicleBlock[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return blocks.filter(b => new Date(b.timestamp) >= cutoff);
}

function getLastSession(blocks: ChronicleBlock[]): ChronicleBlock | null {
  return blocks.length > 0 ? blocks[0] : null;
}

function aggregatePending(blocks: ChronicleBlock[]): AggregatedPending[] {
  const overlay = loadResolved();
  const resolvedMap = new Map(
    overlay.resolutions.map(r => [r.pendingKey, r])
  );
  const seen = new Map<string, AggregatedPending>();
  const now = new Date();

  // Helper to find thread for a pending item across all blocks
  const getThread = (text: string, project: string): string | undefined => {
    for (const b of blocks) {
      if (b.project.toLowerCase() !== project.toLowerCase()) continue;
      const thread = b.pendingThreads?.[text];
      if (thread) return thread;
    }
    return undefined;
  };

  for (const block of [...blocks].reverse()) {
    for (const text of block.pending || []) {
      const key = generatePendingKey(block.project, text);
      if (!seen.has(key)) {
        const firstSeen = new Date(block.timestamp);
        const ageInDays = Math.floor((now.getTime() - firstSeen.getTime()) / (1000 * 60 * 60 * 24));
        const thread = block.pendingThreads?.[text] ?? getThread(text, block.project);
        seen.set(key, {
          text,
          project: block.project,
          firstSeen,
          ageInDays,
          isStale: ageInDays > STALE_THRESHOLD_DAYS,
          resolution: resolvedMap.get(key),
          ...(thread && { thread }),
        });
      }
    }
  }

  return Array.from(seen.values()).sort((a, b) => b.ageInDays - a.ageInDays);
}

function detectPatterns(blocks: ChronicleBlock[]): Patterns {
  const focusAreas = new Map<string, number>();

  for (const block of blocks) {
    for (const item of block.accomplished || []) {
      const lower = item.toLowerCase();
      if (lower.includes("test")) increment(focusAreas, "testing");
      else if (lower.includes("doc") || lower.includes("readme")) increment(focusAreas, "docs");
      else if (lower.includes("fix") || lower.includes("bug")) increment(focusAreas, "bugfix");
      else if (lower.includes("refactor")) increment(focusAreas, "refactor");
      else if (lower.includes("ui") || lower.includes("dashboard") || lower.includes("style")) increment(focusAreas, "ui");
      else if (lower.includes("api") || lower.includes("endpoint")) increment(focusAreas, "api");
      else increment(focusAreas, "feature");
    }
  }

  return { sessionCount: blocks.length, focusAreas };
}

function increment(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function formatAge(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 60) return `${diffMins} minutes ago`;
  if (diffHours < 24) return `${diffHours} hours ago`;
  if (diffDays === 1) return "yesterday";
  return `${diffDays} days ago`;
}

function formatCatchup(
  ctx: Context,
  lastSession: ChronicleBlock | null,
  pending: AggregatedPending[],
  patterns: Patterns,
  days: number,
  newResolutions: Resolution[] = []
): string {
  const lines: string[] = [];

  lines.push(`📍 ${ctx.project}${ctx.branch ? ` on branch ${ctx.branch}` : ""}`);
  if (ctx.worktree) lines.push(`   worktree: ${ctx.worktree}`);
  lines.push("");

  if (lastSession) {
    const timeAgo = formatTimeAgo(new Date(lastSession.timestamp));
    lines.push(`Last session (${timeAgo}):`);
    lines.push(`• ${lastSession.summary}`);

    if (lastSession.accomplished && lastSession.accomplished.length > 0) {
      lines.push("");
      lines.push("Accomplished:");
      for (const item of lastSession.accomplished.slice(0, 5)) {
        lines.push(`  ✓ ${item}`);
      }
    }

    if (lastSession.pending && lastSession.pending.length > 0) {
      lines.push("");
      lines.push("Left pending:");
      for (const item of lastSession.pending.slice(0, 3)) {
        lines.push(`  • ${item}`);
      }
    }
  } else {
    lines.push(`No recent sessions found for this worktree.`);
    lines.push(`(Showing project-wide pending items below)`);
  }

  // Separate resolved from unresolved
  const unresolvedPending = pending.filter(p => !p.resolution);
  const resolvedPending = pending.filter(p => p.resolution);

  if (unresolvedPending.length > 0) {
    const staleCount = unresolvedPending.filter(p => p.isStale).length;
    lines.push("");
    lines.push(`Pending work (project-wide, last ${days} days):`);

    // Sort by thread (grouped) then by age
    const sorted = [...unresolvedPending].sort((a, b) => {
      if (a.thread && b.thread) return a.thread.localeCompare(b.thread);
      if (a.thread) return -1;
      if (b.thread) return 1;
      return b.ageInDays - a.ageInDays;
    });

    for (const item of sorted.slice(0, 8)) {
      const marker = item.isStale ? "⚠️" : "[ ]";
      const threadPrefix = item.thread ? `[${item.thread}] ` : "";
      lines.push(`  ${marker} ${threadPrefix}${item.text} (${formatAge(item.ageInDays)})`);
    }
    if (unresolvedPending.length > 8) {
      lines.push(`  ... and ${unresolvedPending.length - 8} more`);
    }
    if (staleCount > 0) {
      lines.push("");
      lines.push(`⚠️  ${staleCount} stale item${staleCount > 1 ? "s" : ""} (>14 days) - run /chronicle stale for details`);
    }
  }

  // Show recently resolved items
  if (resolvedPending.length > 0) {
    lines.push("");
    lines.push("Recently resolved:");
    for (const item of resolvedPending.slice(0, 5)) {
      const evidence = item.resolution!.resolvedBy.substring(0, 50);
      const suffix = item.resolution!.resolvedBy.length > 50 ? "..." : "";
      lines.push(`  ✓ ${item.text}`);
      lines.push(`    → ${evidence}${suffix}`);
    }
    if (resolvedPending.length > 5) {
      lines.push(`  ... and ${resolvedPending.length - 5} more resolved`);
    }
  }

  // Highlight new resolutions detected this catchup
  if (newResolutions.length > 0) {
    lines.push("");
    lines.push(`💡 Auto-detected ${newResolutions.length} resolution${newResolutions.length > 1 ? "s" : ""} just now`);
  }

  if (patterns.sessionCount > 1) {
    lines.push("");
    const focusEntries = Array.from(patterns.focusAreas.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    const focusSummary = focusEntries.map(([area, count]) => `${area} (${count})`).join(", ");
    lines.push(`Patterns: ${patterns.sessionCount} sessions, focus on ${focusSummary}`);
  }

  return lines.join("\n");
}

function parseArgs(): { days: number; outputCandidates: boolean } {
  const args = process.argv.slice(2);
  let days = 7;
  let outputCandidates = false;

  for (const arg of args) {
    if (arg.startsWith("--days=")) {
      days = parseInt(arg.split("=")[1], 10) || 7;
    }
    if (arg === "--candidates") {
      outputCandidates = true;
    }
  }

  return { days, outputCandidates };
}

function findResolutionCandidates(
  pendingItems: PendingItem[],
  accomplishedItems: AccomplishedCandidate[],
  resolvedKeys: Set<string>
): ResolutionCandidate[] {
  const candidates: ResolutionCandidate[] = [];

  for (const pending of pendingItems) {
    const key = generatePendingKey(pending.project, pending.text);
    if (resolvedKeys.has(key)) continue;

    const projectAccomplished = accomplishedItems.filter(
      a => a.project.toLowerCase() === pending.project.toLowerCase()
    );

    for (const accomplished of projectAccomplished) {
      const score = matchScore(pending.text, accomplished.text);
      if (score > 0.15) {
        candidates.push({
          pending: { text: pending.text, project: pending.project },
          accomplished: { text: accomplished.text, timestamp: accomplished.timestamp },
          score,
        });
      }
    }
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, 20); // Top 20 candidates
}

async function main() {
  const { days, outputCandidates } = parseArgs();
  const cwd = process.cwd();
  const ctx = detectContext(cwd);

  const allBlocks = loadAllBlocks();
  const projectBlocks = filterByProject(allBlocks, ctx.project);
  const worktreeBlocks = filterByWorktree(projectBlocks, ctx.worktree);

  const recentProjectBlocks = filterByDateRange(projectBlocks, days);
  const recentWorktreeBlocks = filterByDateRange(worktreeBlocks, days);

  // Get pending and accomplished items for resolution checking
  const pendingForCheck = getPendingItems().filter(
    p => p.project.toLowerCase() === ctx.project.toLowerCase()
  );
  const accomplishedItems = getAccomplishedItems(recentProjectBlocks, days);
  const resolvedKeys = loadResolvedKeys();

  // If --candidates flag, output JSON for Claude Code to process
  if (outputCandidates) {
    const candidates = findResolutionCandidates(pendingForCheck, accomplishedItems, resolvedKeys);
    console.log(JSON.stringify({ ctx, candidates }, null, 2));
    return;
  }

  // Last session: worktree-specific (most relevant)
  // Pending/patterns: project-wide (don't miss items from other worktrees)
  const lastSession = getLastSession(recentWorktreeBlocks);
  const pending = aggregatePending(recentProjectBlocks);
  const patterns = detectPatterns(recentProjectBlocks);

  const output = formatCatchup(ctx, lastSession, pending, patterns, days);
  console.log(output);

  if (recentWorktreeBlocks.length === 0 && recentProjectBlocks.length === 0) {
    console.log("");
    console.log("Try:");
    console.log("  /chronicle              # Capture current session");
    console.log("  /chronicle blocks       # See recent sessions across all projects");
    console.log(`  /chronicle search ${ctx.project}  # Search for related sessions`);
  }
}

main().catch(console.error);
