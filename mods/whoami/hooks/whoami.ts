/**
 * The whoami mod: one dim transcript line at the session's start that says who the session runs
 * as — `<account> · <claude-as profile | plain claude> · week N% (resets Day HH:MM)` — so a login
 * that changed under a profile, or under plain `claude`, shows before any work is done. When
 * `CLAUDE_AS_ACCOUNT` declares an account (the claude-as skill's convention) and the login is not
 * it, the account reads `⚠ <login> (expected <account>)`. A match is equal local parts, or the
 * login's local part starting with `<expected>.`, in any case — the rule the status line uses.
 *
 * The account, profile and declaration come from one process call, its own `whoami.sh`, which
 * hands the mod three lines rather than the whole `.claude.json` that `$.fs.read` would (it holds
 * every project's history); `$.session.identity()` names the email only under a managed
 * organization pin. The week comes from one network call, `GET api.anthropic.com/api/oauth/usage`
 * with the session's credential through `$.session.authorize()`; the secret never reaches the mod.
 * That endpoint sometimes answers 429, so each reading is kept per account in `$.store`, as is each
 * main-loop turn's `$.session.usage()` rate limits, and a failed fetch shows the kept reading with
 * its age. When nothing is kept yet, the line says the usage comes after the first reply, and the
 * first turn that reports it logs it once. Both hooks pass their event on unchanged and do their
 * work after it, so the session's start never waits on the network. `claude plugin validate
 * --json mods/whoami` lists its hooks and `$` calls the way the engine reads them, so each
 * engine call is spelled `$.noun.call(...)`.
 */
/*
 * The part of Claude Code's mod API (2.1.330) this mod uses, written as a local shape like the
 * other mods': the engine's own declarations are generated per build and are not in this
 * repository. Each name and field is copied from that file, narrowed to what the mod reads or
 * calls. It proves nothing about the engine: `claude plugin validate` reports what the engine sees.
 */

/** One rate-limit window as the engine reports it (`SessionRateLimit`). */
type RateLimit = {
  /** `five_hour`, `seven_day`, or a gateway's `spend_limit`. */
  readonly kind: string;
  /** 0 to 100. */
  readonly percentUsed: number;
  /** An ISO 8601 timestamp. */
  readonly resetsAt?: string;
};

/** `HttpResponse`, narrowed. */
type HttpResponse = { readonly status: number; readonly ok: boolean; readonly text: string };

/** The engine interface (`$`), narrowed to the calls the mod makes. */
export type Engine = {
  readonly plugin: { readonly root: string };
  readonly session: {
    readonly usage: () => Promise<{ readonly rateLimits: readonly RateLimit[] }>;
    /** An opaque handle for the session's Anthropic credential, or null with none. */
    readonly authorize: () => Promise<{ readonly handle: string } | null>;
  };
  readonly http: {
    readonly fetch: (
      url: string,
      init?: { readonly auth?: string; readonly headers?: Readonly<Record<string, string>> },
    ) => Promise<HttpResponse>;
  };
  readonly process: {
    readonly run: (
      argv: readonly string[],
      init?: { readonly timeoutMs?: number },
    ) => Promise<{ readonly exitCode: number; readonly stdout: string }>;
  };
  readonly clock: { readonly now: () => Promise<number> };
  /** The mod's own JSON file under the configuration directory, across sessions. */
  readonly store: {
    readonly get: (key: string) => Promise<unknown>;
    readonly set: (key: string, value: unknown) => Promise<void>;
  };
  /** `log` appends one dim line to the transcript, never sent to the model; `debug` the log alone. */
  readonly ui: {
    readonly log: (text: string, options?: { readonly to?: "transcript" | "debug" }) => void;
  };
};

/** Each event the mod hooks: its input and what `next(e)` resolves to, narrowed. */
type Events = {
  readonly "session.start": {
    readonly input: { readonly isInteractive: boolean; readonly surface: string | null };
    readonly result: unknown;
  };
  readonly "turn.complete": {
    /** The loop the turn ran in, absent on the main loop. */
    readonly input: { readonly agentId?: string };
    readonly result: unknown;
  };
};

type EventName = keyof Events;
type Input<E extends EventName> = Events[E]["input"];
type Result<E extends EventName> = Events[E]["result"];
type Next<E extends EventName> = (e: Input<E>) => Promise<Result<E>>;
type Hook<E extends EventName> = ($: Engine, e: Input<E>, next: Next<E>) => Promise<Result<E>>;

/** `on(event, hook)`, for the two events the mod hooks (`On`). */
export type On = {
  (event: "session.start", hook: Hook<"session.start">): unknown;
  (event: "turn.complete", hook: Hook<"turn.complete">): unknown;
};

/** Who the session runs as: the login's local part, the claude-as profile, the declared account. */
type Who = { readonly account: string; readonly profile: string; readonly expected: string };
type Window = { readonly percentUsed: number; readonly resetsAt?: string };
/** A kept usage reading, `at` milliseconds since the epoch. */
export type Reading = { readonly at: number; readonly week?: Window; readonly fiveHour?: Window };

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
/** The five-hour window joins the line from here, as on the status line. */
const FIVE_HOUR_FROM = 50;
/** A reading younger than this reads as current. */
const FRESH_MS = 120_000;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const localPart = (address: string): string => address.toLowerCase().split("@")[0] ?? "";

/** Whether `login` is the account `expected` names: equal local parts, or `<expected>.` leading. */
export function isAccount(login: string, expected: string): boolean {
  const [have, want] = [localPart(login), localPart(expected)];
  return have === want || have.startsWith(`${want}.`);
}

const pad = (n: number): string => String(n).padStart(2, "0");
const clock = (iso: string): string => {
  const at = new Date(iso);
  return `${DAYS[at.getDay()]} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
};

const age = (ms: number): string => {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  return minutes < 2880 ? `${Math.round(minutes / 60)}h ago` : `${Math.round(minutes / 1440)}d ago`;
};

function windowText(label: string, w: Window | undefined, now: number): string | undefined {
  if (w === undefined) return undefined;
  if (w.resetsAt !== undefined && Date.parse(w.resetsAt) <= now) return `${label} reset since`;
  const resets = w.resetsAt === undefined ? "" : ` (resets ${clock(w.resetsAt)})`;
  return `${label} ${Math.round(w.percentUsed)}%${resets}`;
}

/** The usage part of the line; a reading older than FRESH_MS says how old. Without a week, the 5h shows whatever it is. */
export function readingText(r: Reading, now: number): string {
  const isFiveHourShown = r.week === undefined || (r.fiveHour?.percentUsed ?? 0) >= FIVE_HOUR_FROM;
  const fiveHour = isFiveHourShown ? r.fiveHour : undefined;
  const parts = [windowText("week", r.week, now), windowText("5h", fiveHour, now)];
  const stamp = now - r.at < FRESH_MS ? "" : ` · as of ${age(now - r.at)}`;
  return parts.filter((part) => part !== undefined).join(" · ") + stamp;
}

const storeKey = (account: string): string => `usage:${account}`;

async function readWho($: Engine): Promise<Who> {
  const { stdout } = await $.process.run(["/bin/sh", `${$.plugin.root}/hooks/whoami.sh`], {
    timeoutMs: 5000,
  });
  const [email = "", profile = "", expected = ""] = stdout.split("\n");
  return { account: localPart(email), profile, expected };
}

type Raw = { readonly utilization?: number | null; readonly resets_at?: string | null } | null;

const fromRaw = (w: Raw | undefined): Window | undefined =>
  typeof w?.utilization === "number"
    ? { percentUsed: w.utilization, resetsAt: w.resets_at ?? undefined }
    : undefined;

/** A reading from the usage endpoint, or why there is none. */
async function fetchReading($: Engine): Promise<Reading | string> {
  const auth = await $.session.authorize();
  if (auth === null) return "no subscription login";
  const res = await $.http.fetch(USAGE_URL, {
    auth: auth.handle,
    headers: { "anthropic-beta": "oauth-2025-04-20" },
  });
  if (!res.ok) return `HTTP ${res.status}`;
  let body: Record<string, Raw>;
  try {
    body = JSON.parse(res.text) as Record<string, Raw>;
  } catch {
    return "unreadable answer";
  }
  const [week, fiveHour] = [fromRaw(body.seven_day), fromRaw(body.five_hour)];
  if (week === undefined && fiveHour === undefined) return "no usage windows";
  return { at: await $.clock.now(), week, fiveHour };
}

/** The usage part of the line, and whether it carries a reading. */
async function usageText($: Engine, account: string): Promise<{ text: string; isShown: boolean }> {
  const now = await $.clock.now();
  const live = await fetchReading($).catch((err: unknown) => String(err).slice(0, 60));
  if (typeof live !== "string") {
    if (account !== "") await $.store.set(storeKey(account), live);
    return { text: readingText(live, now), isShown: true };
  }
  const kept = account === "" ? undefined : ((await $.store.get(storeKey(account))) as Reading | undefined);
  if (kept !== undefined) return { text: readingText(kept, now), isShown: true };
  return { text: `usage after the first reply (${live})`, isShown: false };
}

type State = { who: Who | null; isUsageShown: boolean };

async function orient($: Engine, state: State): Promise<void> {
  const who = await readWho($);
  state.who = who;
  const isWrong = who.expected !== "" && !isAccount(who.account, who.expected);
  const account = isWrong
    ? `⚠ ${who.account || "nobody"} (expected ${localPart(who.expected)})`
    : who.account || "not signed in";
  const launch = who.profile === "" ? "plain claude" : `claude-as ${who.profile}`;
  const usage = await usageText($, who.account);
  state.isUsageShown = usage.isShown;
  $.ui.log(`${account} · ${launch} · ${usage.text}`);
}

/** After a main-loop turn: keeps the windows it reported, and logs them once if the start could not. */
async function recordTurn($: Engine, state: State): Promise<void> {
  if (state.who === null) return;
  const { rateLimits } = await $.session.usage();
  const pick = (kind: string): Window | undefined => {
    const w = rateLimits.find((limit) => limit.kind === kind);
    return w === undefined ? undefined : { percentUsed: w.percentUsed, resetsAt: w.resetsAt };
  };
  const reading: Reading = { at: await $.clock.now(), week: pick("seven_day"), fiveHour: pick("five_hour") };
  if (reading.week === undefined && reading.fiveHour === undefined) return;
  if (state.who.account !== "") await $.store.set(storeKey(state.who.account), reading);
  if (!state.isUsageShown) {
    state.isUsageShown = true;
    $.ui.log(readingText(reading, reading.at));
  }
}

const debug = ($: Engine) => (err: unknown) => $.ui.log(`whoami: ${String(err)}`, { to: "debug" });

export function register(on: On): void {
  const state: State = { who: null, isUsageShown: false };
  on("session.start", async ($, e, next) => {
    const result = await next(e);
    void orient($, state).catch(debug($));
    return result;
  });
  on("turn.complete", async ($, e, next) => {
    const result = await next(e);
    if (e.agentId === undefined) void recordTurn($, state).catch(debug($));
    return result;
  });
}
