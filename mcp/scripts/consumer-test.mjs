// Copied into a fresh directory by test-package.mjs. Imports must resolve from the installed tarball.
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHash } from 'node:crypto';

const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error('Unexpected outbound request'); };
const { createSkillsServer } = await import('skill-server');
const { FsStore } = await import('skill-server/fs');
const { buildSnapshot } = await import('skill-server/http');
assert.equal(typeof createSkillsServer, 'function');
const pkg = join(process.cwd(), 'node_modules/skill-server');
const root = join(pkg, 'examples');
assert.equal(new FsStore(root).skills().length, 1);
const cli = join(pkg, 'dist/cli.js');
const { version } = JSON.parse(readFileSync(join(pkg, 'package.json')));
assert.equal(spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8' }).stdout.trim(), version);
assert.equal(spawnSync(process.execPath, [cli, 'stdio'], { encoding: 'utf8' }).status, 1);
assert.equal(spawnSync(process.execPath, [cli, '--help']).status, 0);

// --strict turns a scan diagnostic into a hard failure: `build` exits before
// writing anything to --out, and `stdio` exits before opening its transport.
const strictRoot = mkdtempSync(join(tmpdir(), 'skill-server-strict-'));
cpSync(join(root, 'hello'), join(strictRoot, 'hello'), { recursive: true });
mkdirSync(join(strictRoot, 'not-a-skill'));
writeFileSync(join(strictRoot, 'not-a-skill', 'notes.txt'), 'not a skill\n');
const strictOut = join(process.cwd(), 'strict-out');
const strictBuild = spawnSync(process.execPath, [cli, 'build', '--root', strictRoot, '--out', strictOut, '--base-url', 'https://example.org', '--strict'], { encoding: 'utf8' });
assert.equal(strictBuild.status, 1);
assert(strictBuild.stderr.includes('[skills] skipped not-a-skill:'));
assert(strictBuild.stderr.includes('--strict'));
assert(!existsSync(strictOut));
const lenientBuild = spawnSync(process.execPath, [cli, 'build', '--root', strictRoot, '--out', strictOut, '--base-url', 'https://example.org'], { encoding: 'utf8' });
assert.equal(lenientBuild.status, 0);
assert(lenientBuild.stderr.includes('[skills] skipped not-a-skill:'));
assert(existsSync(strictOut));
const strictStdio = spawnSync(process.execPath, [cli, 'stdio', '--root', strictRoot, '--strict'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
assert.equal(strictStdio.status, 1);

const snapshot = join(process.cwd(), 'snapshot');
buildSnapshot({ root, out: snapshot, baseUrl: 'https://example.org' });
buildSnapshot({ root, out: join(process.cwd(), 'snapshot-two'), baseUrl: 'https://example.org' });
const archive = readFileSync(join(snapshot, 'public/downloads/hello/skill.tgz'));
assert.deepEqual(archive, readFileSync('snapshot-two/public/downloads/hello/skill.tgz'));
assert(!readFileSync(join(snapshot, 'public/skill/hello.md'), 'utf8').includes('skills.cloudcompute.com'));
assert.throws(() => buildSnapshot({ root, out: root, baseUrl: 'https://example.org' }));
globalThis.fetch = originalFetch;
const client = new Client({ name: 'consumer', version: '1' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [cli, 'stdio', '--root', root] }));
  assert.equal(client.getServerVersion().version, version);
  assert((await client.listResources()).resources.length > 0);
  assert((await client.readResource({ uri: 'skill://hello/SKILL.md' })).contents.length > 0);
} finally { await client.close(); }
const server = spawn(process.execPath, [cli, 'serve', '--snapshot', snapshot, '--port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
const origin = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => { server.kill(); reject(new Error(log || 'Server startup timed out')); }, 10_000);
  server.once('exit', code => { clearTimeout(timeout); reject(new Error(`Server exited ${code}: ${log}`)); });
  server.stderr.on('data', data => { log += data; const match = log.match(/"port":(\d+)/); if (match) { clearTimeout(timeout); resolve(`http://127.0.0.1:${match[1]}`); } });
});
try {
  const homepage = await fetch(origin, { headers: { Accept: 'text/markdown' } });
  assert.equal(homepage.status, 200);
  assert((await homepage.text()).includes('/skill/hello.md'));
  const manifest = await (await fetch(`${origin}/manifest.json`)).json();
  const downloaded = Buffer.from(await (await fetch(`${origin}${manifest.skills[0].download.archive}`)).arrayBuffer());
  assert.equal(createHash('sha256').update(downloaded).digest('hex'), manifest.skills[0].download.digest);
  const httpClient = new Client({ name: 'http-consumer', version: '1' });
  try {
    await httpClient.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`)));
    assert((await httpClient.listResources()).resources.length > 0);
  } finally { await httpClient.close(); }
  assert.equal((await fetch(`${origin}/mcp`, { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await fetch(`${origin}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'null' })).status, 400);
  assert.equal((await fetch(`${origin}/txt/hello/%252e%252e/package.json`)).status, 400);
} finally {
  server.kill();
  await new Promise(resolve => { if (server.exitCode !== null) resolve(); else server.once('exit', resolve); });
}
console.log('Installed package consumer checks passed');
