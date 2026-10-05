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
const home = await get('/');
if (service === 'skills') {
  assert.equal(home.headers.get('strict-transport-security'), 'max-age=31536000', '/: HSTS');
  assert.match(home.headers.get('content-security-policy') ?? '', /^frame-ancestors 'none'$/, '/: framing policy');
  await get('/llms.txt');
  assert.match(await (await get('/robots.txt')).text(), /^Content-Signal:/m, '/robots.txt: Content-Signal (zone-managed robots.txt may be overriding the Worker)');
  const catalog = await (await get('/manifest.json')).json();
  const skill = catalog.skills[0];
  assert(skill?.download);
  const uris = catalog.skills.flatMap(({ entry }) => entry.resources.map(r => r.uri));
  const file = (uris.find(uri => !uri.endsWith('/SKILL.md')) ?? skill.entry.uri).slice('skill://'.length);
  const raw = await get(`/skills/${file.split('/').map(encodeURIComponent).join('/')}`);
  assert.equal(raw.headers.get('content-security-policy'), "sandbox; frame-ancestors 'none'", `${file}: sandbox policy`);
  await get(`/skill/${skill.entry.frontmatter.name}.html`);
  const bytes = await (await get(skill.download.archive)).arrayBuffer();
  assert.equal(createHash('sha256').update(new Uint8Array(bytes)).digest('hex'), skill.download.digest);
  const rpc = await (await get('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'skills/list', params: {} }) })).json();
  assert(rpc.result?.skills.length > 0);
  const init = await (await get('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'verify-deployment', version: '0.0.0' } } }) })).json();
  assert.equal(init.result?.serverInfo?.name, 'dotclaude-skills-hosted');
} else {
  const catalog = await (await get('/data.json')).json();
  assert(catalog.skills.length > 0);
}
const report = `Verified ${origin} at ${version.sourceSha}\n\n${JSON.stringify(version)}\n`;
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
