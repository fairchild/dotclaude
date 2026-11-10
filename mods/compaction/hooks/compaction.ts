/**
 * The compaction mod: the main thread compacts at a moment it chooses, with
 * instructions for the summary and a prompt to resume on. `mcp__compaction__context` answers
 * `$.session.usage()` against its points and the engine's auto-compaction threshold, so no value here has to match the settings;
 * `mcp__compaction__request` records one pending request (a second replaces it), refusing a
 * subagent, bad instructions, and a context below the floor or not yet measured. Both points
 * derive from one goal, the default context target the thread may run past on judgement, which
 * the manifest's `userConfig` carries: `/config` or `claude plugin configure compaction` moves
 * it, and either point takes an override. Every request is kept in `$.store`, its reasoning with it, so what
 * the points are worth can be read back over sessions (LOG_KEY, LOG_LIMIT entries).
 *
 * A main turn that ends with an answer arms one timer (IDLE_MS); a main turn that starts cancels
 * it. When it fires, a main turn running keeps the request for that turn's end, and another
 * compaction under way or a context below the floor drops it; otherwise `/compact` runs once
 * through the command call and, once its compaction went through the `session.compact` hook (the
 * command resolves even when it could not compact), the mod submits the request's `resume`, or
 * RESUME_DEFAULT: a compaction lands between turns, and the session would otherwise sit idle. A
 * resume beginning with "/" is refused, as the engine submits no command for a mod. Any other
 * main-loop compaction but a precompute (a typed `/compact`, which starts no turn, the engine's,
 * another plugin's) that goes through drops a waiting request, so the session never compacts twice.
 * Beside the main thread's first prompt past the prepare point, and again beside the first after
 * any main-loop compaction but its own, the mod attaches a note the model reads and the person
 * never sees: the procedure (prepareNote), then the rebuild from live reads (AFTER_NOTE). A
 * slash command's prompt carries neither. State is lost on a reload. Its other hooks pass each
 * event on unchanged; its tool hooks answer only its own two tools. `claude plugin validate
 * --json mods/compaction` lists its hooks and `$` calls, the tests hold the command to `compact`
 * and the submitted text to the request's, and the types narrow Claude Code 2.1.316's mod API to
 * what the mod uses.
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

/** The engine interface (`$`), narrowed to the calls the mod makes. */
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
  /** `submit` starts a turn of its own with `text` once the session is idle, framed as the mod's. */
  readonly prompt: {
    readonly submit: (args: { readonly text: string }) => Promise<unknown>;
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
  readonly "prompt.submit": {
    /** A prompt about to enter: a slash command's carries `command`; `context` is read beside it, never shown. */
    readonly input: {
      readonly text: string;
      readonly command?: unknown;
      readonly context?: readonly string[];
    };
    readonly result: unknown;
  };
  readonly "session.compact": {
    /** Who compacts, and the loop (absent on the main loop); the transcript is not read. */
    readonly input: {
      readonly trigger: "manual" | "auto" | "plugin" | "precompute";
      readonly agentId?: string;
    };
    readonly result: unknown;
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

/** `on(event, matcher?, hook)`, for the six events the mod hooks (`On`). */
export type On = {
  (event: "session.start", hook: Hook<"session.start">): unknown;
  (event: "tool.call", matcher: { readonly tool: string }, hook: Hook<"tool.call">): unknown;
  (event: "prompt.submit", hook: Hook<"prompt.submit">): unknown;
  (event: "turn.start", hook: Hook<"turn.start">): unknown;
  (event: "turn.complete", hook: Hook<"turn.complete">): unknown;
  (event: "session.compact", hook: Hook<"session.compact">): unknown;
};

/** The goal and the two points a request is judged against, in tokens. */
export type Points = {
  readonly goalTokens: number;
  readonly floorTokens: number;
  readonly prepareTokens: number;
};

/** The default context target when the manifest's goal is unset; past it, compacting is the thread's judgement. */
export const GOAL_TOKENS = 300_000;
/**
 * What the prepare point leaves below the goal: a closing turn, a resume file, the request,
 * the idle wait and the /compact round trip. A turn's tail is a turn's tail, so this is an
 * absolute, where the floor is a share of the goal.
 */
export const RUNWAY_TOKENS = 80_000;
/** What the engine keeps below its compaction window, the `W - 33000` arm of its own point. */
export const BACKSTOP_TOKENS = 33_000;
/** How far the engine's point may sit from the goal's before the report names the setting. */
export const DRIFT_TOKENS = 10_000;

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
export const MAX_RESUME = 2000;
/** What the thread is told after a compaction it asked for, when its request named no resume. */
export const RESUME_DEFAULT =
  "The compaction you requested has run. Pick the work in progress up from live reads (branches, pull requests, checks, running processes), with the summary as a guide to them; if it was waiting on someone, say what it waits on and stop.";
/**
 * What the main thread reads beside its first prompt past the prepare point, once between
 * compactions: the procedure, at the moment it is due.
 */
export const prepareNote = (p: Points, count: number): string =>
  `The context is at ${tokens(count)} tokens, past the prepare point (${tokens(p.prepareTokens)}) ` +
  `of the ${tokens(p.goalTokens)} goal. To compact near the goal, write what must survive to disk ` +
  "or the tracker first (a resume file, the arc's tracking issue), then call " +
  'mcp__compaction__request with "instructions" (what the summary keeps, named exactly), ' +
  '"reasoning", and "resume" (what to pick up first and where its state lives). Carry on instead ' +
  "while compacting would lose live work. The compaction-handoff skill has the long form.";
/** What the main thread reads beside its first prompt after a main-loop compaction went through. */
export const AFTER_NOTE =
  "This session has compacted. The summary carries what the session believed, mistakes included: " +
  "rebuild from live reads (the resume file, branches, pull requests, checks, running processes) " +
  "before acting on it.";
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

const RESUME = {
  type: "string",
  minLength: 1,
  maxLength: MAX_RESUME,
  description:
    "The prompt the mod submits once the compaction has run, starting the first turn after it: " +
    "what to pick up and where its state lives, as you would want to read it then. Absent, a " +
    `generic prompt to continue. 1 to ${tokens(MAX_RESUME)} characters, not beginning with "/".`,
};

const CONTEXT_TOOL: ToolSpec = {
  name: "context",
  description:
    "The session's context: its tokens, window and percent as the engine measured them, where " +
    "that sits against the goal and the compaction points (the request floor, the prepare point " +
    "where a thread stopping at the goal starts getting ready, automatic compaction), and the pending and last compaction request. Takes no input.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
};

const REQUEST_TOOL: ToolSpec = {
  name: "request",
  description:
    "Asks for a compaction at the end of this turn: once the main thread's turn ends and no " +
    "other starts within a few seconds, runs /compact with these instructions, then submits " +
    "the resume prompt (or a generic one) so the next turn starts on its own. One request " +
    "waits at a time, and a second replaces it. Refused from a subagent, below the request " +
    "floor, or while the context is not measured. Its reasoning is kept across sessions.",
  inputSchema: {
    type: "object",
    properties: { instructions: INSTRUCTIONS, reasoning: REASONING, resume: RESUME },
    required: ["instructions", "reasoning"],
    additionalProperties: false,
  },
};

/** One request as the thread made it: what the summary must keep, why now, and what to resume on. */
export type Request = {
  readonly instructions: string;
  readonly reasoning: string;
  readonly resume?: string;
};

/** One request as the store keeps it: what was asked, where, and what became of it. */
export type Entry = Request & {
  readonly at: number;
  readonly outcome:
    | "recorded"
    | "refused"
    | "ran"
    | "dropped"
    | "failed"
    | "resumed"
    | "unresumed";
  readonly tokens: number | null;
  readonly window: number;
  readonly goalTokens: number;
  readonly floorTokens: number;
  readonly prepareTokens: number;
  readonly autoAt: number | null;
  readonly why?: string;
};

/**
 * One registration's state: `ours` marks the mod's /compact sent, `through` its compaction done,
 * `prepared` the prepare note given since the last compaction, `compacted` the after note owed.
 */
type Fields = {
  readonly pending: Request | null;
  readonly timer: Timer | null;
  readonly active: boolean;
  readonly last: string;
  readonly compacting: number;
  readonly ours: boolean;
  readonly through: boolean;
  readonly prepared: boolean;
  readonly compacted: boolean;
};

type Store = { readonly read: () => Fields; readonly write: (change: Partial<Fields>) => void };

function store(): Store {
  let fields: Fields = {
    pending: null,
    timer: null,
    active: false,
    last: "none in this session.",
    compacting: 0,
    ours: false,
    through: false,
    prepared: false,
    compacted: false,
  };
  return {
    read: () => fields,
    write: (change) => {
      fields = { ...fields, ...change };
    },
  };
}

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * The text an engine answer carries under `key`: a /compact's output (which resolves, not
 * throws, when the compaction fails: "Not enough messages to compact."), a submit's `drop`.
 */
function said(answer: unknown, key: string): string | undefined {
  if (typeof answer !== "object" || answer === null) return undefined;
  const value: unknown = (answer as Readonly<Record<string, unknown>>)[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Appends one request, the points and the context it was judged against stamped on it: the
 * newest LOG_LIMIT, the oldest dropped.
 *
 * Every call the reading needs sits inside the guard, the clock's among them. A caller has
 * already taken the request out of the state by the time it logs, so a throw escaping here
 * would lose that request and leave the timer's catch reporting a wait that is not coming.
 */
async function log(
  $: Engine,
  p: Points,
  request: Request,
  outcome: Entry["outcome"],
  context: ContextUsage,
  why?: string,
): Promise<void> {
  try {
    const entry: Entry = {
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
    const kept = await $.store.get(LOG_KEY);
    const entries = Array.isArray(kept) ? (kept as readonly Entry[]) : [];
    await $.store.set(LOG_KEY, [...entries, entry].slice(-LOG_LIMIT));
  } catch {
    // The reading is worth less than the compaction it describes.
  }
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
 * What to say about where the engine compacts, in three bands. Above the goal, the gap is room
 * the thread may run into on judgement. From the goal's implied point (less DRIFT_TOKENS) up to
 * the goal, the engine's point is the goal's own backstop, and there is nothing to say. Below
 * that, the goal is never reached; the mod never moves the engine's point, so the note names the
 * settings that do: the window, or the percentage when the window already reaches the goal. A goal
 * wider than the model's window is out of every setting's reach, so only the goal can move.
 */
function settingLine(p: Points, at: number, window: number): string | null {
  if (at > p.goalTokens)
    return (
      `Note: the engine compacts at ${tokens(at)}; past the ${tokens(p.goalTokens)} goal, ` +
      "compacting is the thread's call up to there."
    );
  if (at >= backstop(p) - DRIFT_TOKENS) return null;
  if (p.goalTokens > window)
    return (
      `Note: the ${tokens(p.goalTokens)} goal is wider than this model's ${tokens(window)}-token ` +
      `window, so it is never reached and no setting moves the engine, at ${tokens(at)}, past it. ` +
      `Set the goal to ${tokens(Math.min(window, at + BACKSTOP_TOKENS))}.`
    );
  return (
    `Note: the engine compacts at ${tokens(at)}, below the ${tokens(backstop(p))} this goal ` +
    "implies, so the goal is never reached. Set `autoCompactWindow` to at least " +
    `${tokens(p.goalTokens)}; if it already is, the percentage in ` +
    "`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` binds first, and raising it toward 100 moves the point. " +
    `Or set the goal to ${tokens(at + BACKSTOP_TOKENS)}.`
  );
}

function contextLines(p: Points, context: ContextUsage): string[] {
  const at = context.breakdown?.autoCompactThreshold;
  const auto =
    at === undefined ? "off, or not reported" : `at ${tokens(at)} (the engine's threshold)`;
  const line =
    `Points: a goal of ${tokens(p.goalTokens)}; requests from ${tokens(p.floorTokens)}; the ` +
    `prepare point at ${tokens(p.prepareTokens)}; automatic compaction ${auto}.`;
  const note = at === undefined ? null : settingLine(p, at, context.window);
  const drift = note === null ? [] : [note];
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
    return `"instructions" must be text of 1 to ${tokens(MAX_INSTRUCTIONS)} characters naming what the summary must keep, "reasoning" text of 1 to ${tokens(MAX_REASONING)} characters saying why compact now, and "resume", when given, text of 1 to ${tokens(MAX_RESUME)} characters to start the next turn on, not beginning with "/", since the engine submits no command for a mod.`;
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

/** A resume prompt that reads as prose: one beginning with "/" is a command, which `$.prompt.submit` refuses. */
const prose = (given: string | null): string | null => (given?.startsWith("/") ? null : given);

async function requestAnswer($: Engine, p: Points, e: Input<"tool.call">, state: Store) {
  const instructions = text(e, "instructions", MAX_INSTRUCTIONS);
  const reasoning = text(e, "reasoning", MAX_REASONING);
  const resume = e["resume"] === undefined ? undefined : prose(text(e, "resume", MAX_RESUME));
  const request =
    instructions === null || reasoning === null || resume === null
      ? null
      : { instructions, reasoning, ...(resume === undefined ? {} : { resume }) };
  const refused = await refusal($, p, e, request);
  if (refused !== null || request === null) {
    const { context } = await $.session.usage({ breakdown: "summary" });
    const asked = request ?? {
      instructions: instructions ?? "",
      reasoning: reasoning ?? "",
      ...(typeof resume === "string" ? { resume } : {}),
    };
    await log($, p, asked, "refused", context, refused ?? "");
    return answer(`Refused: ${refused ?? ""}`);
  }
  const { context } = await $.session.usage({ breakdown: "summary" });
  const { pending } = state.read();
  const replaced =
    pending === null ? "" : ` It replaces the pending request: "${pending.instructions}".`;
  state.write({ pending: request });
  await log($, p, request, "recorded", context);
  return answer(
    `Recorded. The mod runs /compact with these instructions ${String(IDLE_MS / 1000)} s after ` +
      "this main turn ends, unless another turn starts first, then submits " +
      `${request.resume === undefined ? "a generic prompt to continue" : "your resume prompt"}; ` +
      `automatic compaction stays the backstop.${replaced}`,
  );
}

/**
 * Runs the pending request from the timer. A main turn running leaves it for that turn's end;
 * another compaction under way, before or after the context is read, drops it.
 */
async function runPending($: Engine, p: Points, state: Store): Promise<void> {
  const { pending, compacting } = state.read();
  if (pending === null) return;
  const { context } = await $.session.usage({ breakdown: "summary" });
  const now = state.read();
  if (now.pending !== pending || now.active) return;
  state.write({ pending: null });
  const count = context.tokens;
  const why =
    compacting + now.compacting > 0
      ? "another compaction was under way when it was due."
      : count === undefined
        ? "the context was not measured when it was due; a compaction may have run."
        : count < p.floorTokens
          ? `the context was ${tokens(count)} tokens when it was due, below ${floor(p)}; an automatic compaction may have run.`
          : null;
  if (why !== null) {
    state.write({ last: `dropped, as ${why}` });
    await log($, p, pending, "dropped", context, why);
    return;
  }
  state.write({ ours: true, through: false });
  let failed: string | null;
  try {
    const output = await $.command.run({ command: "compact", args: pending.instructions });
    failed = state.read().through ? null : (said(output, "text") ?? "no compaction ran");
  } catch (error: unknown) {
    failed = reason(error);
  }
  state.write({ ours: false, through: false });
  if (failed !== null) {
    state.write({ last: `/compact did not run: ${failed}.` });
    await log($, p, pending, "failed", context, failed);
    return;
  }
  const ran = `ran /compact at ${tokens(count ?? 0)} tokens`;
  state.write({ last: `${ran}.` });
  await log($, p, pending, "ran", context);
  await submitResume($, p, pending, context, ran, state);
}

/**
 * Starts the first turn after the compaction; its failure is its own, the compaction having run.
 * The resume prompt is the thread's own word on what comes next, so no after note is owed.
 */
async function submitResume(
  $: Engine,
  p: Points,
  pending: Request,
  context: ContextUsage,
  ran: string,
  state: Store,
): Promise<void> {
  state.write({ compacted: false });
  try {
    const entered = await $.prompt.submit({ text: pending.resume ?? RESUME_DEFAULT });
    const dropped = said(entered, "drop");
    if (dropped !== undefined) throw new Error(dropped);
    state.write({ last: `${ran}, then submitted the resume prompt.` });
    await log($, p, pending, "resumed", context);
  } catch (error: unknown) {
    const why = reason(error);
    state.write({ last: `${ran}, but the resume prompt did not submit: ${why}.` });
    await log($, p, pending, "unresumed", context, why);
  }
}

/**
 * A main-loop compaction other than a precompute that goes through while a request waits (a
 * typed /compact, the engine's own, another plugin's) drops the pending request: its context is
 * spent, and running it as well would compact twice and resume on a summary the request never
 * asked for. The mod's own compaction finds nothing pending, as the request leaves the state
 * before its /compact runs.
 */
async function yieldTo($: Engine, p: Points, trigger: string, state: Store): Promise<void> {
  const { pending, timer } = state.read();
  if (pending === null) return;
  timer?.cancel();
  const why = `a ${trigger} compaction ran first.`;
  state.write({ pending: null, timer: null, last: `dropped, as ${why}` });
  try {
    const { context } = await $.session.usage({ breakdown: "summary" });
    await log($, p, pending, "dropped", context, why);
  } catch {
    // The reading is worth less than the compaction it describes.
  }
}

/**
 * A main-loop compaction other than a precompute. The first to start after the mod's /compact
 * is sent is that /compact's, and going through marks it run; any other that goes through
 * drops a waiting request. One skipped or failed changes nothing.
 */
async function compaction<R>($: Engine, p: Points, trigger: string, state: Store, run: () => Promise<R>): Promise<R> {
  const mine = state.read().ours;
  state.write({ ours: false, compacting: state.read().compacting + 1 });
  try {
    const result = await run();
    if (said(result, "skip") === undefined) {
      state.write({ prepared: false, compacted: true });
      if (mine) state.write({ through: true });
      else await yieldTo($, p, trigger, state);
    }
    return result;
  } finally {
    state.write({ compacting: state.read().compacting - 1 });
  }
}

/** The note a prompt carries: the after note once a compaction went through, else the prepare note once. */
async function noteFor($: Engine, p: Points, state: Store): Promise<string | null> {
  const { compacted, prepared, pending } = state.read();
  if (compacted) {
    state.write({ compacted: false });
    return AFTER_NOTE;
  }
  if (prepared || pending !== null) return null;
  const { context } = await $.session.usage();
  if (context.tokens === undefined || context.tokens < p.prepareTokens) return null;
  state.write({ prepared: true });
  return prepareNote(p, context.tokens);
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
  on("session.compact", ($, e, next) =>
    e.agentId !== undefined || e.trigger === "precompute"
      ? next(e)
      : compaction($, p, e.trigger, state, () => next(e)),
  );
  on("prompt.submit", async ($, e, next) => {
    if (e.command !== undefined) return next(e);
    const note = await noteFor($, p, state).catch(() => null);
    return next(note === null ? e : { ...e, context: [...(e.context ?? []), note] });
  });
  on("turn.start", (_, e, next) => {
    if (e.agentId === undefined) {
      state.read().timer?.cancel();
      state.write({ timer: null, active: true });
    }
    return next(e);
  });
  on("turn.complete", ($, e, next) => {
    if (e.agentId !== undefined) return next(e);
    state.write({ active: false });
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
