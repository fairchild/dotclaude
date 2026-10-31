// Which requests may leave the guest, by method and path. The host allowlist decides where the
// guest can connect; this decides what it can do there.
//
// Reads are allowed on any host. Writes are allowed only where a rule names them, because most
// allowlisted hosts (github.com, npm, PyPI, ghcr.io) accept writes from anyone holding a token,
// and code that brings its own token could otherwise push data to its author's account.
//
// The Actions control plane needs writes, and carries two traps of its own:
//
// - The results blob storage (productionresultssa*) is shared by every GitHub customer. An
//   upload URL minted by someone else's workflow is a way out for data, so a blob write is
//   allowed only to a path this job's own control plane handed out (see collectBlobUploads).
// - The job is dispatched on the default branch, so its runtime token is scoped to that branch's
//   Actions cache, which later jobs restore from. The results API (cache, artifacts, step updates, any
//   version) is therefore an allowlist of the calls a job makes that write nothing a later job
//   restores: the cache read, and the runner's own step-status updates. The legacy cache and
//   artifact APIs are read-only.
//
// Not closed here: the control plane is shared across tenants too. A write that carries a runtime
// token from someone else's run is judged like this job's own, because nothing in
// (method, host, path) tells them apart. Binding control-plane credentials to this job, so the
// guest only ever holds host-bound placeholders, is the next phase in ../references/design.md.
// The same gap reaches blob storage: an upload URL minted through the proxy with another run's
// token is recorded as this job's.

const READ = new Set(["GET", "HEAD", "OPTIONS"]);
const METHOD_OVERRIDES = ["x-http-method-override", "x-http-method", "x-method-override"];

const CONTROL_PLANE = /\.actions\.githubusercontent\.com$/;
const BLOB_STORAGE = /^productionresultssa\d+\.blob\.core\.windows\.net$/;
const RESULTS_API = "/twirp/github.actions.results.api.";
const RESULTS_API_CALLS = new Set([
  "/twirp/github.actions.results.api.v1.cacheservice/getcacheentrydownloadurl",
  "/twirp/github.actions.results.api.v1.workflowstepupdateservice/workflowstepsupdate",
]);
const LEGACY_WRITES = [
  ["cache-write", /\/_apis\/artifactcache\//],
  ["artifact-write", /\/_apis\/pipelines\/workflows\/[^/]+\/artifacts/],
];
const NPM_AUDIT = /^\/-\/npm\/v1\/security\/(advisories\/bulk|audits\/quick)$/;

/**
 * @param {{ method: string, url: string, headers: Headers }} request
 * @param {{ repo: string, blobUploads?: Set<string> }} options
 *   `repo` is owner/name of the repository under test; `blobUploads` holds the `host/path` of
 *   every blob upload URL this job's control plane has handed out so far.
 * @returns {{ allow: boolean, rule: string }}
 */
export function decide(request, { repo, blobUploads = new Set() }) {
  const reading = claimedMethods(request).every((verb) => READ.has(verb));
  const { hostname, pathname } = new URL(request.url);
  const host = hostname.toLowerCase();
  // Servers such as GitHub's Go services decode %2F before routing; JavaScript's URL does not.
  // Match what the server will see, and refuse a request whose path does not decode at all.
  const path = decodePath(pathname);

  // Twirp calls are POSTs even when they only read, so the results API is judged by name.
  if (CONTROL_PLANE.test(host) && path !== null && path.startsWith(RESULTS_API)) {
    return RESULTS_API_CALLS.has(path) ? { allow: true, rule: "results-call" } : { allow: false, rule: "results-api" };
  }
  if (reading) return { allow: true, rule: "read" };
  if (path === null) return { allow: false, rule: "undecodable-path" };
  // A server that decodes %2F may also resolve the `..` it produces, landing somewhere no rule
  // below looked at. No legitimate write needs a dot segment.
  if (path.split("/").some((segment) => segment === "." || segment === "..")) return { allow: false, rule: "dot-segment" };

  if (BLOB_STORAGE.test(host)) {
    return blobUploads.has(blobKey(host, pathname)) ? { allow: true, rule: "blob-upload" } : { allow: false, rule: "blob-write" };
  }
  if (CONTROL_PLANE.test(host)) {
    const legacy = LEGACY_WRITES.find(([, pattern]) => pattern.test(path));
    return legacy ? { allow: false, rule: legacy[0] } : { allow: true, rule: "control-plane" };
  }
  if (host === "github.com" && isFetchOf(path, repo)) return { allow: true, rule: "git-fetch" };
  if (host === "registry.npmjs.org" && NPM_AUDIT.test(path)) return { allow: true, rule: "npm-audit" };
  return { allow: false, rule: "write" };
}

/**
 * The blob upload URLs in a control-plane response body. The runner asks its results service
 * for a signed URL, then writes there; recording those paths is what lets the policy tell an
 * upload URL minted through the proxy from one brought in from outside.
 * @param {string} body
 * @returns {string[]} `host/path` keys
 */
export function collectBlobUploads(body) {
  const unescaped = body.replaceAll("\\u0026", "&").replaceAll("\\/", "/");
  const keys = [];
  for (const [, host, path] of unescaped.matchAll(/https:\/\/(productionresultssa\d+\.blob\.core\.windows\.net)(\/[^"'?\s\\]*)/gi)) {
    try {
      keys.push(blobKey(host.toLowerCase(), new URL(`https://${host}${path}`).pathname));
    } catch {}
  }
  return keys;
}

const blobKey = (host, pathname) => `${host}${pathname}`;

// A request is a read only if its real method and every method-override header all say so.
// Most servers ignore the override and act on the real method, so a POST that claims to be a
// GET is still a POST; some honour it, so a GET that claims to be a POST is one too. A header
// holding several values ("GET, POST") matches no read verb and counts as a write.
function claimedMethods({ method, headers }) {
  const overrides = METHOD_OVERRIDES.map((name) => headers?.get?.(name)).filter(Boolean);
  return [method, ...overrides].map((verb) => verb.trim().toUpperCase());
}

function decodePath(pathname) {
  try {
    return decodeURIComponent(pathname).toLowerCase().replace(/\/{2,}/g, "/");
  } catch {
    return null;
  }
}

// actions/checkout fetches over smart HTTP: a GET for the refs, then POSTs to git-upload-pack.
function isFetchOf(path, repo) {
  const base = `/${repo.toLowerCase()}`;
  return path === `${base}/git-upload-pack` || path === `${base}.git/git-upload-pack`;
}
