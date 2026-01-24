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
import { loadAllBlocks, type ChronicleBlock } from "./queries.ts";
import { execSync } from "child_process";
import { basename } from "path";

interface Context {
  project: string;
  worktree: string | null;
  branch: string | null;
  cwd: string;
}

interface AggregatedPending {
  text: string;
  firstSeen: Date;
  ageInDays: number;
}

interface Patterns {
  sessionCount: number;
  focusAreas: Map<string, number>;
}

// Worktree space configuration
const WORKTREE_SPACES = [
  {
    basePath: `${process.env.HOME}/conductor/workspaces`,
    projectAliases: { ".claude": "dotclaude" } as Record<string, string>,
  },
  {
    basePath: `${process.env.HOME}/.worktrees`,
    projectAliases: {} as Record<string, string>,
  },
];

function detectContext(cwd: string): Context {
  const parsed = parseWorktreeSpace(cwd);
  const worktree = parsed?.worktree ?? null;
  let project = parsed?.project ?? null;
  let branch: string | null = null;

  try {
    const url = execSync(`git -C "${cwd}" config --get remote.origin.url`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    project = url.replace(/\.git$/, "").split("/").pop() || basename(cwd);
  } catch {
    if (!project) project = basename(cwd);
  }

  try {
    branch = execSync(`git -C "${cwd}" branch --show-current`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim() || null;
  } catch {}

  return { project, worktree, branch, cwd };
}

function parseWorktreeSpace(cwd: string): { project: string; worktree: string | null } | null {
  for (const space of WORKTREE_SPACES) {
    if (!cwd.startsWith(space.basePath)) continue;
    const relativePath = cwd.slice(space.basePath.length + 1);
    const parts = relativePath.split("/").filter(Boolean);
    if (parts.length >= 2) {
      const repo = parts[0];
      const worktree = parts[1];
      const project = space.projectAliases[repo] ?? repo;
      return { project, worktree };
    } else if (parts.length === 1) {
      const project = space.projectAliases[parts[0]] ?? parts[0];
      return { project, worktree: null };
    }
  }
  return null;
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
  const seen = new Map<string, AggregatedPending>();
  const now = new Date();

  for (const block of [...blocks].reverse()) {
    for (const text of block.pending || []) {
      const key = text.toLowerCase().trim();
      if (!seen.has(key)) {
        const firstSeen = new Date(block.timestamp);
        const ageInDays = Math.floor((now.getTime() - firstSeen.getTime()) / (1000 * 60 * 60 * 24));
        seen.set(key, { text, firstSeen, ageInDays });
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
  days: number
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

  if (pending.length > 0) {
    lines.push("");
    lines.push(`Pending work (project-wide, last ${days} days):`);
    for (const item of pending.slice(0, 8)) {
      lines.push(`  [ ] ${item.text} (${formatAge(item.ageInDays)})`);
    }
    if (pending.length > 8) {
      lines.push(`  ... and ${pending.length - 8} more`);
    }
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

function parseArgs(): { days: number } {
  const args = process.argv.slice(2);
  let days = 7;

  for (const arg of args) {
    if (arg.startsWith("--days=")) {
      days = parseInt(arg.split("=")[1], 10) || 7;
    }
  }

  return { days };
}

async function main() {
  const { days } = parseArgs();
  const cwd = process.cwd();
  const ctx = detectContext(cwd);

  const allBlocks = loadAllBlocks();
  const projectBlocks = filterByProject(allBlocks, ctx.project);
  const worktreeBlocks = filterByWorktree(projectBlocks, ctx.worktree);
  
  const recentProjectBlocks = filterByDateRange(projectBlocks, days);
  const recentWorktreeBlocks = filterByDateRange(worktreeBlocks, days);

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
