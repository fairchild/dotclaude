import { mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
mkdirSync('webui-release/public', { recursive: true });
for (const file of ['index.html', 'app.js', 'styles.css', 'data.json']) copyFileSync(`webui/${file}`, `webui-release/public/${file}`);
writeFileSync('webui-release/public/version.json', JSON.stringify({ sourceSha: process.env.GITHUB_SHA }));
writeFileSync('webui-release/wrangler.toml', 'name = "claude-code-config-ui"\ncompatibility_date = "2024-12-01"\n[assets]\ndirectory = "public"\n');
