import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'skill-server-consumer-'));
function run(command, args, cwd = scratch) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 180_000 });
  assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
function npm(args, cwd = scratch) {
  // Node's Windows distribution includes npm here; avoid cmd.exe argument re-parsing.
  return process.platform === 'win32'
    ? run(process.execPath, [join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), ...args], cwd)
    : run('npm', args, cwd);
}
try {
  let archive = process.argv[2] && resolve(process.argv[2]);
  if (!archive) {
    const report = JSON.parse(npm(['pack', '--json', '--pack-destination', scratch], root));
    const pack = Array.isArray(report) ? report[0] : report['skill-server'];
    archive = join(scratch, pack.filename);
    assert(pack.files.some(file => file.path === 'dist/cli.js'));
    assert(pack.files.some(file => file.path === 'LICENSE'));
    assert(pack.files.every(file => /^(dist\/|examples\/|LICENSE$|README.md$|package.json$)/.test(file.path)), 'unexpected package member');
  }
  writeFileSync(join(scratch, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', archive]);
  const actualVersion = JSON.parse(readFileSync(join(scratch, 'node_modules/skill-server/package.json'), 'utf8')).version;
  assert.equal(npm(['exec', '--no', '--', 'skill-server', '--version']).trim(), actualVersion);
  copyFileSync(join(root, 'scripts/consumer-test.mjs'), join(scratch, 'consumer-test.mjs'));
  run(process.execPath, ['consumer-test.mjs']);
  if (process.env.PACKAGE_OUTPUT_DIR) {
    mkdirSync(process.env.PACKAGE_OUTPUT_DIR, { recursive: true });
    const { version } = JSON.parse(readFileSync(join(scratch, 'node_modules/skill-server/package.json')));
    copyFileSync(archive, join(process.env.PACKAGE_OUTPUT_DIR, `skill-server-${version}.tgz`));
  }
  console.log('PASS: clean installed package, exports, CLI, stdio, HTTP, origin safety, archive reproducibility');
} finally { rmSync(scratch, { recursive: true, force: true }); }
