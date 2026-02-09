#!/usr/bin/env bun
/**
 * Generate a markdown report from subconscious event logs.
 *
 * Usage:
 *   bun scripts/report.ts                    # All events
 *   bun scripts/report.ts --since 2026-02-01 # Since date
 *   bun scripts/report.ts --session <id>     # Single session
 *   bun scripts/report.ts --output report.md # Write to file (default: stdout)
 */

import { readEvents } from "./store.ts";
import { writeFileSync } from "fs";
import type { SubconsciousEvent, Trigger, Layer, SurfacingLevel, Impact } from "./schema.ts";

// --- CLI args ---

const args = process.argv.slice(2);

function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : undefined;
}

const since = getArg("since");
const session_id = getArg("session");
const outputPath = getArg("output");

// --- Data ---

const events = readEvents({
  ...(since && { since }),
  ...(session_id && { session_id }),
});

if (events.length === 0) {
  const msg = "No subconscious events found.\n";
  if (outputPath) writeFileSync(outputPath, msg);
  else process.stdout.write(msg);
  process.exit(0);
}

// --- Analysis ---

const completed = events.filter((e) => e.status === "completed");
const failed = events.filter((e) => e.status === "failed");
const suppressed = events.filter((e) => e.status === "suppressed");
const surfaced = events.filter((e) => e.surfaced);

// Hit rate: completed with a result_summary that isn't empty / "nothing actionable"
const actionable = completed.filter(
  (e) => e.result_summary && !e.result_summary.toLowerCase().includes("nothing actionable")
);

// Group by trigger
const byTrigger = groupBy(events, "trigger");
const byLayer = groupBy(events, "layer");
const bySurfacingLevel = groupBy(surfaced, "surfacing_level");
const byImpact = groupBy(
  events.filter((e) => e.impact),
  "impact"
);

// Sessions
const sessionIds = new Set(events.map((e) => e.session_id));

// Duration stats by layer
const durationByLayer: Record<string, number[]> = {};
for (const e of completed) {
  if (e.duration_ms != null) {
    (durationByLayer[e.layer] ??= []).push(e.duration_ms);
  }
}

// --- Report ---

const lines: string[] = [];
const w = (s: string) => lines.push(s);

const dateRange = since
  ? `Since ${since}`
  : `${events[0].timestamp.slice(0, 10)} to ${events[events.length - 1].timestamp.slice(0, 10)}`;

w(`# Subconscious Report`);
w(``);
w(`Period: ${dateRange}`);
w(`Sessions: ${sessionIds.size} | Events: ${events.length} | Surfaced: ${surfaced.length}`);
w(``);

// --- Trigger Frequency ---
w(`## Trigger Frequency`);
w(``);
w(`| Trigger | Fired | Completed | Actionable | Hit Rate | Surfaced |`);
w(`|---------|------:|----------:|-----------:|---------:|---------:|`);

for (const [trigger, triggerEvents] of sortedEntries(byTrigger)) {
  const comp = triggerEvents.filter((e) => e.status === "completed").length;
  const act = triggerEvents.filter(
    (e) =>
      e.status === "completed" &&
      e.result_summary &&
      !e.result_summary.toLowerCase().includes("nothing actionable")
  ).length;
  const hitRate = comp > 0 ? `${Math.round((act / comp) * 100)}%` : "—";
  const surf = triggerEvents.filter((e) => e.surfaced).length;
  w(`| ${trigger} | ${triggerEvents.length} | ${comp} | ${act} | ${hitRate} | ${surf} |`);
}
w(``);

// --- Layer Distribution ---
w(`## Layer Distribution`);
w(``);
w(`| Layer | Count | Avg Duration | Failed |`);
w(`|-------|------:|-------------:|-------:|`);

for (const [layer, layerEvents] of sortedEntries(byLayer)) {
  const durations = durationByLayer[layer] ?? [];
  const avgDur =
    durations.length > 0
      ? `${(durations.reduce((a, b) => a + b, 0) / durations.length / 1000).toFixed(1)}s`
      : "—";
  const failCount = layerEvents.filter((e) => e.status === "failed").length;
  w(`| ${layer} | ${layerEvents.length} | ${avgDur} | ${failCount} |`);
}
w(``);

// --- Surfacing ---
if (surfaced.length > 0) {
  w(`## Surfacing`);
  w(``);
  w(`| Level | Count | With Impact |`);
  w(`|-------|------:|------------:|`);

  for (const [level, levelEvents] of sortedEntries(bySurfacingLevel)) {
    const withImpact = levelEvents.filter(
      (e) => e.impact && e.impact !== "none" && e.impact !== "unknown"
    ).length;
    w(`| ${level ?? "unspecified"} | ${levelEvents.length} | ${withImpact} |`);
  }
  w(``);
}

// --- Impact ---
if (byImpact.size > 0) {
  w(`## Impact`);
  w(``);
  w(`| Impact | Count |`);
  w(`|--------|------:|`);
  for (const [impact, impactEvents] of sortedEntries(byImpact)) {
    w(`| ${impact} | ${impactEvents.length} |`);
  }
  w(``);
}

// --- Waste ---
const wasteTriggers = [...byTrigger.entries()].filter(([, evts]) => {
  const comp = evts.filter((e) => e.status === "completed");
  if (comp.length < 3) return false; // Too few to judge
  const act = comp.filter(
    (e) => e.result_summary && !e.result_summary.toLowerCase().includes("nothing actionable")
  );
  return act.length === 0;
});

if (wasteTriggers.length > 0) {
  w(`## Waste`);
  w(``);
  w(`Triggers with zero actionable results (3+ fires):`);
  w(``);
  for (const [trigger, evts] of wasteTriggers) {
    w(`- **${trigger}**: 0/${evts.length} hit rate`);
  }
  w(``);
}

// --- Failures ---
if (failed.length > 0) {
  w(`## Failures`);
  w(``);
  for (const e of failed.slice(-10)) {
    const summary = e.result_summary ?? "no details";
    w(`- \`${e.action}\` (${e.layer}/${e.trigger}): ${summary}`);
  }
  w(``);
}

// --- Summary ---
w(`## Summary`);
w(``);
w(`- **Total events**: ${events.length}`);
w(`- **Completion rate**: ${pct(completed.length, events.length)}`);
w(`- **Hit rate** (actionable / completed): ${pct(actionable.length, completed.length)}`);
w(`- **Surfacing rate** (surfaced / total): ${pct(surfaced.length, events.length)}`);
w(
  `- **Failure rate**: ${pct(failed.length, events.length)}${failed.length > 0 ? " (review failures above)" : ""}`
);
w(
  `- **Suppressed**: ${suppressed.length}${suppressed.length > 0 ? " (budget/concurrency limits)" : ""}`
);
w(``);

// --- Output ---

const report = lines.join("\n");

if (outputPath) {
  writeFileSync(outputPath, report);
  console.log(`Report written to ${outputPath}`);
} else {
  process.stdout.write(report);
}

// --- Helpers ---

function groupBy<K extends keyof SubconsciousEvent>(
  events: SubconsciousEvent[],
  key: K
): Map<string, SubconsciousEvent[]> {
  const groups = new Map<string, SubconsciousEvent[]>();
  for (const event of events) {
    const k = String(event[key] ?? "unknown");
    const group = groups.get(k) ?? [];
    group.push(event);
    groups.set(k, group);
  }
  return groups;
}

function sortedEntries(map: Map<string, SubconsciousEvent[]>): [string, SubconsciousEvent[]][] {
  return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
}

function pct(num: number, denom: number): string {
  if (denom === 0) return "—";
  return `${Math.round((num / denom) * 100)}%`;
}
