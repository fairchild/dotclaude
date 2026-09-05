const patterns = {
  config: /^(skills\/|agents\/|scripts\/|settings.example.json$|dotagents.toml$|setup.sh$|README.md$|\.mcp.json$|\.gitignore$)/,
  package: /^(mcp\/|skills\/|LICENSE$)/,
  webui: /^(webui\/|commands\/|agents\/|skills\/|scripts\/|plugins\/|blog\/|mcp\/package.json$|mcp\/bun.lock$|README.md$|CLAUDE.md$|\.mcp(?:-urls)?\.json$)/,
  analyze: /^skills\/analyze-usage\//,
  persona: /^skills\/persona-memory\//,
  team: /^(skills\/team-memory\/|agents\/team-memory-sleep.md$|settings.example.json$)/,
};
export function affected(files, all = false) {
  const infrastructure = files.some(p => p.startsWith('.github/') || p === '.mise.toml');
  return Object.fromEntries(Object.entries(patterns).map(([name, pattern]) => [name, all || infrastructure || files.some(p => pattern.test(p))]));
}
