#!/usr/bin/env bun
const USAGE = `Sweep GitHub for work in flight: open PRs, recent merges, releases, weekly PR numbers.

Usage:
  bun sweep.ts [--owner <login>]... [--repo <owner/name>]... [--days 30] [--merged-days 7]
               [--metrics-repo <owner/name> --metrics-path <prefix>...] [--json]

  --owner         discover repos of this user or org pushed within --days
  --repo          sweep this repo too (works where owner listing is refused)
  --days          discovery and release window in days (default 30)
  --merged-days   merged-PR and metrics window in days (default 7)
  --metrics-repo  repo whose merged PRs feed the weekly numbers
  --metrics-path  path prefix counted by the path share (repeatable, required with --metrics-repo)
  --json          one JSON document instead of the plain-text digest

Uses REST paths through \`gh api\` only. Anything that could not be fetched is
reported as UNAVAILABLE with the reason, never as empty or zero.
Exit 0 when anything was swept, 1 when nothing could be fetched, 2 on usage errors.`;

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export type Api = (path: string) => Promise<unknown>;

export interface OpenPR {
  number: number;
  title: string;
  draft: boolean;
  author: string | null;
  head_ref: string;
  created_at: string;
  updated_at: string;
  html_url: string;
}
export interface MergedPR {
  number: number;
  title: string;
  created_at: string;
  merged_at: string;
  html_url: string;
}
export interface Release {
  tag: string;
  name: string | null;
  published_at: string;
  html_url: string;
}
export interface RepoSweep {
  repo: string;
  open: Result<OpenPR[]>;
  merged: Result<MergedPR[]>;
  releases: Result<Release[]>;
}
export interface OwnerDiscovery {
  owner: string;
  via: string | null;
  note?: string;
  repos: Result<string[]>;
}
export interface PathShare {
  touching: number;
  merged: number;
  share: number | null;
  reason: string | null;
}
export interface MedianHours {
  hours: number | null;
  merged: number;
  reason: string | null;
}
export interface Metrics {
  repo: string;
  merged_days: number;
  prefixes: string[];
  path_share: Result<PathShare>;
  median_open_to_merge: Result<MedianHours>;
}
export interface Sweep {
  generated_at: string;
  window_days: number;
  merged_days: number;
  discovery: OwnerDiscovery[];
  repos: RepoSweep[];
  metrics: Metrics | null;
}
export interface Options {
  owners: string[];
  repos: string[];
  days: number;
  mergedDays: number;
  metricsRepo: string | null;
  metricsPaths: string[];
  json: boolean;
}

interface RawUser { login: string }
interface RawRepo { full_name: string; owner: RawUser; pushed_at: string | null }
interface RawPull {
  number: number;
  title: string;
  draft?: boolean;
  user: RawUser | null;
  head: { ref: string };
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  html_url: string;
}
interface RawRelease {
  tag_name: string;
  name: string | null;
  draft: boolean;
  created_at: string;
  published_at: string | null;
  html_url: string;
}
interface RawFile { filename: string }

type Verdict = "take" | "skip" | "stop";

const PER_PAGE = 100;
const MAX_PAGES = 30;
const DAY_MS = 86_400_000;
const CONCURRENCY = 6;

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const oneLine = (e: unknown): string =>
  (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").trim() || "unknown error";
const after = (iso: string | null, cutoff: number): boolean => iso !== null && Date.parse(iso) >= cutoff;

export async function attempt<T>(f: () => Promise<T>): Promise<Result<T>> {
  try {
    return ok(await f());
  } catch (e) {
    return { ok: false, error: oneLine(e) };
  }
}

export async function collect<T>(api: Api, path: string, judge: (item: T) => Verdict): Promise<T[]> {
  const out: T[] = [];
  const sep = path.includes("?") ? "&" : "?";
  for (let page = 1; page <= MAX_PAGES; page++) {
    const items = await api(`${path}${sep}per_page=${PER_PAGE}&page=${page}`);
    if (!Array.isArray(items)) throw new Error(`${path}: expected a list`);
    for (const item of items as T[]) {
      const verdict = judge(item);
      if (verdict === "stop") return out;
      if (verdict === "take") out.push(item);
    }
    if (items.length < PER_PAGE) return out;
  }
  throw new Error(`${path}: more than ${MAX_PAGES} pages, not read to the end`);
}

async function pool<T, R>(items: T[], f: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await f(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return out;
}

export async function discover(api: Api, owners: string[], cutoff: number): Promise<OwnerDiscovery[]> {
  if (!owners.length) return [];
  const judge = (r: RawRepo): Verdict => (r.pushed_at === null ? "skip" : after(r.pushed_at, cutoff) ? "take" : "stop");
  const mine = await attempt(() =>
    collect<RawRepo>(api, "user/repos?affiliation=owner,organization_member&sort=pushed&direction=desc", judge),
  );
  return Promise.all(
    owners.map(async (owner): Promise<OwnerDiscovery> => {
      if (mine.ok) {
        const names = mine.value.filter((r) => r.owner.login.toLowerCase() === owner.toLowerCase()).map((r) => r.full_name);
        if (names.length) return { owner, via: "user/repos", repos: ok(names) };
      }
      const path = `users/${owner}/repos`;
      const listed = await attempt(() =>
        collect<RawRepo>(api, `${path}?sort=pushed&direction=desc`, judge).then((rs) => rs.map((r) => r.full_name)),
      );
      if (!listed.ok) {
        const error = mine.ok
          ? listed.error
          : mine.error === listed.error
            ? `user/repos and ${path}: ${listed.error}`
            : `user/repos: ${mine.error}; ${path}: ${listed.error}`;
        return { owner, via: null, repos: { ok: false, error } };
      }
      const note = mine.ok ? undefined : `user/repos unavailable (${mine.error}); public repos only`;
      return { owner, via: path, ...(note && { note }), repos: listed };
    }),
  );
}

export const fetchOpen = (api: Api, repo: string): Promise<OpenPR[]> =>
  collect<RawPull>(api, `repos/${repo}/pulls?state=open`, () => "take").then((ps) =>
    ps.map((p) => ({
      number: p.number,
      title: p.title,
      draft: p.draft ?? false,
      author: p.user?.login ?? null,
      head_ref: p.head.ref,
      created_at: p.created_at,
      updated_at: p.updated_at,
      html_url: p.html_url,
    })),
  );

export const fetchMerged = (api: Api, repo: string, cutoff: number): Promise<MergedPR[]> =>
  collect<RawPull>(api, `repos/${repo}/pulls?state=closed&sort=updated&direction=desc`, (p) =>
    !after(p.updated_at, cutoff) ? "stop" : after(p.merged_at, cutoff) ? "take" : "skip",
  ).then((ps) =>
    ps.map((p) => ({
      number: p.number,
      title: p.title,
      created_at: p.created_at,
      merged_at: p.merged_at as string,
      html_url: p.html_url,
    })),
  );

export const fetchReleases = (api: Api, repo: string, cutoff: number): Promise<Release[]> =>
  collect<RawRelease>(api, `repos/${repo}/releases`, (r) =>
    !after(r.created_at, cutoff) && !after(r.published_at, cutoff)
      ? "stop"
      : !r.draft && after(r.published_at, cutoff)
        ? "take"
        : "skip",
  ).then((rs) =>
    rs.map((r) => ({ tag: r.tag_name, name: r.name, published_at: r.published_at as string, html_url: r.html_url })),
  );

export async function sweepRepo(api: Api, repo: string, now: number, days: number, mergedDays: number): Promise<RepoSweep> {
  const [open, merged, releases] = await Promise.all([
    attempt(() => fetchOpen(api, repo)),
    attempt(() => fetchMerged(api, repo, now - mergedDays * DAY_MS)),
    attempt(() => fetchReleases(api, repo, now - days * DAY_MS)),
  ]);
  return { repo, open, merged, releases };
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const round1 = (x: number): number => Math.round(x * 10) / 10;

export async function computeMetrics(
  api: Api,
  repo: string,
  prefixes: string[],
  merged: Result<MergedPR[]>,
  mergedDays: number,
): Promise<Metrics> {
  const base = { repo, merged_days: mergedDays, prefixes };
  if (!merged.ok) {
    const error = `merged PRs unavailable: ${merged.error}`;
    return { ...base, path_share: { ok: false, error }, median_open_to_merge: { ok: false, error } };
  }
  const prs = merged.value;
  const none = `no PRs merged in the last ${mergedDays} days`;
  const hours = prs.map((p) => (Date.parse(p.merged_at) - Date.parse(p.created_at)) / 3_600_000);
  const med = median(hours);
  const median_open_to_merge = ok<MedianHours>({
    hours: med === null ? null : round1(med),
    merged: prs.length,
    reason: med === null ? none : null,
  });
  if (!prs.length) {
    return { ...base, path_share: ok({ touching: 0, merged: 0, share: null, reason: none }), median_open_to_merge };
  }
  const touches = await pool(prs, (p) =>
    attempt(async () => {
      const files = await collect<RawFile>(api, `repos/${repo}/pulls/${p.number}/files`, () => "take");
      return files.some((f) => prefixes.some((pre) => f.filename.startsWith(pre)));
    }).then((r): Result<boolean> => (r.ok ? r : { ok: false, error: `#${p.number} files: ${r.error}` })),
  );
  const failed = touches.find((t) => !t.ok);
  if (failed && !failed.ok) return { ...base, path_share: failed, median_open_to_merge };
  const touching = touches.filter((t) => t.ok && t.value).length;
  return {
    ...base,
    path_share: ok({ touching, merged: prs.length, share: round1((touching / prs.length) * 100) / 100, reason: null }),
    median_open_to_merge,
  };
}

const dedupe = (xs: string[]): string[] => {
  const seen = new Set<string>();
  return xs.filter((x) => !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()));
};

export async function runSweep(api: Api, opts: Options, now: number): Promise<Sweep> {
  const discovery = await discover(api, opts.owners, now - opts.days * DAY_MS);
  const names = dedupe([...opts.repos, ...discovery.flatMap((d) => (d.repos.ok ? d.repos.value : []))]);
  const repos = await pool(names, (r) => sweepRepo(api, r, now, opts.days, opts.mergedDays));
  let metrics: Metrics | null = null;
  if (opts.metricsRepo) {
    const target = opts.metricsRepo;
    const swept = repos.find((r) => r.repo.toLowerCase() === target.toLowerCase());
    const merged = swept?.merged ?? (await attempt(() => fetchMerged(api, target, now - opts.mergedDays * DAY_MS)));
    metrics = await computeMetrics(api, target, opts.metricsPaths, merged, opts.mergedDays);
  }
  return {
    generated_at: new Date(now).toISOString(),
    window_days: opts.days,
    merged_days: opts.mergedDays,
    discovery,
    repos,
    metrics,
  };
}

export function anythingFetched(s: Sweep): boolean {
  const results: Result<unknown>[] = [
    ...s.discovery.map((d) => d.repos),
    ...s.repos.flatMap((r) => [r.open, r.merged, r.releases]),
    ...(s.metrics ? [s.metrics.path_share, s.metrics.median_open_to_merge] : []),
  ];
  return results.some((r) => r.ok);
}

const day = (iso: string): string => iso.slice(0, 10);
const clip = (s: string, n = 160): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const unavailable = (error: string): string => `UNAVAILABLE (${clip(error)})`;

export function ago(iso: string, now: number): string {
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (mins < 60) return `${mins}m`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)}h`;
  return `${Math.round(mins / 1440)}d`;
}

const count = <T>(label: string, r: Result<T[]>, refs?: (v: T[]) => string): string =>
  !r.ok ? `${label} ${unavailable(r.error)}` : `${label} ${r.value.length}${refs && r.value.length ? ` (${refs(r.value)})` : ""}`;

function renderRepo(r: RepoSweep, now: number): string[] {
  const errors = new Set([r.open, r.merged, r.releases].map((x) => (x.ok ? null : x.error)));
  if (errors.size === 1 && !r.open.ok) return [`${r.repo}  ${unavailable(r.open.error)}`];
  if (r.open.ok && r.merged.ok && r.releases.ok && r.open.value.length === 0) {
    return [
      `${r.repo}  open 0  ${count("merged", r.merged, (v) => v.map((p) => `#${p.number}`).join(" "))}  ${count("releases", r.releases, (v) => v.map((x) => x.tag).join(" "))}`,
    ];
  }
  const lines = [`${r.repo}  ${count("open", r.open)}  ${count("merged", r.merged)}  ${count("releases", r.releases)}`];
  if (r.open.ok)
    for (const p of r.open.value)
      lines.push(
        `  open #${p.number}${p.draft ? " draft" : ""} "${clip(p.title, 90)}" @${p.author ?? "unknown"} ${p.head_ref} opened ${day(p.created_at)} updated ${ago(p.updated_at, now)} ago ${p.html_url}`,
      );
  if (r.merged.ok)
    for (const p of r.merged.value) lines.push(`  merged #${p.number} "${clip(p.title, 90)}" ${day(p.merged_at)} ${p.html_url}`);
  if (r.releases.ok)
    for (const x of r.releases.value)
      lines.push(`  release ${x.tag}${x.name && x.name !== x.tag ? ` "${clip(x.name, 60)}"` : ""} ${day(x.published_at)} ${x.html_url}`);
  return lines;
}

function renderMetrics(m: Metrics): string {
  const head = `metrics ${m.repo} (${m.merged_days}d, paths ${m.prefixes.join(" ")}):`;
  const ps = m.path_share;
  const share = !ps.ok
    ? `path share ${unavailable(ps.error)}`
    : ps.value.share === null
      ? `path share n/a (${ps.value.reason})`
      : `${ps.value.touching} of ${ps.value.merged} merged PRs touch the paths (${Math.round(ps.value.share * 100)}%)`;
  const md = m.median_open_to_merge;
  const med = !md.ok
    ? `median open-to-merge ${unavailable(md.error)}`
    : md.value.hours === null
      ? `median open-to-merge n/a (${md.value.reason})`
      : `median open-to-merge ${md.value.hours}h over ${md.value.merged} PRs`;
  return `${head} ${share}; ${med}`;
}

export function renderDigest(s: Sweep): string {
  const now = Date.parse(s.generated_at);
  const lines = [`sweep ${s.generated_at.slice(0, 16)}Z  repos pushed within ${s.window_days}d  merged within ${s.merged_days}d`];
  if (!s.discovery.length) lines.push("discovery: not requested (explicit --repo only)");
  for (const d of s.discovery)
    lines.push(
      d.repos.ok
        ? `discovery ${d.owner}: ${d.repos.value.length} repos via ${d.via}${d.note ? ` (${clip(d.note)})` : ""}`
        : `discovery ${d.owner}: ${unavailable(d.repos.error)}`,
    );
  lines.push("");
  const quiet = s.repos.filter(
    (r) => r.open.ok && r.merged.ok && r.releases.ok && !r.open.value.length && !r.merged.value.length && !r.releases.value.length,
  );
  for (const r of s.repos) if (!quiet.includes(r)) lines.push(...renderRepo(r, now));
  if (quiet.length) lines.push(`quiet (nothing open, merged or released): ${quiet.map((r) => r.repo).join(", ")}`);
  if (!s.repos.length) lines.push("no repos swept");
  if (s.metrics) lines.push("", renderMetrics(s.metrics));
  return lines.join("\n");
}

export class UsageError extends Error {}

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
const OWNER_RE = /^[\w.-]+$/;

export function parseArgs(argv: string[]): Options | "help" {
  const opts: Options = { owners: [], repos: [], days: 30, mergedDays: 7, metricsRepo: null, metricsPaths: [], json: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = (): string => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new UsageError(`${flag} needs a value`);
      return v;
    };
    const match = (v: string, re: RegExp, what: string): string => {
      if (!re.test(v)) throw new UsageError(`${flag}: '${v}' is not ${what}`);
      return v;
    };
    const positive = (v: string): number => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1) throw new UsageError(`${flag}: '${v}' is not a positive whole number`);
      return n;
    };
    switch (flag) {
      case "-h":
      case "--help":
        return "help";
      case "--owner":
        opts.owners.push(match(value(), OWNER_RE, "a login"));
        break;
      case "--repo":
        opts.repos.push(match(value(), REPO_RE, "owner/name"));
        break;
      case "--days":
        opts.days = positive(value());
        break;
      case "--merged-days":
        opts.mergedDays = positive(value());
        break;
      case "--metrics-repo":
        opts.metricsRepo = match(value(), REPO_RE, "owner/name");
        break;
      case "--metrics-path":
        opts.metricsPaths.push(value());
        break;
      case "--json":
        opts.json = true;
        break;
      default:
        throw new UsageError(`unknown argument '${flag}'`);
    }
  }
  if (!opts.owners.length && !opts.repos.length) throw new UsageError("give at least one --owner or --repo");
  if (opts.metricsRepo && !opts.metricsPaths.length) throw new UsageError("--metrics-repo needs at least one --metrics-path");
  if (!opts.metricsRepo && opts.metricsPaths.length) throw new UsageError("--metrics-path needs --metrics-repo");
  return opts;
}

async function ghApi(path: string): Promise<unknown> {
  const proc = Bun.spawn(["gh", "api", "-H", "Accept: application/vnd.github+json", path], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Error(err.trim() || out.trim() || `gh api exited ${code}`);
  return JSON.parse(out);
}

async function main(argv: string[]): Promise<number> {
  let opts: Options | "help";
  try {
    opts = parseArgs(argv);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    console.error(`sweep: ${e.message}\n\n${USAGE}`);
    return 2;
  }
  if (opts === "help") {
    console.log(USAGE);
    return 0;
  }
  const sweep = await runSweep(ghApi, opts, Date.now());
  console.log(opts.json ? JSON.stringify(sweep, null, 2) : renderDigest(sweep));
  if (anythingFetched(sweep)) return 0;
  console.error("sweep: nothing could be fetched");
  return 1;
}

if (import.meta.main) process.exit(await main(Bun.argv.slice(2)));
