/**
 * The compaction mod: the main thread compacts at a moment it chooses, with
 * instructions for the summary. `mcp__compaction__context` answers `$.session.usage()` against
 * POINTS and the engine's auto-compaction threshold, so no value here has to match the settings;
 * `mcp__compaction__request` records one pending request (a second replaces it), refusing a
 * subagent, bad instructions, and a context below the floor or not yet measured.
 *
 * A main turn that ends with an answer arms one timer (IDLE_MS); a main turn that starts cancels
 * it. When it fires the mod reads the context again: a main turn begun meanwhile keeps the request
 * for that turn's end, a context below the floor drops it, and otherwise `/compact` runs once
 * through the command call, spike 10's route (`spikes/10-cloud-mods/`). State is lost on a reload.
 * Its other hooks pass each event on unchanged; its tool hooks answer only its own two tools.
 * `pnpm gates mods` holds its hooks and `$` calls to mods/allowlist.json, a test holds the command
 * to `compact`, and the types narrow Claude Code 2.1.316's mod API to what the mod uses.
 */

/**
 * The live context as `$.session.usage()` reports it (`SessionContextUsage`): `tokens` and `percent`
 * wait for its first response; `breakdown` comes when asked (`summary`, counted locally).
 */
export type ContextUsage = {
  readonly tokens?: number;
  readonly window: number;
  readonly percent?: number;
  readonly breakdown?: { readonly autoCompactThreshold?: number };
};

export type UsageArgs = { readonly breakdown?: "summary" };
type Usage = (args?: UsageArgs) => Promise<{ readonly context: ContextUsage }>;

export type ToolSpec = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema?: Readonly<Record<string, unknown>>;
};

export type Timer = { readonly cancel: () => void };

/** The engine interface (`$`), narrowed to the four calls the mod makes. */
export type Engine = {
  readonly session: { readonly usage: Usage };
  readonly tool: { readonly register: (tool: ToolSpec) => Promise<{ readonly tool: string }> };
  /** `after` calls `fn` once after `ms`, outside any hook, unless cancelled first. */
  readonly clock: { readonly after: (ms: number, fn: () => void) => Timer };
  /** `run` runs a slash command as if the person typed it, queued until the session is idle. */
  readonly command: {
    readonly run: (args: { readonly command: string; readonly args?: string }) => Promise<unknown>;
  };
};

/** Each event the mod hooks: its input and what `next(e)` resolves to, narrowed. */
type Events = {
  readonly "session.start": {
    readonly input: { readonly isInteractive: boolean; readonly surface: string | null };
    readonly result: unknown;
  };
  readonly "tool.call": {
    /** An MCP tool's call: its name and id, the loop it runs in (absent on the main loop), its arguments. */
    readonly input: {
      readonly tool: string;
      readonly tool_use_id: string;
      readonly agentId?: string;
      readonly [argument: string]: unknown;
    };
    readonly result: { readonly deny: string } | { readonly result: unknown };
  };
  readonly "turn.start": {
    readonly input: { readonly text: string; readonly turnId: string; readonly agentId?: string };
    readonly result: { readonly turnId: string };
  };
  readonly "turn.complete": {
    readonly input: {
      readonly answer: string;
      readonly durationMs: number;
      readonly isAborted: boolean;
      readonly turnId: string;
      readonly agentId?: string;
      readonly reason: "answer" | "aborted" | "refusal" | "error";
    };
    readonly result: { readonly text: string };
  };
};

type EventName = keyof Events;
export type Input<E extends EventName> = Events[E]["input"];
type Result<E extends EventName> = Events[E]["result"];
export type Hook<E extends EventName> = (
  $: Engine,
  e: Input<E>,
  next: (e: Input<E>) => Promise<Result<E>>,
) => Promise<Result<E>>;

/** `on(event, matcher?, hook)`, for the four events the mod hooks (`On`). */
export type On = {
  (event: "session.start", hook: Hook<"session.start">): unknown;
  (event: "tool.call", matcher: { readonly tool: string }, hook: Hook<"tool.call">): unknown;
  (event: "turn.start", hook: Hook<"turn.start">): unknown;
  (event: "turn.complete", hook: Hook<"turn.complete">): unknown;
};

/** COMPACTION's floor and prepare point (tools/lib/compaction.ts); a test holds them equal. */
export const POINTS = { floorTokens: 150_000, prepareTokens: 220_000 };
/** The idle wait after a main turn ends before a request runs, and the longest instructions. */
export const IDLE_MS = 3000;
export const MAX_INSTRUCTIONS = 2000;

const tokens = (count: number): string => count.toLocaleString("en-US");
const INSTRUCTIONS = {
  type: "string",
  minLength: 1,
  maxLength: MAX_INSTRUCTIONS,
  description:
    "What the compaction summary must keep, in plain words: for a lead, the owner's briefs " +
    "verbatim, open asks, the agents and their states, and the merge order. 1 to " +
    `${tokens(MAX_INSTRUCTIONS)} characters.`,
};

const CONTEXT_TOOL: ToolSpec = {
  name: "context",
  description:
    "The session's context: its tokens, window and percent as the engine measured them, where " +
    "that sits against the compaction points (the request floor, the Stop hook's prepare point, " +
    "automatic compaction), and the pending and last compaction request. Takes no input.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
};

const REQUEST_TOOL: ToolSpec = {
  name: "request",
  description:
    "Asks for a compaction at the end of this turn: once the main thread's turn ends and no " +
    "other starts within a few seconds, runs /compact with these instructions. One request " +
    "waits at a time, and a second replaces it. Refused from a subagent, below the request " +
    "floor, or while the context is not measured.",
  inputSchema: {
    type: "object",
    properties: { instructions: INSTRUCTIONS },
    required: ["instructions"],
    additionalProperties: false,
  },
};

/** One registration's state; `turns` counts the main turns begun. */
type Fields = {
  readonly pending: string | null;
  readonly timer: Timer | null;
  readonly turns: number;
  readonly last: string;
};

type Store = { readonly read: () => Fields; readonly write: (change: Partial<Fields>) => void };

function store(): Store {
  let fields: Fields = { pending: null, timer: null, turns: 0, last: "none in this session." };
  return {
    read: () => fields,
    write: (change) => {
      fields = { ...fields, ...change };
    },
  };
}

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const answer = (text: string) => ({ result: text });
const FLOOR = `the request floor (${tokens(POINTS.floorTokens)})`;

function placed(count: number, compactAt: number | undefined): string {
  if (compactAt !== undefined && count >= compactAt) return "past the automatic compaction point.";
  if (count >= POINTS.prepareTokens) return "past the prepare point.";
  if (count >= POINTS.floorTokens) return "past the request floor, below the prepare point.";
  return "below the request floor, so a request is refused.";
}

function contextLines(context: ContextUsage): string[] {
  const at = context.breakdown?.autoCompactThreshold;
  const auto =
    at === undefined ? "off, or not reported" : `at ${tokens(at)} (the engine's threshold)`;
  const points =
    `Points: requests from ${tokens(POINTS.floorTokens)}; the Stop hook's prepare step at ` +
    `${tokens(POINTS.prepareTokens)} (COMPACTION); automatic compaction ${auto}.`;
  if (context.tokens === undefined) {
    const unmeasured = "Context: not measured since the session started or last compacted";
    return [
      `${unmeasured} (the next response measures it); the window is ${tokens(context.window)} tokens.`,
      points,
    ];
  }
  const percent = context.percent === undefined ? "" : ` (${String(context.percent)}%)`;
  const window = `${tokens(context.window)}-token window${percent}`;
  return [
    `Context: ${tokens(context.tokens)} tokens of a ${window}.`,
    points,
    `So: ${placed(context.tokens, at)}`,
  ];
}

async function contextAnswer($: Engine, state: Store) {
  const { context } = await $.session.usage({ breakdown: "summary" });
  const { pending, last } = state.read();
  const waiting = pending === null ? "none." : `"${pending}", to run once the main turn ends.`;
  const lines = [...contextLines(context), `Pending request: ${waiting}`];
  return answer([...lines, `Last request: ${last}`].join("\n"));
}

/** Why a request is refused, or null: a subagent, bad instructions, or a context below the floor. */
async function refusal($: Engine, e: Input<"tool.call">, instructions: string | null) {
  if (e.agentId !== undefined) {
    return `only the main thread compacts the session, and this call came from a subagent (${e.agentId}).`;
  }
  if (instructions === null) {
    return `"instructions" must be text of 1 to ${tokens(MAX_INSTRUCTIONS)} characters naming what the summary must keep.`;
  }
  const { context } = await $.session.usage();
  if (context.tokens === undefined) {
    return "the context has not been measured since the session started or last compacted, so a compaction now would free nothing.";
  }
  return context.tokens < POINTS.floorTokens
    ? `the context is ${tokens(context.tokens)} tokens, below ${FLOOR}; a compaction this early frees too little for its cost.`
    : null;
}

async function requestAnswer($: Engine, e: Input<"tool.call">, state: Store) {
  const given = e["instructions"];
  const trimmed = typeof given === "string" ? given.trim() : "";
  const instructions = trimmed.length > 0 && trimmed.length <= MAX_INSTRUCTIONS ? trimmed : null;
  const refused = await refusal($, e, instructions);
  if (refused !== null || instructions === null) return answer(`Refused: ${refused ?? ""}`);
  const { pending } = state.read();
  const replaced = pending === null ? "" : ` It replaces the pending request: "${pending}".`;
  state.write({ pending: instructions });
  return answer(
    `Recorded. The mod runs /compact with these instructions ${String(IDLE_MS / 1000)} s after ` +
      "this main turn ends, unless another turn starts first; automatic compaction stays the " +
      `backstop.${replaced}`,
  );
}

/** Runs the pending request from the timer, unless a main turn began or the context fell. */
async function runPending($: Engine, state: Store): Promise<void> {
  const begun = state.read().turns;
  const { context } = await $.session.usage();
  const { pending, turns } = state.read();
  if (pending === null || turns !== begun) return;
  state.write({ pending: null });
  if (context.tokens === undefined || context.tokens < POINTS.floorTokens) {
    const was =
      context.tokens === undefined
        ? "not measured when it was due; a compaction may have run."
        : `${tokens(context.tokens)} tokens when it was due, below ${FLOOR}; an automatic compaction may have run.`;
    state.write({ last: `dropped, as the context was ${was}` });
    return;
  }
  try {
    await $.command.run({ command: "compact", args: pending });
    state.write({ last: `ran /compact at ${tokens(context.tokens)} tokens.` });
  } catch (error: unknown) {
    state.write({ last: `/compact did not run: ${reason(error)}.` });
  }
}

/** The timer's callback, outside every hook, so the command waits on no turn. */
function fire($: Engine, state: Store): void {
  state.write({ timer: null });
  runPending($, state).catch((error: unknown) => {
    const why = `(${reason(error)}); it waits for the next turn's end.`;
    state.write({ last: `the context could not be read when it was due ${why}` });
  });
}

export function register(on: On): void {
  const state = store();
  on("session.start", async ($, e, next) => {
    const result = await next(e);
    await $.tool.register(CONTEXT_TOOL);
    await $.tool.register(REQUEST_TOOL);
    return result;
  });
  on("tool.call", { tool: "mcp__compaction__context" }, ($) => contextAnswer($, state));
  on("tool.call", { tool: "mcp__compaction__request" }, ($, e) => requestAnswer($, e, state));
  on("turn.start", (_, e, next) => {
    if (e.agentId === undefined) {
      const { timer, turns } = state.read();
      timer?.cancel();
      state.write({ timer: null, turns: turns + 1 });
    }
    return next(e);
  });
  on("turn.complete", ($, e, next) => {
    if (e.agentId !== undefined) return next(e);
    const { pending, timer } = state.read();
    if (e.reason === "answer" && pending !== null && timer === null) {
      const fires = () => {
        fire($, state);
      };
      state.write({ timer: $.clock.after(IDLE_MS, fires) });
    }
    return next(e);
  });
}
