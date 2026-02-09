/**
 * Subconscious event schema.
 *
 * Every background action — from a quick haiku reflex to an opus reflection —
 * gets logged as a SubconsciousEvent. Append-only JSONL, one line per event.
 */

export type Trigger =
  | "session_start"
  | "topic_shift"
  | "new_fact"
  | "remember_fired"
  | "complex_exchange"
  | "idle_gap"
  | "session_end";

export type Layer = "reflexes" | "attention" | "metacognition" | "consolidation";

export type SurfacingLevel = "silent" | "gentle_notice" | "proactive_flag" | "interrupt";

export type Impact =
  | "none"
  | "enriched_context"
  | "changed_direction"
  | "prevented_error"
  | "unknown";

export type EventStatus = "fired" | "completed" | "failed" | "suppressed";

export interface SubconsciousEvent {
  // Identity
  id: string;
  session_id: string;
  timestamp: string;

  // What triggered it
  trigger: Trigger;
  trigger_context?: string;

  // What happened
  layer: Layer;
  model: string;
  action: string;
  agent_type: string;

  // Outcome
  status: EventStatus;
  duration_ms?: number;
  result_summary?: string;

  // Surfacing
  surfaced: boolean;
  surfacing_level?: SurfacingLevel;

  // Impact (filled retrospectively)
  impact?: Impact;
  impact_note?: string;
}

/**
 * Create an event when a background agent is spawned.
 * Call updateEvent() when it completes.
 */
export function createEvent(
  fields: Pick<SubconsciousEvent, "session_id" | "trigger" | "layer" | "model" | "action" | "agent_type"> &
    Partial<Pick<SubconsciousEvent, "trigger_context">>
): SubconsciousEvent {
  return {
    id: generateId(),
    timestamp: new Date().toISOString(),
    status: "fired",
    surfaced: false,
    ...fields,
  };
}

/**
 * Merge completion data into an existing event.
 * Returns a new object — events are values, not mutable refs.
 */
export function completeEvent(
  event: SubconsciousEvent,
  outcome: {
    status: EventStatus;
    duration_ms?: number;
    result_summary?: string;
    surfaced?: boolean;
    surfacing_level?: SurfacingLevel;
  }
): SubconsciousEvent {
  return { ...event, ...outcome };
}

/**
 * Add impact assessment to a completed event.
 */
export function assessImpact(
  event: SubconsciousEvent,
  impact: Impact,
  note?: string
): SubconsciousEvent {
  return { ...event, impact, impact_note: note };
}

/**
 * Short random ID. Not globally unique, just unique enough for a log file.
 */
function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `${timestamp}-${random}`;
}
