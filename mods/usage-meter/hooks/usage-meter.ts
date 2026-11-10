/**
 * The usage-meter mod: one tool, `mcp__usage-meter__reading`, that answers the account's usage
 * windows (five-hour and seven-day: percent used and reset time) from `$.session.usage()`, so an
 * agent reads the meter at a checkpoint with one tool call instead of asking a person for it.
 *
 * It only observes. Its `session.start` hook passes the event on unchanged and registers the
 * tool; its `tool.call` hook answers only its own tool, by name. It approves, denies or rewrites
 * no other tool call, adds nothing to any model call (the reading reaches the model only as this
 * tool's answer, so prompt caching is untouched), reads no environment, writes no file, logs
 * nothing and makes no network call. `claude plugin validate --json mods/usage-meter` lists its
 * hooks and engine calls the way the engine will read them, so each `on(...)` names its event and
 * matcher as literals, and each engine call is spelled `$.noun.call(...)`.
 */
/*
 * The part of Claude Code's mod API (2.1.310) this mod uses, written as a local shape: the
 * engine's own declarations (`claude-code`, about 22,600 lines) are generated per build and are
 * not in this repository. Each name and field is copied from that file's shape, narrowed to what
 * the mod reads or calls, so a call to any other noun (`$.http`, `$.process`, `$.prompt`, `$.fs`,
 * `$.env`) does not type-check here. It proves nothing about the engine: `pnpm gates mods` checks
 * what the engine sees, through `claude plugin validate`. It is in this file because the gate lets
 * a mod hold no file but its manifest, its hooks file and the modules that file names; the types
 * are erased, and the test imports them from here.
 */

/** One rate-limit window as the engine reports it (`SessionRateLimit`). */
export type RateLimit = {
  /** `five_hour`, `seven_day`, or a gateway's `spend_limit`. */
  readonly kind: string;
  /** 0 to 100, with at most one decimal. */
  readonly percentUsed: number;
  /** An ISO 8601 timestamp. */
  readonly resetsAt?: string;
};

/** What `$.tool.register` takes (`ToolSpec`), the fields the mod sets. */
export type ToolSpec = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema?: Readonly<Record<string, unknown>>;
};

/** The engine interface (`$`), narrowed to the two calls the mod makes. */
export type Engine = {
  readonly session: {
    /** `SessionUsage`, narrowed: the windows the session's last API response reported. */
    readonly usage: () => Promise<{ readonly rateLimits: readonly RateLimit[] }>;
  };
  readonly tool: {
    /** Resolves the registered tool's full name, `mcp__<plugin>__<name>`. */
    readonly register: (tool: ToolSpec) => Promise<{ readonly tool: string }>;
  };
};

/** Each event the mod hooks: its input and what `next(e)` resolves to, narrowed. */
type Events = {
  readonly "session.start": {
    readonly input: { readonly isInteractive: boolean; readonly surface: string | null };
    readonly result: unknown;
  };
  readonly "tool.call": {
    readonly input: {
      readonly tool: string;
      readonly tool_use_id: string;
      readonly agentId?: string;
    };
    /** `ToolCallResult`, narrowed to its two arms: a refusal, or the tool's answer. */
    readonly result: { readonly deny: string } | { readonly result: unknown };
  };
};

type EventName = keyof Events;
export type Input<E extends EventName> = Events[E]["input"];
type Result<E extends EventName> = Events[E]["result"];
type Next<E extends EventName> = (e: Input<E>) => Promise<Result<E>>;

export type Hook<E extends EventName> = (
  $: Engine,
  e: Input<E>,
  next: Next<E>,
) => Promise<Result<E>>;

/** `on(event, matcher?, hook)`, for the two events the mod hooks (`On`). */
export type On = {
  (event: "session.start", hook: Hook<"session.start">): unknown;
  (event: "tool.call", matcher: { readonly tool: string }, hook: Hook<"tool.call">): unknown;
};

const DESCRIPTION =
  "The account's usage windows (five-hour and seven-day): percent used and reset time, as the " +
  "session's last API response reported them. Takes no input.";

function windowLine(limit: RateLimit): string {
  const resets =
    limit.resetsAt === undefined ? "reset time not reported" : `resets ${limit.resetsAt}`;
  return `${limit.kind}: ${String(limit.percentUsed)}% used, ${resets}`;
}

/** At the session's start: passes the event on, then registers the tool once the session binds. */
const sessionStart: Hook<"session.start"> = async ($, e, next) => {
  const result = await next(e);
  await $.tool.register({
    name: "reading",
    description: DESCRIPTION,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  });
  return result;
};

/** A call of the mod's own tool: answers it with the windows now, one line each. */
const reading: Hook<"tool.call"> = async ($) => {
  const { rateLimits } = await $.session.usage();
  if (rateLimits.length === 0) {
    return {
      result:
        "No reading yet: no API response in this session has reported the usage windows " +
        "(they are reported only on a subscription).",
    };
  }
  return { result: rateLimits.map((limit) => windowLine(limit)).join("\n") };
};

export function register(on: On): void {
  on("session.start", sessionStart);
  on("tool.call", { tool: "mcp__usage-meter__reading" }, reading);
}
