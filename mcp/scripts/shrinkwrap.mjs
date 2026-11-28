// Writes npm-shrinkwrap.json, the runtime dependency tree the hosted Worker installs with npm ci.
// It is packed, so identity covers every dependency version that serves. Versions follow
// bun.lock, so the tests run what deploys.
// Usage: node scripts/shrinkwrap.mjs [--check]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const target = join(root, 'npm-shrinkwrap.json');
const { name, version, dependencies, engines } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
// bun.lock is JSON with trailing commas. Its top-level keys hold the hoisted version of each package.
const packages = JSON.parse(readFileSync(join(root, 'bun.lock'), 'utf8').replace(/,(\s*[}\]])/g, '$1')).packages;
const locked = Object.fromEntries(Object.entries(packages)
  .filter(([key]) => !key.replace(/^@[^/]+\//, '').includes('/'))
  .map(([key, [spec]]) => [key, spec.slice(spec.lastIndexOf('@') + 1)]));
const pinned = Object.fromEntries(Object.keys(dependencies).map(key => [key, locked[key]]));
const overrides = Object.fromEntries(Object.entries(locked).filter(([key]) => !(key in dependencies)));
const scratch = mkdtempSync(join(tmpdir(), 'skill-server-shrinkwrap-'));
try {
  writeFileSync(join(scratch, 'package.json'), JSON.stringify({ name, version, dependencies: pinned, overrides }));
  execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund', '--lockfile-version', '3'], { cwd: scratch, stdio: 'inherit' });
  const lock = JSON.parse(readFileSync(join(scratch, 'package-lock.json'), 'utf8'));
  lock.packages[''] = { name, version, license: lock.packages[''].license, dependencies, engines };
  const resolved = `${JSON.stringify(lock, null, 2)}\n`;
  if (process.argv.includes('--check')) {
    if (!existsSync(target) || readFileSync(target, 'utf8') !== resolved) {
      console.error('npm-shrinkwrap.json does not match package.json and bun.lock. Run `node scripts/shrinkwrap.mjs` in mcp/ and commit the result.');
      process.exit(1);
    }
    console.log('npm-shrinkwrap.json matches package.json and bun.lock');
  } else {
    writeFileSync(target, resolved);
    console.log(`Wrote npm-shrinkwrap.json for ${name} ${version}`);
  }
} finally { rmSync(scratch, { recursive: true, force: true }); }
