/**
 * JSONL storage for subconscious events.
 *
 * Append-only log at ~/.bertram/memory/logs/subconscious-events.jsonl
 * Events are written when fired, then the line is replaced when completed.
 * "Replace" means: read all, find by ID, swap, rewrite. Fine at log scale.
 */

import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import type { SubconsciousEvent } from "./schema.ts";

const LOG_DIR = `${process.env.HOME}/.bertram/memory/logs`;
const EVENTS_FILE = `${LOG_DIR}/subconscious-events.jsonl`;

function ensureDir(): void {
  mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * Append a new event to the log.
 */
export function appendEvent(event: SubconsciousEvent): void {
  ensureDir();
  appendFileSync(EVENTS_FILE, JSON.stringify(event) + "\n");
}

/**
 * Update an existing event in place (by ID).
 * Rewrites the file — acceptable for a log that grows by ~50 lines/day.
 */
export function updateEvent(event: SubconsciousEvent): boolean {
  if (!existsSync(EVENTS_FILE)) return false;

  const lines = readFileSync(EVENTS_FILE, "utf-8")
    .split("\n")
    .filter((line) => line.trim());

  let found = false;
  const updated = lines.map((line) => {
    try {
      const existing = JSON.parse(line) as SubconsciousEvent;
      if (existing.id === event.id) {
        found = true;
        return JSON.stringify(event);
      }
    } catch {}
    return line;
  });

  if (!found) return false;

  writeFileSync(EVENTS_FILE, updated.join("\n") + "\n");
  return true;
}

/**
 * Read all events, optionally filtered.
 */
export function readEvents(filter?: {
  session_id?: string;
  trigger?: string;
  layer?: string;
  since?: string;
}): SubconsciousEvent[] {
  if (!existsSync(EVENTS_FILE)) return [];

  const lines = readFileSync(EVENTS_FILE, "utf-8")
    .split("\n")
    .filter((line) => line.trim());

  const events: SubconsciousEvent[] = [];

  for (const line of lines) {
    try {
      const event = JSON.parse(line) as SubconsciousEvent;

      if (filter?.session_id && event.session_id !== filter.session_id) continue;
      if (filter?.trigger && event.trigger !== filter.trigger) continue;
      if (filter?.layer && event.layer !== filter.layer) continue;
      if (filter?.since && event.timestamp < filter.since) continue;

      events.push(event);
    } catch {}
  }

  return events;
}

/**
 * Get a single event by ID.
 */
export function getEvent(id: string): SubconsciousEvent | null {
  const events = readEvents();
  return events.find((e) => e.id === id) ?? null;
}

/**
 * Count events, grouped by a field.
 */
export function countBy(
  field: keyof SubconsciousEvent,
  filter?: Parameters<typeof readEvents>[0]
): Record<string, number> {
  const events = readEvents(filter);
  const counts: Record<string, number> = {};

  for (const event of events) {
    const key = String(event[field] ?? "unknown");
    counts[key] = (counts[key] ?? 0) + 1;
  }

  return counts;
}

/**
 * Basic stats about the event log.
 */
export function getStats(filter?: Parameters<typeof readEvents>[0]): {
  total: number;
  by_status: Record<string, number>;
  by_layer: Record<string, number>;
  by_trigger: Record<string, number>;
  surfaced_count: number;
  avg_duration_ms: number | null;
} {
  const events = readEvents(filter);

  const by_status: Record<string, number> = {};
  const by_layer: Record<string, number> = {};
  const by_trigger: Record<string, number> = {};
  let surfaced_count = 0;
  let total_duration = 0;
  let duration_count = 0;

  for (const event of events) {
    by_status[event.status] = (by_status[event.status] ?? 0) + 1;
    by_layer[event.layer] = (by_layer[event.layer] ?? 0) + 1;
    by_trigger[event.trigger] = (by_trigger[event.trigger] ?? 0) + 1;

    if (event.surfaced) surfaced_count++;
    if (event.duration_ms != null) {
      total_duration += event.duration_ms;
      duration_count++;
    }
  }

  return {
    total: events.length,
    by_status,
    by_layer,
    by_trigger,
    surfaced_count,
    avg_duration_ms: duration_count > 0 ? Math.round(total_duration / duration_count) : null,
  };
}
