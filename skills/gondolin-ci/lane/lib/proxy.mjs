// The guest's only way out: gondolin's in-process HTTP proxy, configured here so the job runner
// and the containment probe build exactly the same one.
//
// DNS stays synthetic and ssh/tcp egress stays unconfigured, so HTTP through this proxy is the
// only route off the host. isRequestAllowed sees every request, on or off the allowlist, so the
// report can name refused hosts; gondolin still enforces the allowlist and the IP check after it,
// so no callback here can widen the policy. isRequestAllowed narrows it with lib/egress.mjs.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHttpHooks } from "@earendil-works/gondolin";
import { collectBlobUploads, decide } from "./egress.mjs";
import { statePath } from "./guest.mjs";
import { sanitize } from "./terminal.mjs";

// A guest chooses how many distinct hosts and paths it asks for, so the tallies stop growing here.
const TALLY_LIMIT = 1000;

const SIGNED_URL_CALL = /^\/twirp\/results\.services\.receiver\.receiver\/get[a-z]*signedbloburl$/i;

/**
 * `actions` is what the runner agent itself needs: the list this lane ships, plus what
 * refresh-allowlist.sh last fetched. `build` adds the package registries a real job reaches for,
 * and the hosts in the JSON file `$GONDOLIN_ALLOWLIST` names, for a job whose toolchain reaches
 * further. Those hosts get reads only: lib/egress.mjs decides what is allowed there, and no
 * allowlist entry widens that.
 * @param {"actions" | "build"} profile
 * @returns {string[]}
 */
export function loadAllowlist(profile) {
  const hosts = (file) => JSON.parse(readFileSync(file, "utf8")).hosts;
  const own = (file) => hosts(new URL(file, import.meta.url));
  const refreshed = join(statePath(), "allowlist.json");
  const actions = [...own("../allowlist.json"), ...(existsSync(refreshed) ? hosts(refreshed) : [])];
  if (profile !== "build") return [...new Set(actions)];
  const extra = process.env.GONDOLIN_ALLOWLIST ? hosts(process.env.GONDOLIN_ALLOWLIST) : [];
  return [...new Set([...actions, ...own("../allowlist-build.json"), ...extra])];
}

/**
 * @param {{ allowed: string[], repo: string, enforce: boolean }} options
 *   `enforce: false` logs what the policy would refuse without refusing it. A run like that is
 *   not contained; it exists to diagnose a job the policy breaks.
 */
export function createProxy({ allowed, repo, enforce }) {
  const requested = new Map();
  const sampleUrl = new Map();
  const reachedIpCheck = new Set();
  const refused = new Map();
  const blobUploads = new Set();

  let untallied = 0;
  const tally = (counts, key) => {
    if (counts.has(key) || counts.size < TALLY_LIMIT) counts.set(key, (counts.get(key) ?? 0) + 1);
    else untallied += 1;
  };

  /** The policy decision, tallied for the report. */
  async function admit(request) {
    const host = hostOf(request.url);
    tally(requested, host);
    if (requested.has(host) && !sampleUrl.has(host)) sampleUrl.set(host, request.url.slice(0, 120));
    const verdict = decide(request, { repo, blobUploads });
    if (verdict.allow) return true;
    tally(refused, `${request.method} ${request.url.split("?")[0].slice(0, 140)} (${verdict.rule})`);
    return !enforce;
  }

  // The runner asks its results service for a signed blob URL, then writes there. Recording those
  // URLs is what lets the policy allow this job's uploads and refuse an upload URL minted outside
  // this proxy.
  //
  // The proxy makes that one call itself and hands the guest the answer. gondolin's onResponse
  // hook would be the obvious place to read it, but installing one makes gondolin buffer every
  // response, capped at 64 MB, and a checkout's pack is larger than that. So there is no
  // onResponse; every other response streams.
  //
  // A short-circuited call skips gondolin's own checks, so it passes admit() here first, and only
  // an allowlisted Actions host is ever called. Phase 2's secret placeholders are swapped in after
  // onRequest, so this call will need its own swap then.
  //
  // The call's token is not checked: the job's own token lives in the guest, so the proxy has
  // nothing to compare it with. A URL minted here with another run's token is recorded too. That
  // is the control-plane residual in egress.mjs, and it closes the same way.
  //
  // Only a successful answer to one of the Receiver's Get...SignedBlobURL calls counts. An error
  // body can echo the request back, and a guest could make it echo a path of its choosing.
  async function mintSignedUrl(request) {
    if (!(await admit(request))) return new Response("blocked by request policy", { status: 403 });
    const upstream = await fetch(request, { redirect: "manual" });
    const body = await upstream.text();
    if (upstream.ok && body.length <= 1_000_000) for (const key of collectBlobUploads(body)) blobUploads.add(key);
    const headers = new Headers(upstream.headers);
    for (const name of ["content-encoding", "content-length", "transfer-encoding"]) headers.delete(name);
    return new Response(body, { status: upstream.status, statusText: upstream.statusText, headers });
  }

  const { httpHooks, env } = createHttpHooks({
    allowedHosts: allowed,
    blockInternalRanges: true,
    onRequest: async (request) => {
      const next = (await stripExpect(request)) ?? request;
      if (isSignedUrlCall(next.url, allowed)) return mintSignedUrl(next);
      return next === request ? undefined : next;
    },
    isRequestAllowed: admit,
    isIpAllowed: async (info) => {
      reachedIpCheck.add(info.hostname.toLowerCase());
      return true;
    },
  });

  // A policy refusal stops a request before the ip check, so "never reached it" alone cannot tell
  // an allowlisted host whose every request was a refused write from one off the allowlist. This
  // matcher only labels the report; gondolin enforces.
  const label = (host) => (reachedIpCheck.has(host) ? "allow " : onAllowlist(host, allowed) ? "policy" : "DENY  ");

  /** The egress bill for this run, sanitised: every host asked for, and every refusal. */
  function report() {
    const rows = [...requested.entries()].sort((a, b) => b[1] - a[1]);
    const verb = enforce ? "refused" : "would refuse";
    return [
      `--- hosts the guest asked for (${rows.length})`,
      ...rows.map(([host, count]) => `  ${label(host)} ${String(count).padStart(4)}  ${sanitize(host)}`),
      ...rows.filter(([host]) => label(host) === "DENY  ").map(([host]) => `--- denied ${sanitize(host)}: ${sanitize(sampleUrl.get(host) ?? "")}`),
      ...[...refused].map(([line, count]) => `--- ${verb} ${count}x ${sanitize(line)}`),
      ...(untallied ? [`--- ${untallied} more requests past the ${TALLY_LIMIT} kept here`] : []),
    ];
  }

  // WebSocket frames pass the policy unseen: an upgrade is judged as the GET it starts with. So
  // gondolin answers every upgrade with 501, and the runner falls back to polling.
  return { httpHooks, env, network: { httpHooks, env, allowWebSockets: false }, report };
}

// The .NET runner sends `Expect: 100-continue`, which undici (gondolin's upstream client) refuses
// outright, turning every runner request into a 502. Drop that one header; the body still goes
// upstream, the client just loses an optimisation.
async function stripExpect(request) {
  if (!request.headers.has("expect")) return undefined;
  const headers = new Headers(request.headers);
  headers.delete("expect");
  const init = { method: request.method, headers, redirect: "manual", signal: request.signal };
  if (request.body) {
    init.body = request.body;
    init.duplex = "half";
  }
  return new Request(request.url, init);
}

function onAllowlist(host, allowed) {
  return allowed.some((p) => (p.startsWith("*.") ? host.endsWith(p.slice(1)) : host === p));
}

function isSignedUrlCall(url, allowed) {
  const { protocol, hostname, pathname } = new URL(url);
  const host = hostname.toLowerCase();
  return protocol === "https:" && /\.actions\.githubusercontent\.com$/.test(host) && onAllowlist(host, allowed) && SIGNED_URL_CALL.test(pathname);
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "?";
  }
}
