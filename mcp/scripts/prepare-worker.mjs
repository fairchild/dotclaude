import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const archive = resolve(process.argv[2]);
const output = join(root, '.worker-package');
const scratch = mkdtempSync(join(tmpdir(), 'skill-worker-consumer-'));
try {
  writeFileSync(join(scratch, 'package.json'), '{"private":true,"type":"module"}');
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', archive], { cwd: scratch, stdio: 'inherit' });
  const { buildSnapshot } = await import(pathToFileURL(join(scratch, 'node_modules/skill-server/dist/http.js')));
  // Source telemetry stays in this deployment adapter, outside the reusable package.
  const adapter = readFileSync(join(root, 'worker/worker.ts'), 'utf8').replace('"./handler.ts"', '"skill-server/http"');
  writeFileSync(join(scratch, 'worker.ts'), adapter);
  const config = readFileSync(join(root, 'worker/wrangler.toml'), 'utf8');
  writeFileSync(join(scratch, 'wrangler.toml'), config);
  const { GITHUB_SHA, GITHUB_REPOSITORY, GITHUB_SERVER_URL = 'https://github.com' } = process.env;
  // The commit's own date keeps two builds of one commit identical; a depth-1 checkout has it.
  const sourceDate = execFileSync('git', ['log', '-1', '--format=%cI', GITHUB_SHA ?? 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() || undefined;
  buildSnapshot({
    root: join(root, '../skills'), out: join(scratch, 'dist'), baseUrl: 'https://skills.cloudcompute.com',
    sourceSha: GITHUB_SHA, sourceRepository: GITHUB_REPOSITORY && `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}`, sourceDate,
  });
  const packageDigest = createHash('sha256').update(readFileSync(archive)).digest('hex');
  const { version } = JSON.parse(readFileSync(join(scratch, 'node_modules/skill-server/package.json')));
  writeFileSync(join(scratch, 'dist/public/version.json'), JSON.stringify({ sourceSha: process.env.GITHUB_SHA ?? null, packageVersion: version, packageDigest }));
  execFileSync(join(root, 'node_modules/.bin/wrangler'), ['deploy', '--dry-run', '--outdir', 'bundle'], { cwd: scratch, stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output);
  cpSync(join(scratch, 'dist'), join(output, 'dist'), { recursive: true });
  cpSync(join(scratch, 'bundle'), join(output, 'bundle'), { recursive: true });
  writeFileSync(join(output, 'wrangler.toml'), config.replace('main = "worker.ts"', 'main = "bundle/worker.js"\nno_bundle = true'));
  console.log(`Prepared Worker from skill-server ${version}, sha256:${packageDigest}`);
} finally { rmSync(scratch, { recursive: true, force: true }); }
