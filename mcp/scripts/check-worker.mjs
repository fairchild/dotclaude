import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const origin = 'http://127.0.0.1:8798';
const proc = spawn(resolve('node_modules/.bin/wrangler'), ['dev', '--config', '.worker-package/wrangler.toml', '--port', '8798'], { stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (proc.exitCode !== null) throw new Error('Worker exited before readiness');
    try { if ((await fetch(`${origin}/manifest.json`)).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error('Worker startup timed out');
  const test = spawn('bun', ['test', 'conformance/http-live.test.ts'], { stdio: 'inherit', env: { ...process.env, SKILLS_HTTP_ORIGIN: origin, SKILLS_SNAPSHOT_DIR: resolve('.worker-package/dist/public') } });
  const code = await new Promise(resolve => test.on('exit', resolve));
  if (code !== 0) throw new Error(`Worker integration failed (${code})`);
} finally { proc.kill('SIGTERM'); }
