import { execFileSync } from 'node:child_process';
import { affected } from './paths.mjs';
const repository = process.env.GITHUB_REPOSITORY;
const source = process.env.GITHUB_SHA;
const latest = execFileSync('gh', ['api', `repos/${repository}/commits/main`, '--jq', '.sha'], { encoding: 'utf8' }).trim();
if (latest !== source) {
  const comparison = JSON.parse(execFileSync('gh', ['api', `repos/${repository}/compare/${source}...${latest}`], { encoding: 'utf8' }));
  if (comparison.status !== 'ahead' || !comparison.files || comparison.files.length >= 300) throw new Error('Cannot establish current deployment inputs; rerun CI on main');
  const files = comparison.files.flatMap(file => [file.filename, file.previous_filename].filter(Boolean));
  if (affected(files)[process.argv[2]]) throw new Error('Newer changes affect this deployment; use the newer run');
}
console.log(`Deployment inputs remain current at ${source}`);
