// Keeps the published skill-server release equal to what deploys. The packed tarball is
// byte-reproducible and carries the Worker, so its digest is the deployed code's identity.
// A tarball that matches its version's release needs nothing; a new version needs a
// CHANGELOG section and is released after deploy; changed bytes under a released version fail.
// Usage: node release-version.mjs <candidate dir> <changelog>
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
const [candidate, changelog] = process.argv.slice(2);
const { version, digest } = JSON.parse(readFileSync(`${candidate}/source.json`, 'utf8'));
const tag = `skill-server-v${version}`;
let released;
try {
  released = execFileSync('gh', ['release', 'download', tag, '--repo', process.env.GITHUB_REPOSITORY, '--pattern', 'SHA256SUMS', '--output', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).split(/\s+/)[0];
} catch (error) {
  if (!/release not found/i.test(String(error.stderr))) throw error;
}
const output = release => process.env.GITHUB_OUTPUT && appendFileSync(process.env.GITHUB_OUTPUT, `release=${release}\nversion=${version}\n`);
if (released === digest) {
  console.log(`Package matches ${tag} (${digest})`);
  output(false);
} else if (released) {
  console.error(`The package changed since ${tag} was released (${released} → ${digest}). Bump mcp/package.json to a new version and add its CHANGELOG section.`);
  process.exit(1);
} else if (!new RegExp(`^## \\[${version.replaceAll('.', '\\.')}\\]`, 'm').test(readFileSync(changelog, 'utf8'))) {
  console.error(`${tag} is unreleased but ${changelog} has no "## [${version}]" section.`);
  process.exit(1);
} else {
  console.log(`${tag} will be released after deploy (${digest})`);
  output(true);
}
