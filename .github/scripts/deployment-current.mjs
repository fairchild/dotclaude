// Decides whether this run still holds the newest inputs for a deployment. A newer commit on main
// that touches them has its own run, which deploys instead, so this one reports current=false and
// its deploy steps skip. Inputs that cannot be compared fail the run.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { affected } from './paths.mjs';
const repository = process.env.GITHUB_REPOSITORY;
const source = process.env.GITHUB_SHA;
const output = current => process.env.GITHUB_OUTPUT && appendFileSync(process.env.GITHUB_OUTPUT, `current=${current}\n`);
const latest = execFileSync('gh', ['api', `repos/${repository}/commits/main`, '--jq', '.sha'], { encoding: 'utf8' }).trim();
if (latest !== source) {
  const comparison = JSON.parse(execFileSync('gh', ['api', `repos/${repository}/compare/${source}...${latest}`], { encoding: 'utf8' }));
  if (comparison.status !== 'ahead' || !comparison.files || comparison.files.length >= 300) throw new Error('Cannot establish current deployment inputs; rerun CI on main');
  const files = comparison.files.flatMap(file => [file.filename, file.previous_filename].filter(Boolean));
  if (affected(files)[process.argv[2]]) {
    console.log(`::notice::Superseded by ${latest}, whose run deploys these inputs`);
    output(false);
    process.exit(0);
  }
}
console.log(`Deployment inputs remain current at ${source}`);
output(true);
