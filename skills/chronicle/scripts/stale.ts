#!/usr/bin/env bun
import { getPendingWithAge, type PendingItemWithAge } from "./queries.ts";

function formatAge(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "1 day";
  if (days < 7) return `${days} days`;
  const weeks = Math.floor(days / 7);
  if (weeks === 1) return "1 week";
  if (days < 30) return `${weeks} weeks`;
  const months = Math.floor(days / 30);
  if (months === 1) return "1 month";
  return `${months} months`;
}

function groupByProject(
  items: PendingItemWithAge[]
): Map<string, PendingItemWithAge[]> {
  const groups = new Map<string, PendingItemWithAge[]>();
  for (const item of items) {
    const existing = groups.get(item.project);
    if (existing) {
      existing.push(item);
    } else {
      groups.set(item.project, [item]);
    }
  }
  return groups;
}

function main() {
  const allPending = getPendingWithAge();
  const stale = allPending.filter((item) => item.isStale);

  if (stale.length === 0) {
    console.log("No stale pending items (>14 days).");
    console.log(`\nTotal pending items: ${allPending.length}`);
    return;
  }

  console.log(`Stale pending items (>14 days): ${stale.length}\n`);

  const byProject = groupByProject(stale);
  const sortedProjects = Array.from(byProject.entries()).sort(
    (a, b) => b[1].length - a[1].length
  );

  for (const [project, items] of sortedProjects) {
    console.log(`${project} (${items.length} stale):`);
    for (const item of items) {
      const age = formatAge(item.ageInDays);
      console.log(`  [ ] ${item.text} (${age})`);
    }
    console.log();
  }

  const nonStale = allPending.length - stale.length;
  if (nonStale > 0) {
    console.log(`---`);
    console.log(`${nonStale} pending items are not yet stale (<14 days)`);
  }
}

main();
