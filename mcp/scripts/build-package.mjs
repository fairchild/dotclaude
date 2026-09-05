import { execFileSync } from 'node:child_process';
import { mkdirSync, copyFileSync, chmodSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
// Only remove this package's generated directory, never a caller-supplied path.
rmSync(join(root, 'dist'), { recursive: true, force: true });
execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.package.json'], { cwd: root, stdio: 'inherit' });
mkdirSync(join(root, 'dist/worker'), { recursive: true });
for (const name of ['index.html', 'skill.html', 'library.css']) copyFileSync(join(root, 'worker', name), join(root, 'dist/worker', name));
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
writeFileSync(join(root, 'dist/version.js'), `export const version = ${JSON.stringify(version)};\n`);
rmSync(join(root, 'dist/package.json'), { force: true });
copyFileSync(join(root, '../LICENSE'), join(root, 'LICENSE'));
chmodSync(join(root, 'dist/cli.js'), 0o755);
console.log(`Built skill-server ${version}`);
