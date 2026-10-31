import { test } from "node:test";
import assert from "node:assert/strict";
import { collectBlobUploads, decide } from "./egress.mjs";

const repo = "acme/widgets";
const RESULTS = "https://results-receiver.actions.githubusercontent.com/twirp";
const BLOB = "https://productionresultssa7.blob.core.windows.net";
const OURS = `${BLOB}/actions-results/run-1/workflow-job-run-2/logs/steps/step-3.txt`;
const handedOut = new Set(collectBlobUploads(JSON.stringify({ logs_url: `${OURS}?sv=2023&sig=abc` })));

const req = (method, url, headers = {}) => new Request(url, { method, headers });
const verdict = (method, url, headers, blobUploads = handedOut) => decide(req(method, url, headers), { repo, blobUploads });
const allowed = (...args) => verdict(...args).allow;

test("reads are allowed on every host", () => {
  for (const url of ["https://github.com/x/y", "https://api.github.com/repos/a/b", "https://pypi.org/simple/uv/", "https://ghcr.io/v2/", `${BLOB}/any/blob`]) {
    assert.ok(allowed("GET", url), url);
    assert.ok(allowed("HEAD", url), url);
  }
});

test("the checkout can fetch the repository under test, with or without .git", () => {
  assert.ok(allowed("POST", "https://github.com/acme/widgets.git/git-upload-pack"));
  assert.ok(allowed("POST", "https://github.com/acme/widgets/git-upload-pack"));
  assert.ok(allowed("POST", "https://github.com/Acme/Widgets.git/git-upload-pack"));
});

test("nothing can be pushed, to this repository or any other", () => {
  assert.deepEqual(verdict("POST", "https://github.com/acme/widgets.git/git-receive-pack"), { allow: false, rule: "write" });
  assert.ok(!allowed("POST", "https://github.com/attacker/drop.git/git-receive-pack"));
  assert.ok(!allowed("POST", "https://github.com/attacker/drop.git/git-upload-pack"));
});

test("dot segments and encoded slashes cannot walk an allowed path somewhere else", () => {
  assert.ok(!allowed("POST", "https://github.com/acme/widgets/git-upload-pack/../../attacker/drop/git-receive-pack"));
  assert.ok(!allowed("POST", "https://github.com/acme/widgets/git-upload-pack%2F..%2F..%2Fattacker%2Fdrop"));
});

test("API writes, gists, uploads and image pushes are refused", () => {
  for (const [method, url] of [
    ["POST", "https://api.github.com/gists"],
    ["POST", "https://api.github.com/graphql"],
    ["POST", "https://uploads.github.com/repos/a/b/releases/1/assets"],
    ["PUT", "https://ghcr.io/v2/attacker/img/manifests/latest"],
    ["PATCH", "https://api.github.com/repos/acme/widgets"],
  ]) {
    assert.deepEqual(verdict(method, url), { allow: false, rule: "write" }, `${method} ${url}`);
  }
});

test("package registries are read-only apart from npm's audit", () => {
  assert.ok(!allowed("PUT", "https://registry.npmjs.org/some-package"));
  assert.ok(!allowed("POST", "https://upload.pypi.org/legacy/"));
  assert.ok(allowed("POST", "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk"));
  assert.ok(allowed("POST", "https://registry.npmjs.org/-/npm/v1/security/audits/quick"));
});

test("the runner's own control-plane calls still work", () => {
  assert.ok(allowed("POST", `${RESULTS}/results.services.receiver.Receiver/GetStepLogsSignedBlobURL`));
  assert.ok(allowed("POST", "https://broker.actions.githubusercontent.com/message"));
  assert.ok(allowed("PATCH", "https://pipelinesghubeus12.actions.githubusercontent.com/x/_apis/distributedtask/timeline"));
});

test("the results API allows the cache read and step updates and nothing else, in any version", () => {
  assert.ok(allowed("POST", `${RESULTS}/github.actions.results.api.v1.CacheService/GetCacheEntryDownloadURL`));
  // Observed live on 2026-09-28: the runner reports every step's status through this call.
  assert.ok(allowed("POST", `${RESULTS}/github.actions.results.api.v1.WorkflowStepUpdateService/WorkflowStepsUpdate`));
  for (const path of [
    "github.actions.results.api.v1.CacheService/CreateCacheEntry",
    "github.actions.results.api.v1.CacheService/FinalizeCacheEntryUpload",
    "github.actions.results.api.v1.CacheService%2FCreateCacheEntry",
    "GITHUB.ACTIONS.RESULTS.API.V1.CACHESERVICE/CREATECACHEENTRY",
    "github.actions.results.api.v1.ArtifactService/CreateArtifact",
    "github.actions.results.api.v2.CacheService/CreateCacheEntry",
  ]) {
    assert.deepEqual(verdict("POST", `${RESULTS}/${path}`), { allow: false, rule: "results-api" }, path);
  }
  assert.deepEqual(verdict("POST", `https://results-receiver.actions.githubusercontent.com//twirp/github.actions.results.api.v1.CacheService/CreateCacheEntry`), { allow: false, rule: "results-api" });
});

test("the legacy cache and artifact APIs are read-only", () => {
  const caches = "https://acghubeus1.actions.githubusercontent.com/abc/_apis/artifactcache/caches";
  assert.ok(allowed("GET", `${caches}?keys=uv`));
  assert.deepEqual(verdict("POST", caches), { allow: false, rule: "cache-write" });
  assert.deepEqual(verdict("PATCH", `${caches}/42`), { allow: false, rule: "cache-write" });
  assert.deepEqual(verdict("POST", "https://pipelinesghubeus12.actions.githubusercontent.com/x/_apis/pipelines/workflows/9/artifacts"), { allow: false, rule: "artifact-write" });
});

test("a blob write goes only to an upload URL this job's control plane handed out", () => {
  assert.deepEqual(verdict("PUT", `${OURS}?sv=2023&sig=abc&comp=block&blockid=AA`), { allow: true, rule: "blob-upload" });
  assert.deepEqual(verdict("PUT", `${BLOB}/actions-results/attacker/drop.txt?sig=theirs`), { allow: false, rule: "blob-write" });
  assert.deepEqual(verdict("PUT", `${OURS}?sig=abc`, {}, new Set()), { allow: false, rule: "blob-write" });
});

test("upload URLs are collected from JSON however it escapes them", () => {
  const body = `{"logs_url":"${OURS.replaceAll("/", "\\/")}?sv=1\\u0026sig=x","other":"https://example.com/x"}`;
  assert.deepEqual(collectBlobUploads(body), [`productionresultssa7.blob.core.windows.net${new URL(OURS).pathname}`]);
});

test("a method override can make a read a write, never a write a read", () => {
  assert.ok(!allowed("GET", "https://api.github.com/gists", { "X-HTTP-Method-Override": "POST" }));
  assert.ok(!allowed("POST", "https://api.github.com/gists", { "X-HTTP-Method-Override": "GET" }));
  assert.ok(!allowed("PUT", "https://ghcr.io/v2/attacker/img/manifests/latest", { "X-HTTP-Method": "HEAD" }));
  assert.ok(!allowed("GET", "https://api.github.com/gists", { "X-Method-Override": "GET, POST" }));
  assert.ok(allowed("GET", "https://api.github.com/gists", { "X-HTTP-Method-Override": "GET" }));
});

test("a write through a dot segment is refused before any server can resolve it", () => {
  assert.deepEqual(verdict("POST", `https://results-receiver.actions.githubusercontent.com/x%2F..%2Ftwirp/github.actions.results.api.v1.CacheService/CreateCacheEntry`), { allow: false, rule: "dot-segment" });
  assert.deepEqual(verdict("POST", "https://acghubeus1.actions.githubusercontent.com/_apis/foo%2F..%2Fartifactcache/caches"), { allow: false, rule: "dot-segment" });
  assert.ok(allowed("GET", "https://github.com/a/../b"));
});

test("a write whose path does not decode is refused", () => {
  assert.deepEqual(verdict("POST", "https://api.github.com/x/%E0%A4%A"), { allow: false, rule: "undecodable-path" });
});

test("a write to a host outside every rule is refused", () => {
  assert.deepEqual(verdict("POST", "https://evil.example/collect"), { allow: false, rule: "write" });
  assert.ok(!allowed("POST", "https://x.actions.githubusercontent.com.evil.example/collect"));
});
