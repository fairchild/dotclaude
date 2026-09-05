import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const { version } = JSON.parse(readFileSync('package.json'));
const name = `skill-server-${version}.tgz`;
const digest = createHash('sha256').update(readFileSync(`out/${name}`)).digest('hex');
writeFileSync('out/SHA256SUMS', `${digest}  ${name}\n`);
writeFileSync('out/source.json', JSON.stringify({ version, sha: process.env.GITHUB_SHA, digest, repository: process.env.GITHUB_REPOSITORY, runId: process.env.GITHUB_RUN_ID }, null, 2));
writeFileSync('out/RELEASE.md', `GitHub-only candidate of the experimental Skills over MCP implementation. No npm publication.\n\nSource: ${process.env.GITHUB_SHA}\n\nInstall into a fresh directory:\n\n\`\`\`sh\nnpm install https://github.com/fairchild/dotclaude/releases/download/skill-server-v${version}/${name}\nnpx --no-install skill-server --help\n\`\`\`\n\nRequires Node 22.14 or newer. Runtime dependencies are downloaded from npm. See the packaged README for the explicit-root stdio, snapshot build and HTTP commands. HTTP is stateless; deployment authentication and historical snapshot retention remain operator responsibilities.\n`);
