import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { t } from 'tar';
const { version } = JSON.parse(readFileSync('package.json'));
const name = `skill-server-${version}.tgz`;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = sha256(readFileSync(`out/${name}`));
// The deployed code's identity: every packed file's content plus the Worker adapter and config
// that prepare-worker.mjs adds. Hashing contents, not gzip bytes, keeps it independent of the
// toolchain that compressed the tarball.
const files = new Map();
t({ file: `out/${name}`, sync: true, onReadEntry: entry => {
  const chunks = [];
  entry.on('data', chunk => chunks.push(chunk));
  entry.on('end', () => files.set(entry.path, sha256(Buffer.concat(chunks))));
} });
for (const path of ['worker/worker.ts', 'worker/wrangler.toml']) files.set(path, sha256(readFileSync(path)));
const identity = sha256([...files].sort(([a], [b]) => a < b ? -1 : 1).map(([path, hash]) => `${hash}  ${path}\n`).join(''));
const changes = readFileSync('CHANGELOG.md', 'utf8').split(/^(?=## \[)/m).find(section => section.startsWith(`## [${version}]`))?.replace(/^.*\n/, '').replace(/^\[[^\]]+\]: .*$/gm, '').trim();
writeFileSync('out/SHA256SUMS', `${digest}  ${name}\n`);
writeFileSync('out/source.json', JSON.stringify({ version, sha: process.env.GITHUB_SHA, digest, identity, repository: process.env.GITHUB_REPOSITORY, runId: process.env.GITHUB_RUN_ID }, null, 2));
writeFileSync('out/RELEASE.md', `GitHub release of the Skills over MCP implementation, built from the commit that deployed it to https://skills.cloudcompute.com. No npm publication.\n\nSource: ${process.env.GITHUB_SHA}\n\nInstall into a fresh directory:\n\n\`\`\`sh\nnpm install https://github.com/fairchild/dotclaude/releases/download/skill-server-v${version}/${name}\nnpx --no-install skill-server --help\n\`\`\`\n\nRequires Node 22.14 or newer. Runtime dependencies are downloaded from npm. See the packaged README for the explicit-root stdio, snapshot build and HTTP commands. HTTP is stateless; deployment authentication and historical snapshot retention remain operator responsibilities.\n${changes ? `\n## Changes\n\n${changes}\n` : ''}`);
