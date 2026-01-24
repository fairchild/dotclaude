#!/usr/bin/env bun
/**
 * Explicitly mark pending items as resolved.
 *
 * Usage:
 *   bun resolve.ts "Add unit tests"    # Mark as resolved
 *   bun resolve.ts --list              # Show all resolved items
 *   bun resolve.ts --undo "text"       # Remove a resolution
 */
import {
  loadResolved,
  saveResolved,
  generatePendingKey,
  type Resolution,
} from "./resolve-lib.ts";
import { getPendingItems } from "./queries.ts";

function fuzzyMatch(
  query: string,
  items: { text: string; project: string }[]
): typeof items {
  const lower = query.toLowerCase();

  // Exact substring match first
  const exact = items.filter(i => i.text.toLowerCase().includes(lower));
  if (exact.length > 0) return exact;

  // Token overlap
  const queryTokens = new Set(lower.split(/\s+/));
  return items.filter(i => {
    const itemTokens = new Set(i.text.toLowerCase().split(/\s+/));
    const overlap = [...queryTokens].filter(t => itemTokens.has(t)).length;
    return overlap >= Math.min(2, queryTokens.size);
  });
}

function resolveExplicit(searchText: string) {
  const pending = getPendingItems(true); // Include already resolved to show if duplicate
  const matches = fuzzyMatch(searchText, pending);

  if (matches.length === 0) {
    console.log(`No pending items match "${searchText}"`);
    console.log("\nTry /chronicle pending to see all items.");
    return;
  }

  if (matches.length > 1) {
    console.log(`Multiple matches for "${searchText}":`);
    for (const m of matches.slice(0, 5)) {
      console.log(`  - [${m.project}] ${m.text}`);
    }
    console.log("\nBe more specific or use the exact text.");
    return;
  }

  const item = matches[0];
  const key = generatePendingKey(item.project, item.text);

  const overlay = loadResolved();
  const existing = overlay.resolutions.find(r => r.pendingKey === key);

  if (existing) {
    console.log(`Already resolved: ${item.text}`);
    console.log(`  Resolved by: ${existing.resolvedBy}`);
    console.log(`  At: ${existing.resolvedAt.split("T")[0]}`);
    return;
  }

  const resolution: Resolution = {
    pendingText: item.text,
    pendingKey: key,
    resolvedBy: "Manually marked as resolved",
    signal: "explicit",
    matchScore: 1,
    resolvedAt: new Date().toISOString(),
    project: item.project,
  };

  overlay.resolutions.push(resolution);
  saveResolved(overlay);

  console.log(`✓ Resolved: ${item.text}`);
}

function listResolved() {
  const overlay = loadResolved();

  if (overlay.resolutions.length === 0) {
    console.log("No resolved items yet.");
    return;
  }

  console.log(`Resolved items (${overlay.resolutions.length}):\n`);

  const byProject = new Map<string, Resolution[]>();
  for (const r of overlay.resolutions) {
    const existing = byProject.get(r.project) || [];
    existing.push(r);
    byProject.set(r.project, existing);
  }

  for (const [project, items] of byProject) {
    console.log(`${project}:`);
    for (const item of items) {
      const date = item.resolvedAt.split("T")[0];
      const signal = item.signal === "explicit" ? "[manual]" : "[auto]";
      console.log(`  ✓ ${item.pendingText} ${signal} ${date}`);
      if (item.signal === "auto") {
        const evidence = item.resolvedBy.substring(0, 60);
        const suffix = item.resolvedBy.length > 60 ? "..." : "";
        console.log(`    → ${evidence}${suffix}`);
      }
    }
    console.log();
  }
}

function undoResolution(searchKey: string) {
  const overlay = loadResolved();
  const lower = searchKey.toLowerCase();

  const idx = overlay.resolutions.findIndex(
    r =>
      r.pendingKey.includes(lower) ||
      r.pendingText.toLowerCase().includes(lower)
  );

  if (idx === -1) {
    console.log(`No resolution found matching "${searchKey}"`);
    return;
  }

  const removed = overlay.resolutions.splice(idx, 1)[0];
  saveResolved(overlay);

  console.log(`Undid resolution: ${removed.pendingText}`);
  console.log("Item is now pending again.");
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes("--list") || args.includes("-l")) {
    listResolved();
    return;
  }

  if (args.includes("--undo")) {
    const idx = args.indexOf("--undo");
    const key = args[idx + 1];
    if (!key) {
      console.log("Usage: bun resolve.ts --undo 'search text'");
      return;
    }
    undoResolution(key);
    return;
  }

  const searchText = args.join(" ");
  if (!searchText) {
    console.log("Usage:");
    console.log("  bun resolve.ts 'pending item text'  # Mark as resolved");
    console.log("  bun resolve.ts --list               # Show resolved items");
    console.log("  bun resolve.ts --undo 'text'        # Undo a resolution");
    return;
  }

  resolveExplicit(searchText);
}

main();
