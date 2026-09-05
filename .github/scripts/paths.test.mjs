import { test } from 'node:test';
import assert from 'node:assert/strict';
import { affected } from './paths.mjs';
test('MCP and supporting resources trigger package verification', () => {
  for (const path of ['mcp/worker/worker.ts', 'mcp/bun.lock', 'skills/hello/scripts/run.sh']) assert(affected([path]).package, path);
});
test('WebUI generated content and static assets trigger a rebuild', () => {
  for (const path of ['blog/post.md', 'CLAUDE.md', 'webui/styles.css', 'webui/wrangler.toml', '.mcp-urls.json', 'scripts/catalog.py']) assert(affected([path]).webui, path);
});
test('workflow changes verify all lanes; unrelated documentation skips expensive jobs', () => {
  assert(Object.values(affected(['.github/workflows/ci.yml'])).every(Boolean));
  assert(Object.values(affected(['docs/skill-server-release-plan.md'])).every(value => !value));
  assert(Object.values(affected([], true)).every(Boolean));
});
