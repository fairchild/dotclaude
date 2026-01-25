#!/usr/bin/env bun
/**
 * Chronicle SessionStart Hook
 *
 * Injects Chronicle context at session start for ambient awareness.
 * Outputs JSON with additionalContext if relevant data exists.
 *
 * Hook input (stdin): { session_id, cwd, ... }
 * Hook output (stdout): { hookSpecificOutput?: { additionalContext: string } }
 */
import { detectContext } from "./context.ts";
import {
  loadAllBlocks,
  getPendingWithAge,
  STALE_THRESHOLD_DAYS,
  type ChronicleBlock,
  type PendingItemWithAge,
} from "./queries.ts";

interface HookInput {
  session_id: string;
  cwd: string;
}

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  return `${diffDays} days ago`;
}

function getLastSessionForProject(blocks: ChronicleBlock[], project: string): ChronicleBlock | null {
  const projectBlocks = blocks.filter(
    b => b.project.toLowerCase() === project.toLowerCase()
  );
  return projectBlocks.length > 0 ? projectBlocks[0] : null;
}

function getPendingForProject(pending: PendingItemWithAge[], project: string): PendingItemWithAge[] {
  return pending.filter(p => p.project.toLowerCase() === project.toLowerCase());
}

function formatSessionStartContext(
  project: string,
  lastSession: ChronicleBlock | null,
  pending: PendingItemWithAge[]
): string | null {
  if (!lastSession && pending.length === 0) return null;

  const lines: string[] = [`📋 Chronicle: ${project}`];

  if (lastSession) {
    const timeAgo = formatTimeAgo(new Date(lastSession.timestamp));
    lines.push(`Last session (${timeAgo}): ${lastSession.summary}`);
  }

  if (pending.length > 0) {
    const items = pending.slice(0, 3).map(p => p.text);
    lines.push(`Pending: ${items.join("; ")}`);
    if (pending.length > 3) {
      lines.push(`  (+${pending.length - 3} more)`);
    }
  }

  const staleCount = pending.filter(p => p.isStale).length;
  if (staleCount > 0) {
    lines.push(`⚠️ ${staleCount} stale item${staleCount > 1 ? "s" : ""} (>${STALE_THRESHOLD_DAYS} days)`);
  }

  return lines.join("\n");
}

async function main() {
  const input = await Bun.stdin.text();
  let hookInput: HookInput;

  try {
    hookInput = JSON.parse(input);
  } catch {
    console.log("{}");
    return;
  }

  const ctx = detectContext(hookInput.cwd);
  const blocks = loadAllBlocks();
  const pending = getPendingWithAge();

  const lastSession = getLastSessionForProject(blocks, ctx.project);
  const projectPending = getPendingForProject(pending, ctx.project);

  const context = formatSessionStartContext(ctx.project, lastSession, projectPending);

  if (context) {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        additionalContext: context,
      },
    }));
  } else {
    console.log("{}");
  }
}

main().catch(() => console.log("{}"));
