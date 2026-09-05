import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const [origin, service] = process.argv.slice(2);
async function get(path, options = {}) {
  const response = await fetch(`${origin}${path}`, { ...options, signal: AbortSignal.timeout(10_000) });
  assert(response.ok, `${path}: HTTP ${response.status}`);
  return response;
}
let version;
for (let attempt = 0; attempt < 12; attempt++) {
  try { version = await (await get(`/version.json?commit=${process.env.GITHUB_SHA}`)).json(); if (version.sourceSha === process.env.GITHUB_SHA) break; } catch {}
  await new Promise(resolve => setTimeout(resolve, 5000));
}
assert.equal(version?.sourceSha, process.env.GITHUB_SHA, 'production commit mismatch');
await get('/');
if (service === 'skills') {
  await get('/llms.txt');
  const catalog = await (await get('/manifest.json')).json();
  const skill = catalog.skills[0];
  assert(skill?.download);
  await get(`/skill/${skill.entry.frontmatter.name}.html`);
  const bytes = await (await get(skill.download.archive)).arrayBuffer();
  assert.equal(createHash('sha256').update(new Uint8Array(bytes)).digest('hex'), skill.download.digest);
  const rpc = await (await get('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'skills/list', params: {} }) })).json();
  assert(rpc.result?.skills.length > 0);
} else {
  const catalog = await (await get('/data.json')).json();
  assert(catalog.skills.length > 0);
}
const report = `Verified ${origin} at ${version.sourceSha}\n\n${JSON.stringify(version)}\n`;
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
