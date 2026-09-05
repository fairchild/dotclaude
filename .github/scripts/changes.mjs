import { execFileSync } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';
import { affected } from './paths.mjs';
const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
const base = event.pull_request?.base.sha ?? event.before;
const head = event.pull_request?.head.sha ?? process.env.GITHUB_SHA;
const all = !base || /^0+$/.test(base) || process.env.GITHUB_EVENT_NAME === 'workflow_dispatch';
const files = all ? [] : execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', base, head], { encoding: 'utf8' }).split('\0').filter(Boolean);
for (const [name, enabled] of Object.entries(affected(files, all))) {
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${enabled}\n`);
  console.log(`${name}: ${enabled}`);
}
