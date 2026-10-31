import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decide } from "./egress.mjs";
import { createProxy, loadAllowlist } from "./proxy.mjs";

const RECEIVER = "https://results-receiver.actions.githubusercontent.com/twirp/results.services.receiver.Receiver";
const BLOB = "https://productionresultssa7.blob.core.windows.net/actions-results/run/job/logs/steps/step.txt";

const newProxy = () => createProxy({ allowed: loadAllowlist("build"), repo: "acme/widgets", enforce: true });

// Stand in for the results service: every upstream call answers with this body and status.
async function withUpstream(body, status, run) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (request) => {
    calls.push(request.url);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "content-encoding": "identity" } });
  };
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = real;
  }
}

// The proxy as a real job gets it, driven through the same hooks gondolin calls.
async function afterCall(method, body, status = 200) {
  const proxy = newProxy();
  await withUpstream(body, status, () => proxy.httpHooks.onRequest(new Request(`${RECEIVER}/${method}`, { method: "POST", body: "{}" })));
  return proxy.httpHooks.isRequestAllowed(new Request(`${BLOB}?sig=x&comp=block`, { method: "PUT" }));
}

test("an upload URL handed out by a signed-URL call can be written", async () => {
  assert.equal(await afterCall("GetStepLogsSignedBlobURL", { logs_url: `${BLOB}?sig=x` }), true);
});

test("the same URL echoed in an error body cannot", async () => {
  assert.equal(await afterCall("GetStepLogsSignedBlobURL", { msg: `bad request for ${BLOB}` }, 400), false);
});

test("the same URL in any other call's answer cannot", async () => {
  assert.equal(await afterCall("CreateStepLogsMetadata", { echo: `${BLOB}?sig=x` }), false);
});

test("the guest gets the results service's answer intact", async () => {
  const proxy = newProxy();
  const answer = await withUpstream({ logs_url: BLOB }, 200, () =>
    proxy.httpHooks.onRequest(new Request(`${RECEIVER}/GetStepLogsSignedBlobURL`, { method: "POST", body: "{}" })),
  );
  assert.equal(answer.status, 200);
  assert.equal(answer.headers.get("content-encoding"), null);
  assert.deepEqual(await answer.json(), { logs_url: BLOB });
});

test("every other request goes upstream through gondolin, untouched", async () => {
  const proxy = newProxy();
  await withUpstream({}, 200, async (calls) => {
    const url = "https://github.com/acme/widgets/git-upload-pack";
    const out = await proxy.httpHooks.onRequest(new Request(url, { method: "POST", body: "0000" }));
    assert.ok(out instanceof Request, "forwarded as a request, not answered");
    assert.equal(out.url, url);
    assert.deepEqual(calls, []);
  });
});

test("a signed-URL call on a host off the allowlist is never made by the proxy", async () => {
  const proxy = newProxy();
  await withUpstream({ logs_url: BLOB }, 200, async (calls) => {
    await proxy.httpHooks.onRequest(new Request("https://evil.example/twirp/results.services.receiver.Receiver/GetStepLogsSignedBlobURL", { method: "POST", body: "{}" }));
    assert.deepEqual(calls, []);
  });
});

test("hosts added through GONDOLIN_ALLOWLIST join the build profile and get reads only", () => {
  const file = join(mkdtempSync(join(tmpdir(), "allowlist-")), "extra.json");
  writeFileSync(file, JSON.stringify({ hosts: ["mirror.example"] }));
  process.env.GONDOLIN_ALLOWLIST = file;
  try {
    assert.ok(loadAllowlist("build").includes("mirror.example"));
    assert.ok(!loadAllowlist("actions").includes("mirror.example"));
  } finally {
    delete process.env.GONDOLIN_ALLOWLIST;
  }
  const verdict = (method) => decide({ method, url: "https://mirror.example/pkg", headers: new Headers() }, { repo: "acme/widgets" });
  assert.equal(verdict("GET").allow, true);
  assert.equal(verdict("PUT").allow, false);
});

test("a refreshed list in the state directory joins the shipped one", () => {
  const state = mkdtempSync(join(tmpdir(), "state-"));
  writeFileSync(join(state, "allowlist.json"), JSON.stringify({ hosts: ["productionresultssa999.blob.core.windows.net"] }));
  process.env.GONDOLIN_STATE = state;
  try {
    assert.ok(loadAllowlist("actions").includes("productionresultssa999.blob.core.windows.net"));
    assert.ok(loadAllowlist("actions").includes("github.com"));
  } finally {
    delete process.env.GONDOLIN_STATE;
  }
});

test("WebSocket upgrades stay off, since the policy never sees their frames", () => {
  assert.equal(newProxy().network.allowWebSockets, false);
});

test("a guest cannot grow the report without bound", async () => {
  const proxy = newProxy();
  const hook = proxy.httpHooks.isRequestAllowed;
  for (let i = 0; i < 1100; i++) await hook(new Request(`https://api.github.com/gists/${i}`, { method: "POST" }));
  const report = proxy.report();
  assert.ok(report.filter((line) => line.startsWith("--- refused")).length <= 1000);
  assert.ok(report.some((line) => line.includes("100 more requests")));
});
