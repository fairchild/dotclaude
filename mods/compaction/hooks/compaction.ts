/**
 * The compaction mod: the main thread compacts at a moment it chooses, with
 * instructions for the summary. `mcp__compaction__context` answers `$.session.usage()` against
 * its points and the engine's auto-compaction threshold, so no value here has to match the settings;
 * `mcp__compaction__request` records one pending request (a second replaces it), refusing a
 * subagent, bad instructions, and a context below the floor or not yet measured. Both points
 * derive from one goal, the context the session means to stay under, which the manifest's
 * `userConfig` carries: `/config` or `claude plugin configure compaction` moves it, and either
 * point takes an override. Every request is kept in `$.store`, its reasoning with it, so what
 * the points are worth can be read back over sessions (LOG_KEY, LOG_LIMIT entries).
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

/** The plugin's configuration as `register` receives it (`PluginOptions`). */
export type Options = Readonly<Record<string, string | number | boolean | readonly string[]>>;

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
  /** `now` reads the wall clock; `after` calls `fn` once after `ms`, outside any hook, unless cancelled first. */
  readonly clock: {
    readonly now: () => Promise<number>;
    readonly after: (ms: number, fn: () => void) => Timer;
  };
  /** The mod's own JSON file under the configuration directory, across sessions. */
  readonly store: {
    readonly get: (key: string) => Promise<unknown>;
    readonly set: (key: string, value: unknown) => Promise<void>;
  };
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

/** The goal and the two points a request is judged against, in tokens. */
export type Points = {
  readonly goalTokens: number;
  readonly floorTokens: number;
  readonly prepareTokens: number;
};

/** The context a session means to stay under when its manifest's goal is unset. */
export const GOAL_TOKENS = 300_000;
/**
 * What the prepare point leaves below the goal: a closing turn, a resume file, the request,
 * the idle wait and the /compact round trip. A turn's tail is a turn's tail, so this is an
 * absolute, where the floor is a share of the goal.
 */
export const RUNWAY_TOKENS = 80_000;
/** What the engine keeps below its compaction window, the `W - 33000` arm of its own point. */
export const BACKSTOP_TOKENS = 33_000;

const whole = (given: unknown): number | null =>
  typeof given === "number" && Number.isInteger(given) && given > 0 ? given : null;

/**
 * The points this activation runs on. The goal is the one value worth setting; the floor
 * (half of it) and the prepare point (it less the runway) derive, and an override that is a
 * whole number above zero replaces either. The prepare point never falls below the floor,
 * since a prepare step under it would name a request the mod refuses.
 */
export function points(options: Options): Points {
  const goalTokens = whole(options["goalTokens"]) ?? GOAL_TOKENS;
  const floorTokens = whole(options["floorTokens"]) ?? Math.round(goalTokens / 2);
  const prepare = whole(options["prepareTokens"]) ?? goalTokens - RUNWAY_TOKENS;
  return { goalTokens, floorTokens, prepareTokens: Math.max(floorTokens, prepare) };
}

/** Where the engine's own point would sit for this goal, its `W - 33000` arm. */
const backstop = (p: Points): number => p.goalTokens - BACKSTOP_TOKENS;
/** The idle wait after a main turn ends before a request runs, and the longest texts. */
export const IDLE_MS = 3000;
export const MAX_INSTRUCTIONS = 2000;
export const MAX_REASONING = 400;
/** Where the requests are kept, and how many: the newest LOG_LIMIT, oldest dropped. */
export const LOG_KEY = "requests";
export const LOG_LIMIT = 200;

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

const REASONING = {
  type: "string",
  minLength: 1,
  maxLength: MAX_REASONING,
  description:
    "Why compact now rather than later, in a sentence or two: what the context is holding that " +
    "is spent, and what the next stretch of work needs. Kept across sessions, so the points " +
    "can be judged against the moments they were asked for. 1 to " +
    `${tokens(MAX_REASONING)} characters.`,
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
    "floor, or while the context is not measured. Its reasoning is kept across sessions.",
  inputSchema: {
    type: "object",
    properties: { instructions: INSTRUCTIONS, reasoning: REASONING },
    required: ["instructions", "reasoning"],
    additionalProperties: false,
  },
};

/** One registration's state; `turns` counts the main turns begun. */
/** One request as the thread made it: what the summary must keep, and why now. */
export type Request = { readonly instructions: string; readonly reasoning: string };

/** One request as the store keeps it: what was asked, where, and what became of it. */
export type Entry = Request & {
  readonly at: number;
  readonly outcome: "recorded" | "refused" | "ran" | "dropped" | "failed";
  readonly tokens: number | null;
  readonly window: number;
  readonly goalTokens: number;
  readonly floorTokens: number;
  readonly prepareTokens: number;
  readonly autoAt: number | null;
  readonly why?: string;
};

type Fields = {
  readonly pending: Request | null;
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

/** Appends one entry, dropping the oldest past LOG_LIMIT; a store that refuses is let go. */
async function log($: Engine, entry: Entry): Promise<void> {
  try {
    const kept = await $.store.get(LOG_KEY);
    const entries = Array.isArray(kept) ? (kept as readonly Entry[]) : [];
    await $.store.set(LOG_KEY, [...entries, entry].slice(-LOG_LIMIT));
  } catch {
    // The reading is worth less than the compaction it describes.
  }
}

/** One entry, the points and the context it was judged against stamped on it. */
async function entry(
  $: Engine,
  p: Points,
  request: Request,
  outcome: Entry["outcome"],
  context: ContextUsage,
  why?: string,
): Promise<Entry> {
  return {
    ...request,
    at: await $.clock.now(),
    outcome,
    tokens: context.tokens ?? null,
    window: context.window,
    goalTokens: p.goalTokens,
    floorTokens: p.floorTokens,
    prepareTokens: p.prepareTokens,
    autoAt: context.breakdown?.autoCompactThreshold ?? null,
    ...(why === undefined ? {} : { why }),
  };
}
const answer = (text: string) => ({ result: text });
const floor = (p: Points): string => `the request floor (${tokens(p.floorTokens)})`;

function placed(p: Points, count: number, compactAt: number | undefined): string {
  if (compactAt !== undefined && count >= compactAt) return "past the automatic compaction point.";
  if (count >= p.prepareTokens) return "past the prepare point.";
  if (count >= p.floorTokens) return "past the request floor, below the prepare point.";
  return "below the request floor, so a request is refused.";
}

/**
 * What to say when the engine compacts somewhere else than the goal implies: the mod reports
 * the engine's point and never moves it, and `autoCompactWindow` is where that one is set.
 */
function settingLine(p: Points, at: number): string {
  return (
    `Note: the engine compacts at ${tokens(at)}, not the ${tokens(backstop(p))} this goal ` +
    "implies. Only the `autoCompactWindow` setting moves that one; set it to " +
    `${tokens(p.goalTokens)} to line them up, or set the goal to ${tokens(at + BACKSTOP_TOKENS)}.`
  );
}

function contextLines(p: Points, context: ContextUsage): string[] {
  const at = context.breakdown?.autoCompactThreshold;
  const auto =
    at === undefined ? "off, or not reported" : `at ${tokens(at)} (the engine's threshold)`;
  const line =
    `Points: a goal of ${tokens(p.goalTokens)}; requests from ${tokens(p.floorTokens)}; the ` +
    `prepare point at ${tokens(p.prepareTokens)}; automatic compaction ${auto}.`;
  const drift = at === undefined || Math.abs(at - backstop(p)) <= 10_000 ? [] : [settingLine(p, at)];
  if (context.tokens === undefined) {
    const unmeasured = "Context: not measured since the session started or last compacted";
    return [
      `${unmeasured} (the next response measures it); the window is ${tokens(context.window)} tokens.`,
      line,
      ...drift,
    ];
  }
  const percent = context.percent === undefined ? "" : ` (${String(context.percent)}%)`;
  const window = `${tokens(context.window)}-token window${percent}`;
  return [
    `Context: ${tokens(context.tokens)} tokens of a ${window}.`,
    line,
    ...drift,
    `So: ${placed(p, context.tokens, at)}`,
  ];
}

async function contextAnswer($: Engine, p: Points, state: Store) {
  const { context } = await $.session.usage({ breakdown: "summary" });
  const { pending, last } = state.read();
  const waiting =
    pending === null ? "none." : `"${pending.instructions}", to run once the main turn ends.`;
  const lines = [...contextLines(p, context), `Pending request: ${waiting}`];
  return answer([...lines, `Last request: ${last}`].join("\n"));
}

/** Why a request is refused, or null: a subagent, a bad text, or a context below the floor. */
async function refusal($: Engine, p: Points, e: Input<"tool.call">, request: Request | null) {
  if (e.agentId !== undefined) {
    return `only the main thread compacts the session, and this call came from a subagent (${e.agentId}).`;
  }
  if (request === null) {
    return `"instructions" must be text of 1 to ${tokens(MAX_INSTRUCTIONS)} characters naming what the summary must keep, and "reasoning" text of 1 to ${tokens(MAX_REASONING)} characters saying why compact now.`;
  }
  const { context } = await $.session.usage();
  if (context.tokens === undefined) {
    return "the context has not been measured since the session started or last compacted, so a compaction now would free nothing.";
  }
  return context.tokens < p.floorTokens
    ? `the context is ${tokens(context.tokens)} tokens, below ${floor(p)}; a compaction this early frees too little for its cost.`
    : null;
}

/** The text under `field`, trimmed, or null where it is missing or longer than `most`. */
function text(e: Input<"tool.call">, field: string, most: number): string | null {
  const given = e[field];
  const trimmed = typeof given === "string" ? given.trim() : "";
  return trimmed.length > 0 && trimmed.length <= most ? trimmed : null;
}

async function requestAnswer($: Engine, p: Points, e: Input<"tool.call">, state: Store) {
  const instructions = text(e, "instructions", MAX_INSTRUCTIONS);
  const reasoning = text(e, "reasoning", MAX_REASONING);
  const request =
    instructions === null || reasoning === null ? null : { instructions, reasoning };
  const refused = await refusal($, p, e, request);
  if (refused !== null || request === null) {
    const { context } = await $.session.usage({ breakdown: "summary" });
    const asked = request ?? {
      instructions: instructions ?? "",
      reasoning: reasoning ?? "",
    };
    await log($, await entry($, p, asked, "refused", context, refused ?? ""));
    return answer(`Refused: ${refused ?? ""}`);
  }
  const { context } = await $.session.usage({ breakdown: "summary" });
  const { pending } = state.read();
  const replaced =
    pending === null ? "" : ` It replaces the pending request: "${pending.instructions}".`;
  state.write({ pending: request });
  await log($, await entry($, p, request, "recorded", context));
  return answer(
    `Recorded. The mod runs /compact with these instructions ${String(IDLE_MS / 1000)} s after ` +
      "this main turn ends, unless another turn starts first; automatic compaction stays the " +
      `backstop.${replaced}`,
  );
}

/** Runs the pending request from the timer, unless a main turn began or the context fell. */
async function runPending($: Engine, p: Points, state: Store): Promise<void> {
  const begun = state.read().turns;
  const { context } = await $.session.usage({ breakdown: "summary" });
  const { pending, turns } = state.read();
  if (pending === null || turns !== begun) return;
  state.write({ pending: null });
  if (context.tokens === undefined || context.tokens < p.floorTokens) {
    const was =
      context.tokens === undefined
        ? "not measured when it was due; a compaction may have run."
        : `${tokens(context.tokens)} tokens when it was due, below ${floor(p)}; an automatic compaction may have run.`;
    state.write({ last: `dropped, as the context was ${was}` });
    await log($, await entry($, p, pending, "dropped", context, was));
    return;
  }
  try {
    await $.command.run({ command: "compact", args: pending.instructions });
    state.write({ last: `ran /compact at ${tokens(context.tokens)} tokens.` });
    await log($, await entry($, p, pending, "ran", context));
  } catch (error: unknown) {
    const why = reason(error);
    state.write({ last: `/compact did not run: ${why}.` });
    await log($, await entry($, p, pending, "failed", context, why));
  }
}

/** The timer's callback, outside every hook, so the command waits on no turn. */
function fire($: Engine, p: Points, state: Store): void {
  state.write({ timer: null });
  runPending($, p, state).catch((error: unknown) => {
    const why = `(${reason(error)}); it waits for the next turn's end.`;
    state.write({ last: `the context could not be read when it was due ${why}` });
  });
}

export function register(on: On, options: Options): void {
  const state = store();
  const p = points(options);
  on("session.start", async ($, e, next) => {
    const result = await next(e);
    await $.tool.register(CONTEXT_TOOL);
    await $.tool.register(REQUEST_TOOL);
    return result;
  });
  on("tool.call", { tool: "mcp__compaction__context" }, ($) => contextAnswer($, p, state));
  on("tool.call", { tool: "mcp__compaction__request" }, ($, e) => requestAnswer($, p, e, state));
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
        fire($, p, state);
      };
      state.write({ timer: $.clock.after(IDLE_MS, fires) });
    }
    return next(e);
  });
}
