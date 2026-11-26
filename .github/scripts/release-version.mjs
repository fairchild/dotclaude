// Keeps the published skill-server release equal to what deploys. source.json's identity hashes
// every packed file plus the Worker adapter and config, so it names the deployed code.
// Code matching its version's release needs nothing; a new version needs a CHANGELOG section
// and is released after deploy; changed code under a released version fails.
// Usage: node release-version.mjs <candidate dir> <changelog>
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
const [candidate, changelog] = process.argv.slice(2);
const { version, digest, identity } = JSON.parse(readFileSync(`${candidate}/source.json`, 'utf8'));
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version)) throw new Error(`Not a release version: ${version}`);
const tag = `skill-server-v${version}`;
let released;
try {
  released = JSON.parse(execFileSync('gh', ['release', 'download', tag, '--repo', process.env.GITHUB_REPOSITORY, '--pattern', 'source.json', '--output', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
} catch (error) {
  if (!/release not found/i.test(String(error.stderr))) throw error;
}
const output = release => process.env.GITHUB_OUTPUT && appendFileSync(process.env.GITHUB_OUTPUT, `release=${release}\nversion=${version}\n`);
// Releases before identity existed compare by tarball digest.
const same = released && (released.identity ? released.identity === identity : released.digest === digest);
if (same) {
  console.log(`Code matches ${tag} (${identity})`);
  output(false);
} else if (released) {
  console.error(`The package or Worker code changed since ${tag} was released. Bump mcp/package.json to a new version and add its CHANGELOG section.`);
  process.exit(1);
} else if (!readFileSync(changelog, 'utf8').split('\n').some(line => line.startsWith(`## [${version}]`))) {
  console.error(`${tag} is unreleased but ${changelog} has no "## [${version}]" section.`);
  process.exit(1);
} else {
  console.log(`${tag} will be released after deploy (${identity})`);
  output(true);
}
