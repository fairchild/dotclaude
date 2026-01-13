#!/usr/bin/env bun
/**
 * Generate Chronicle digests in markdown format.
 *
 * Usage:
 *   bun publish.ts [period]
 *
 * Periods:
 *   daily  - Last 24 hours
 *   weekly - Last 7 days (default)
 *   month  - Last 30 days
 */
import { mkdirSync, writeFileSync } from "fs";
import {
  loadAllBlocks,
  getBlocksInRange,
  getProjectStats,
  getPendingItems,
  getTopFiles,
  getDateRanges,
  getISOWeek,
  formatDateRange,
  groupByProject,
  type ChronicleBlock,
  type DateRange,
  type PendingItem,
  type ProjectStats,
} from "./queries.ts";

const DIGESTS_DIR = `${process.env.HOME}/.claude/chronicle/digests`;

type Period = "daily" | "weekly" | "month";

function getRange(period: Period): DateRange {
  const ranges = getDateRanges();
  switch (period) {
    case "daily":
      return ranges.last7Days.start > ranges.daily.start
        ? ranges.daily
        : { start: new Date(Date.now() - 24 * 60 * 60 * 1000), end: new Date() };
    case "weekly":
      return ranges.last7Days;
    case "month":
      return ranges.last30Days;
  }
}

function getFilename(period: Period, date: Date): string {
  const iso = date.toISOString().split("T")[0];
  switch (period) {
    case "daily":
      return `${iso}-daily.md`;
    case "weekly": {
      const { year, week } = getISOWeek(date);
      return `${year}-W${String(week).padStart(2, "0")}.md`;
    }
    case "month": {
      const ym = iso.substring(0, 7);
      return `${ym}.md`;
    }
  }
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function pluralize(n: number, singular: string, plural?: string): string {
  return n === 1 ? `${n} ${singular}` : `${n} ${plural ?? singular + "s"}`;
}

function generateDigest(blocks: ChronicleBlock[], period: Period): string {
  const now = new Date();
  const range = getRange(period);
  const projectGroups = groupByProject(blocks);
  const projects = Array.from(projectGroups.entries()).sort(
    (a, b) => b[1].length - a[1].length
  );

  const totalMessages = blocks.reduce((sum, b) => sum + (b.messageCount ?? 0), 0);
  const allFiles = new Set<string>();
  for (const b of blocks) {
    for (const f of b.filesModified ?? []) allFiles.add(f);
  }
  const pendingItems = blocks.flatMap((b) =>
    b.pending.map((text) => ({ text, project: b.project, timestamp: b.timestamp }))
  );

  const lines: string[] = [];

  // Header
  const periodLabel =
    period === "daily" ? "Daily" : period === "weekly" ? "Weekly" : "Monthly";
  const { year, week } = getISOWeek(now);
  const title =
    period === "weekly"
      ? `Chronicle: Week ${week}, ${year}`
      : period === "month"
      ? `Chronicle: ${now.toLocaleDateString("en-US", { month: "long", year: "numeric" })}`
      : `Chronicle: ${formatDate(now)}`;

  lines.push(`# ${title}`);
  lines.push(
    `> Generated: ${formatDate(now)} | ${pluralize(blocks.length, "session")} | ${pluralize(projects.length, "project")}`
  );
  lines.push("");

  // At a Glance
  lines.push("## At a Glance");
  if (projects.length > 0) {
    lines.push(`- **Most active:** ${projects[0][0]} (${pluralize(projects[0][1].length, "session")})`);
  }
  lines.push(`- **Messages exchanged:** ${totalMessages.toLocaleString()}`);
  lines.push(`- **Files touched:** ${allFiles.size}`);
  lines.push(`- **Pending items:** ${pendingItems.length}`);
  lines.push("");

  // Project Summaries
  lines.push("## Project Summaries");
  lines.push("");

  for (const [project, projectBlocks] of projects) {
    const branches = [...new Set(projectBlocks.map((b) => b.branch).filter(Boolean))];
    const branchInfo = branches.length > 0 ? ` | branches: ${branches.slice(0, 3).join(", ")}${branches.length > 3 ? "..." : ""}` : "";

    lines.push(`### ${project}`);
    lines.push(`${pluralize(projectBlocks.length, "session")}${branchInfo}`);
    lines.push("");

    // Top accomplishments (deduplicated, limited)
    const accomplishments = new Set<string>();
    for (const b of projectBlocks) {
      for (const a of b.accomplished) {
        if (accomplishments.size < 5) accomplishments.add(a);
      }
    }
    if (accomplishments.size > 0) {
      lines.push("**Highlights:**");
      for (const a of accomplishments) {
        lines.push(`- ${a}`);
      }
      lines.push("");
    }

    // Pending for this project
    const projectPending = projectBlocks.flatMap((b) => b.pending);
    if (projectPending.length > 0) {
      lines.push("**Still pending:**");
      const uniquePending = [...new Set(projectPending)].slice(0, 3);
      for (const p of uniquePending) {
        lines.push(`- [ ] ${p}`);
      }
      lines.push("");
    }
  }

  // Pending Work Queue
  if (pendingItems.length > 0) {
    lines.push("## Pending Work Queue");
    lines.push("Priority items across all projects:");
    lines.push("");

    // Group by project, show top items
    const pendingByProject = new Map<string, string[]>();
    for (const item of pendingItems) {
      const existing = pendingByProject.get(item.project) ?? [];
      if (existing.length < 2) {
        existing.push(item.text);
        pendingByProject.set(item.project, existing);
      }
    }

    let idx = 1;
    for (const [project, items] of pendingByProject) {
      for (const text of items) {
        lines.push(`${idx}. **${project}** - ${text}`);
        idx++;
        if (idx > 10) break;
      }
      if (idx > 10) break;
    }
    lines.push("");
  }

  // Files Most Modified
  const topFiles = getTopFiles(8).filter((f) => {
    // Only include files from blocks in this period
    return blocks.some((b) => b.filesModified?.includes(f.file));
  });
  if (topFiles.length > 0) {
    lines.push("## Files Most Modified");
    lines.push("");
    lines.push("| File | Changes | Project |");
    lines.push("|------|---------|---------|");
    for (const f of topFiles.slice(0, 8)) {
      lines.push(`| ${f.file} | ${f.count} | ${f.projects[0]} |`);
    }
    lines.push("");
  }

  // Observations (simple heuristics)
  lines.push("## Observations");
  lines.push("");

  if (projects.length > 0) {
    const topProject = projects[0];
    const pct = Math.round((topProject[1].length / blocks.length) * 100);
    lines.push(`- ${pct}% of sessions focused on **${topProject[0]}**`);
  }

  if (projects.length > 1) {
    lines.push(`- Work spread across ${projects.length} projects`);
  }

  const avgMessages = blocks.length > 0 ? Math.round(totalMessages / blocks.length) : 0;
  if (avgMessages > 0) {
    lines.push(`- Average session length: ${avgMessages} messages`);
  }

  // Find any common themes in summaries (simple word frequency)
  const words = new Map<string, number>();
  const stopWords = new Set(["the", "a", "an", "and", "or", "to", "for", "of", "in", "on", "with", "was", "were", "is", "are", "been", "being", "have", "has", "had", "do", "does", "did", "will", "would", "could", "should", "may", "might", "must", "that", "this", "these", "those", "it", "its"]);
  for (const b of blocks) {
    for (const word of b.summary.toLowerCase().split(/\W+/)) {
      if (word.length > 4 && !stopWords.has(word)) {
        words.set(word, (words.get(word) ?? 0) + 1);
      }
    }
  }
  const topWords = [...words.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  if (topWords.length > 0) {
    lines.push(`- Common themes: ${topWords.map(([w]) => w).join(", ")}`);
  }

  lines.push("");
  lines.push("---");
  lines.push(`*Generated by Chronicle at ${new Date().toISOString()}*`);

  return lines.join("\n");
}

async function main() {
  const arg = process.argv[2]?.toLowerCase();
  const period: Period = arg === "daily" ? "daily" : arg === "month" ? "month" : "weekly";

  const range = getRange(period);
  const blocks = getBlocksInRange(range);

  if (blocks.length === 0) {
    console.log(`No sessions found for ${period} period (${formatDateRange(range)})`);
    process.exit(0);
  }

  const digest = generateDigest(blocks, period);
  const filename = getFilename(period, new Date());

  mkdirSync(DIGESTS_DIR, { recursive: true });
  const filepath = `${DIGESTS_DIR}/${filename}`;
  writeFileSync(filepath, digest);

  console.log(`Chronicle ${period} digest generated:`);
  console.log(`  ${filepath}`);
  console.log(`  ${blocks.length} sessions | ${new Set(blocks.map((b) => b.project)).size} projects`);
}

main().catch((e) => {
  console.error("Error generating digest:", e.message);
  process.exit(1);
});
