#!/usr/bin/env bun
/**
 * Chronicle Block Consolidator
 *
 * Reduces block bloat by consolidating per-project, per-week blocks into
 * single summary blocks. Deduplicates pending/accomplished items.
 *
 * Original blocks are moved to an archive directory, not deleted.
 *
 * Usage:
 *   bun consolidate.ts                  # Dry run (default)
 *   bun consolidate.ts --apply          # Actually consolidate
 *   bun consolidate.ts --older-than=30  # Only blocks older than 30 days (default: 14)
 *   bun consolidate.ts --project=services  # Only consolidate one project
 *   bun consolidate.ts --drop-pending   # Drop all pending items from consolidated blocks
 */
import { readdirSync, readFileSync, mkdirSync, renameSync, writeFileSync, existsSync } from "fs";
import type { ChronicleBlock } from "./types.ts";

const BLOCKS_DIR = `${process.env.HOME}/.claude/chronicle/blocks`;
const ARCHIVE_DIR = `${process.env.HOME}/.claude/chronicle/archive`;

interface ConsolidationGroup {
  key: string; // "project::2026-W05"
  project: string;
  weekLabel: string;
  blocks: { filename: string; block: ChronicleBlock }[];
}

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    apply: args.includes("--apply"),
    olderThanDays: parseInt(args.find(a => a.startsWith("--older-than="))?.split("=")[1] ?? "14"),
    project: args.find(a => a.startsWith("--project="))?.split("=")[1],
    dropPending: args.includes("--drop-pending"),
  };
}

function isoWeek(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

function loadBlocks(): { filename: string; block: ChronicleBlock }[] {
  if (!existsSync(BLOCKS_DIR)) return [];
  return readdirSync(BLOCKS_DIR)
    .filter(f => f.endsWith(".json"))
    .map(filename => {
      try {
        const content = readFileSync(`${BLOCKS_DIR}/${filename}`, "utf-8");
        return { filename, block: JSON.parse(content) as ChronicleBlock };
      } catch {
        return null;
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

function groupBlocks(
  blocks: { filename: string; block: ChronicleBlock }[],
  olderThanDays: number,
  projectFilter?: string,
): ConsolidationGroup[] {
  const now = new Date();
  const cutoff = new Date(now.getTime() - olderThanDays * 24 * 60 * 60 * 1000);
  const groups = new Map<string, ConsolidationGroup>();

  for (const entry of blocks) {
    const ts = new Date(entry.block.timestamp);
    if (ts >= cutoff) continue;
    if (projectFilter && entry.block.project.toLowerCase() !== projectFilter.toLowerCase()) continue;

    const week = isoWeek(ts);
    const key = `${entry.block.project}::${week}`;

    let group = groups.get(key);
    if (!group) {
      group = { key, project: entry.block.project, weekLabel: week, blocks: [] };
      groups.set(key, group);
    }
    group.blocks.push(entry);
  }

  // Only return groups with 2+ blocks (no point consolidating a single block)
  return Array.from(groups.values()).filter(g => g.blocks.length >= 2);
}

function consolidateGroup(group: ConsolidationGroup): { consolidated: ChronicleBlock; filename: string } {
  const sorted = group.blocks
    .map(b => b.block)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  // Deduplicate arrays by normalizing text
  const dedup = (items: string[]): string[] => {
    const seen = new Map<string, string>();
    for (const item of items) {
      const normalized = item.toLowerCase().trim();
      if (!seen.has(normalized)) {
        seen.set(normalized, item);
      }
    }
    return Array.from(seen.values());
  };

  const allAccomplished = dedup(sorted.flatMap(b => b.accomplished));
  const allPending = dedup(sorted.flatMap(b => b.pending));

  // Remove pending items that appear in accomplished
  const accomplishedNorm = new Set(allAccomplished.map(a => a.toLowerCase().trim()));
  const filteredPending = allPending.filter(p => !accomplishedNorm.has(p.toLowerCase().trim()));

  const allBranches = [...new Set(sorted.map(b => b.branch).filter(Boolean))];
  const allFiles = [...new Set(sorted.flatMap(b => b.filesModified ?? []))];
  const totalMessages = sorted.reduce((sum, b) => sum + (b.messageCount ?? 0), 0);

  const consolidated: ChronicleBlock = {
    timestamp: last.timestamp,
    sessionId: `consolidated-${group.key}`,
    project: group.project,
    branch: allBranches.length === 1 ? allBranches[0]! : null,
    summary: `[Consolidated ${sorted.length} sessions, ${group.weekLabel}] ${last.summary}`,
    accomplished: allAccomplished,
    pending: filteredPending,
    ...(allFiles.length > 0 && { filesModified: allFiles }),
    ...(totalMessages > 0 && { messageCount: totalMessages }),
    ...(allBranches.length > 1 && { notes: `Branches: ${allBranches.join(", ")}` }),
  };

  const dateStr = first.timestamp.split("T")[0];
  const filename = `${dateStr}-consolidated-${group.project}-${group.weekLabel}.json`;

  return { consolidated, filename };
}

function crossWeekDedup(groups: ConsolidationGroup[]): void {
  // Process groups per project in chronological order.
  // Only the earliest week keeps a pending item; later weeks drop it.
  const projectGroups = new Map<string, ConsolidationGroup[]>();
  for (const g of groups) {
    const list = projectGroups.get(g.project) ?? [];
    list.push(g);
    projectGroups.set(g.project, list);
  }

  for (const [, pGroups] of projectGroups) {
    const seenPending = new Set<string>();
    // Sort by week label (chronological)
    pGroups.sort((a, b) => a.weekLabel.localeCompare(b.weekLabel));

    for (const group of pGroups) {
      // Consolidate the group first to get deduped pending
      const { consolidated } = consolidateGroup(group);
      const filtered: string[] = [];

      for (const p of consolidated.pending) {
        const norm = p.toLowerCase().trim();
        if (!seenPending.has(norm)) {
          seenPending.add(norm);
          filtered.push(p);
        }
      }

      // Also mark accomplished items as "seen" so later weeks don't carry them as pending
      for (const a of consolidated.accomplished) {
        seenPending.add(a.toLowerCase().trim());
      }

      // Stash the cross-deduped pending back for stats
      (group as any)._crossDedupedPending = filtered;
    }
  }
}

function main() {
  const opts = parseArgs();
  const allBlocks = loadBlocks();

  console.log(`Loaded ${allBlocks.length} blocks`);

  const groups = groupBlocks(allBlocks, opts.olderThanDays, opts.project);

  if (groups.length === 0) {
    console.log(`No groups with 2+ blocks older than ${opts.olderThanDays} days to consolidate.`);
    return;
  }

  // Stats
  const totalOriginal = groups.reduce((sum, g) => sum + g.blocks.length, 0);
  const pendingBefore = groups.reduce(
    (sum, g) => sum + g.blocks.reduce((s, b) => s + b.block.pending.length, 0), 0
  );

  // Cross-week dedup
  crossWeekDedup(groups);

  let pendingAfter = 0;

  console.log(`\nFound ${groups.length} consolidation groups (${totalOriginal} blocks → ${groups.length} blocks)`);
  console.log(`Mode: ${opts.apply ? "APPLY" : "DRY RUN"}\n`);

  // Show per-project summary
  const projectSummary = new Map<string, { groups: number; blocks: number }>();
  for (const g of groups) {
    const existing = projectSummary.get(g.project) ?? { groups: 0, blocks: 0 };
    existing.groups++;
    existing.blocks += g.blocks.length;
    projectSummary.set(g.project, existing);
  }

  for (const [project, stats] of [...projectSummary.entries()].sort((a, b) => b[1].blocks - a[1].blocks)) {
    console.log(`  ${project}: ${stats.blocks} blocks → ${stats.groups} consolidated`);
  }

  if (opts.apply) {
    mkdirSync(ARCHIVE_DIR, { recursive: true });

    for (const group of groups) {
      const { consolidated, filename } = consolidateGroup(group);
      // Apply cross-week dedup
      consolidated.pending = (group as any)._crossDedupedPending ?? consolidated.pending;
      // Drop all pending from old consolidated blocks if requested
      if (opts.dropPending) consolidated.pending = [];
      pendingAfter += consolidated.pending.length;

      // Archive originals
      for (const entry of group.blocks) {
        renameSync(`${BLOCKS_DIR}/${entry.filename}`, `${ARCHIVE_DIR}/${entry.filename}`);
      }

      // Write consolidated block
      writeFileSync(`${BLOCKS_DIR}/${filename}`, JSON.stringify(consolidated, null, 2) + "\n");
    }

    console.log(`\nDone.`);
    console.log(`  Archived: ${totalOriginal} blocks → ${ARCHIVE_DIR}/`);
    console.log(`  Created: ${groups.length} consolidated blocks`);
    console.log(`  Pending items: ${pendingBefore} → ${pendingAfter} (deduped & cross-week filtered)`);
    console.log(`  Remaining blocks: ${allBlocks.length - totalOriginal + groups.length}`);
  } else {
    for (const group of groups) {
      if (opts.dropPending) {
        // All pending dropped — contributes 0
      } else {
        pendingAfter += ((group as any)._crossDedupedPending ?? consolidateGroup(group).consolidated.pending).length;
      }
    }

    console.log(`\nPending items: ${pendingBefore} → ${pendingAfter} (projected, cross-week deduped)`);
    console.log(`\nRun with --apply to execute.`);
  }
}

main();
