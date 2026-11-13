import { describe, expect, test } from "bun:test";
import {
  anythingFetched,
  computeMetrics,
  median,
  parseArgs,
  renderDigest,
  runSweep,
  type Api,
  type MergedPR,
  type Options,
} from "./sweep.ts";

const NOW = Date.parse("2026-06-15T12:00:00Z");
const hoursAgo = (h: number): string => new Date(NOW - h * 3_600_000).toISOString();
const daysAgo = (d: number): string => hoursAgo(d * 24);

type Route = unknown[] | Error;

function fakeApi(routes: Record<string, Route>): { api: Api; calls: string[] } {
  const calls: string[] = [];
  const api: Api = async (path) => {
    calls.push(path);
    const [base, query = ""] = path.split("?");
    const params = new URLSearchParams(query);
    const page = Number(params.get("page") ?? 1);
    const perPage = Number(params.get("per_page") ?? 30);
    params.delete("page");
    params.delete("per_page");
    const key = params.size ? `${base}?${decodeURIComponent(params.toString())}` : base;
    const route = routes[key];
    if (route === undefined) throw new Error(`gh: Not Found (HTTP 404) ${key}`);
    if (route instanceof Error) throw route;
    return route.slice((page - 1) * perPage, page * perPage);
  };
  return { api, calls };
}

const repo = (full_name: string, pushedDaysAgo: number) => ({
  full_name,
  owner: { login: full_name.split("/")[0] },
  pushed_at: daysAgo(pushedDaysAgo),
});

const pull = (number: number, o: { created?: string; updated?: string; merged?: string | null; draft?: boolean } = {}) => ({
  number,
  title: `PR ${number}`,
  draft: o.draft ?? false,
  user: { login: "someone" },
  head: { ref: `feat/${number}` },
  created_at: o.created ?? daysAgo(2),
  updated_at: o.updated ?? hoursAgo(1),
  merged_at: o.merged ?? null,
  html_url: `https://github.com/example-org/widgets/pull/${number}`,
});

const release = (tag: string, publishedDaysAgo: number | null, draft = false) => ({
  tag_name: tag,
  name: tag,
  draft,
  created_at: daysAgo(publishedDaysAgo ?? 1),
  published_at: publishedDaysAgo === null ? null : daysAgo(publishedDaysAgo),
  html_url: `https://github.com/example-org/widgets/releases/tag/${tag}`,
});

const W = "repos/example-org/widgets";
const OPEN = `${W}/pulls?state=open`;
const CLOSED = `${W}/pulls?state=closed&sort=updated&direction=desc`;
const RELEASES = `${W}/releases`;
const MINE = "user/repos?affiliation=owner,organization_member&sort=pushed&direction=desc";
const FORBIDDEN = new Error(
  "gh: This GitHub API path is not available: sessions are bound to their configured repositories. (HTTP 403)",
);

const opts = (o: Partial<Options>): Options => ({
  owners: [],
  repos: [],
  days: 30,
  mergedDays: 7,
  metricsRepo: null,
  metricsPaths: [],
  json: false,
  ...o,
});

const quietRoutes = (r: string): Record<string, Route> => ({
  [`repos/${r}/pulls?state=open`]: [],
  [`repos/${r}/pulls?state=closed&sort=updated&direction=desc`]: [],
  [`repos/${r}/releases`]: [],
});

describe("discovery", () => {
  test("keeps repos pushed inside the window and stops paging at the first older one", async () => {
    const { api, calls } = fakeApi({
      [MINE]: [repo("example-org/widgets", 1), repo("example-org/gadgets", 29), repo("example-org/old", 31)],
      ...quietRoutes("example-org/widgets"),
      ...quietRoutes("example-org/gadgets"),
    });
    const s = await runSweep(api, opts({ owners: ["example-org"] }), NOW);
    expect(s.discovery[0].repos).toEqual({ ok: true, value: ["example-org/widgets", "example-org/gadgets"] });
    expect(s.repos.map((r) => r.repo)).toEqual(["example-org/widgets", "example-org/gadgets"]);
    expect(calls.some((c) => c.includes("example-org/old"))).toBe(false);
  });

  test("a 403 on owner listing is unavailable discovery, and explicit repos are still swept", async () => {
    const { api } = fakeApi({
      [MINE]: FORBIDDEN,
      "users/example-org/repos?sort=pushed&direction=desc": FORBIDDEN,
      [OPEN]: [pull(41)],
      [CLOSED]: [],
      [RELEASES]: [],
    });
    const s = await runSweep(api, opts({ owners: ["example-org"], repos: ["example-org/widgets"] }), NOW);
    const d = s.discovery[0];
    expect(d.repos.ok).toBe(false);
    if (!d.repos.ok) expect(d.repos.error).toContain("HTTP 403");
    expect(s.repos).toHaveLength(1);
    expect(s.repos[0].open).toMatchObject({ ok: true, value: [{ number: 41 }] });
    expect(anythingFetched(s)).toBe(true);
    expect(renderDigest(s)).toContain("discovery example-org: UNAVAILABLE (");
  });

  test("falls back to the public listing and says private repos may be missing", async () => {
    const { api } = fakeApi({
      [MINE]: FORBIDDEN,
      "users/example-org/repos?sort=pushed&direction=desc": [repo("example-org/widgets", 3)],
      ...quietRoutes("example-org/widgets"),
    });
    const s = await runSweep(api, opts({ owners: ["example-org"] }), NOW);
    expect(s.discovery[0]).toMatchObject({ via: "users/example-org/repos", repos: { ok: true } });
    expect(s.discovery[0].note).toContain("public repos only");
  });
});

describe("per-repo sweep", () => {
  test("merged PRs outside the window and closed-unmerged PRs are excluded", async () => {
    const { api } = fakeApi({
      [OPEN]: [],
      [CLOSED]: [
        pull(10, { merged: daysAgo(1), updated: daysAgo(1) }),
        pull(11, { merged: null, updated: daysAgo(2) }),
        pull(12, { merged: daysAgo(9), updated: daysAgo(3) }),
        pull(13, { merged: daysAgo(10), updated: daysAgo(10) }),
      ],
      [RELEASES]: [release("v2", 2), release("v1-draft", null, true), release("v0", 40)],
    });
    const s = await runSweep(api, opts({ repos: ["example-org/widgets"] }), NOW);
    expect(s.repos[0].merged).toMatchObject({ ok: true, value: [{ number: 10 }] });
    expect(s.repos[0].releases).toMatchObject({ ok: true, value: [{ tag: "v2" }] });
  });

  test("stops paging closed PRs once updated_at leaves the window", async () => {
    const recent = Array.from({ length: 100 }, (_, i) => pull(1000 - i, { merged: hoursAgo(i + 1), updated: hoursAgo(i + 1) }));
    const older = [pull(5, { merged: daysAgo(8), updated: daysAgo(8) }), ...Array.from({ length: 99 }, (_, i) => pull(4 - i, { updated: daysAgo(9) }))];
    const tail = [pull(1, { merged: daysAgo(1), updated: daysAgo(20) })];
    const { api, calls } = fakeApi({ [OPEN]: [], [CLOSED]: [...recent, ...older, ...tail], [RELEASES]: [] });
    const s = await runSweep(api, opts({ repos: ["example-org/widgets"] }), NOW);
    expect(s.repos[0].merged.ok && s.repos[0].merged.value.length).toBe(100);
    expect(calls.filter((c) => c.includes("state=closed")).length).toBe(2);
  });

  test("a failing call is unavailable, never an empty list", async () => {
    const { api } = fakeApi({ [OPEN]: new Error("gh: Server Error (HTTP 502)"), [CLOSED]: [], [RELEASES]: [] });
    const s = await runSweep(api, opts({ repos: ["example-org/widgets"] }), NOW);
    expect(s.repos[0].open).toEqual({ ok: false, error: "gh: Server Error (HTTP 502)" });
    const digest = renderDigest(s);
    expect(digest).toContain("example-org/widgets  open UNAVAILABLE (gh: Server Error (HTTP 502))  merged 0  releases 0");
    expect(digest).not.toContain("quiet");
  });

  test("nothing fetched at all is reported as such, one line per unreadable repo", async () => {
    const { api } = fakeApi({ [OPEN]: FORBIDDEN, [CLOSED]: FORBIDDEN, [RELEASES]: FORBIDDEN });
    const s = await runSweep(api, opts({ owners: ["example-org"], repos: ["example-org/widgets"] }), NOW);
    expect(anythingFetched(s)).toBe(false);
    expect(renderDigest(s)).toContain(`example-org/widgets  UNAVAILABLE (${FORBIDDEN.message})`);
  });
});

describe("metrics", () => {
  const merged = (number: number, openHours: number): MergedPR => ({
    number,
    title: `PR ${number}`,
    created_at: hoursAgo(openHours + 1),
    merged_at: hoursAgo(1),
    html_url: `https://github.com/example-org/widgets/pull/${number}`,
  });
  const files = (n: number, names: string[]) => ({ [`${W}/pulls/${n}/files`]: names.map((filename) => ({ filename })) });

  test("share of PRs touching a prefix and an odd-count median", async () => {
    const { api } = fakeApi({
      ...files(1, ["src/core/a.ts", "README.md"]),
      ...files(2, ["docs/x.md"]),
      ...files(3, ["lib/b.ts"]),
    });
    const prs = [merged(1, 2), merged(2, 10), merged(3, 4)];
    const m = await computeMetrics(api, "example-org/widgets", ["src/", "lib/"], { ok: true, value: prs }, 7);
    expect(m.path_share).toEqual({ ok: true, value: { touching: 2, merged: 3, share: 0.667, reason: null } });
    expect(m.median_open_to_merge).toEqual({ ok: true, value: { hours: 4, merged: 3, reason: null } });
  });

  test("an even-count median averages the middle two", () => {
    expect(median([1, 9, 3, 5])).toBe(4);
    expect(median([7])).toBe(7);
    expect(median([])).toBeNull();
  });

  test("zero merged PRs gives null with a reason, not zero", async () => {
    const { api } = fakeApi({});
    const m = await computeMetrics(api, "example-org/widgets", ["src/"], { ok: true, value: [] }, 7);
    expect(m.path_share).toMatchObject({ ok: true, value: { share: null, merged: 0 } });
    expect(m.median_open_to_merge).toMatchObject({ ok: true, value: { hours: null } });
    if (m.path_share.ok) expect(m.path_share.value.reason).toContain("no PRs merged");
  });

  test("an unreadable file list makes the share unavailable, not a smaller share", async () => {
    const { api } = fakeApi({ ...files(1, ["src/a.ts"]) });
    const m = await computeMetrics(api, "example-org/widgets", ["src/"], { ok: true, value: [merged(1, 2), merged(2, 3)] }, 7);
    expect(m.path_share.ok).toBe(false);
    if (!m.path_share.ok) expect(m.path_share.error).toContain("#2 files");
    expect(m.median_open_to_merge.ok).toBe(true);
  });

  test("unavailable merged PRs make both numbers unavailable, and the digest says so", async () => {
    const { api } = fakeApi({ [OPEN]: [], [CLOSED]: FORBIDDEN, [RELEASES]: [] });
    const s = await runSweep(
      api,
      opts({ repos: ["example-org/widgets"], metricsRepo: "example-org/widgets", metricsPaths: ["src/"] }),
      NOW,
    );
    expect(s.metrics?.path_share.ok).toBe(false);
    expect(s.metrics?.median_open_to_merge.ok).toBe(false);
    expect(renderDigest(s)).toContain("path share UNAVAILABLE (merged PRs unavailable:");
  });
});

describe("digest", () => {
  test("lists in-flight work and collapses quiet repos onto one line", async () => {
    const { api } = fakeApi({
      [OPEN]: [pull(41, { draft: true, updated: hoursAgo(3) })],
      [CLOSED]: [pull(39, { merged: daysAgo(1), updated: daysAgo(1) })],
      [RELEASES]: [release("v1.4.0", 2)],
      ...quietRoutes("example-org/gadgets"),
      ...quietRoutes("example-org/gizmos"),
    });
    const s = await runSweep(api, opts({ repos: ["example-org/widgets", "example-org/gadgets", "example-org/gizmos"] }), NOW);
    const digest = renderDigest(s);
    expect(digest).toContain("example-org/widgets  open 1  merged 1  releases 1");
    expect(digest).toContain('  open #41 draft "PR 41" @someone feat/41');
    expect(digest).toContain("updated 3h ago");
    expect(digest).toContain("  release v1.4.0 ");
    expect(digest).toContain("quiet (nothing open, merged or released): example-org/gadgets, example-org/gizmos");
    expect(digest).toContain("discovery: not requested");
  });
});

describe("arguments", () => {
  test("usage errors throw and a valid line parses", () => {
    expect(() => parseArgs([])).toThrow("--owner or --repo");
    expect(() => parseArgs(["--repo", "nope"])).toThrow("owner/name");
    expect(() => parseArgs(["--repo", "a/b", "--metrics-repo", "a/b"])).toThrow("--metrics-path");
    expect(() => parseArgs(["--repo", "a/b", "--days", "0"])).toThrow("positive");
    expect(parseArgs(["--help"])).toBe("help");
    expect(parseArgs(["--owner", "example-org", "--days", "14", "--json"])).toMatchObject({ owners: ["example-org"], days: 14, json: true });
  });
});
