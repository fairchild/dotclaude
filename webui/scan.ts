#!/usr/bin/env bun
/**
 * Scans ~/.claude configuration and generates data.json for the webui
 */

import { readdir, readFile, stat } from "fs/promises";
import { join, basename } from "path";

const CLAUDE_DIR = process.env.CLAUDE_DIR || `${process.env.HOME}/.claude`;

// CLI Arguments
const args = process.argv.slice(2);
const skipValidation = args.includes("--skip-validation");

// URL Validation Types
interface UrlToValidate {
  url: string;
  type: "marketplace" | "plugin";
  source: {
    marketplace: string;
    plugin?: string;
  };
}

interface CacheEntry {
  status: number;
  validatedAt: string;
}

interface LinkCache {
  version: 1;
  ttlHours: number;
  entries: Record<string, CacheEntry>;
}

interface ValidationResult {
  url: string;
  status: number;
  ok: boolean;
  source: UrlToValidate["source"];
  type: UrlToValidate["type"];
  cached: boolean;
}

interface ValidationError {
  url: string;
  status: number;
  type: "marketplace" | "plugin";
  marketplace: string;
  plugin?: string;
  suggestion: string;
}

const CACHE_PATH = join(import.meta.dir, ".link-cache.json");
const DEFAULT_TTL_HOURS = 24;

interface Command {
  name: string;
  filename: string;
  description: string;
  content: string;
}

interface Agent {
  name: string;
  filename: string;
  description: string;
  model?: string;
  color?: string;
  tools?: string[];
  content: string;
}

interface Skill {
  name: string;
  dirname: string;
  description: string;
  model?: string;
  color?: string;
  license?: string;
  author?: string;
  source?: string;
  isExternal: boolean;
  hasScripts: boolean;
  hasReferences: boolean;
  hasAssets: boolean;
  content: string;
}

interface PluginSourceInfo {
  name: string;
  sourceType: "url" | "path" | "root";
  sourceUrl?: string;  // For url type: direct GitHub URL
  sourcePath?: string; // For path type: relative path in repo
}

interface Marketplace {
  name: string;
  repo: string;
  lastUpdated: string;
  pluginSources: PluginSourceInfo[];
}

interface InstalledPlugin {
  name: string;
  marketplace: string;
  scope: string;
  version: string;
  projectPath?: string;
  installedAt: string;
}

interface McpServer {
  name: string;
  type: string;
  command: string;
  args: string[];
  envKeys: string[];
  rawConfig: object;
  url?: string;
}

interface Script {
  name: string;
  filename: string;
  type: 'ts' | 'py' | 'sh' | 'unknown';
  description: string;
  content: string;
}

interface ConfigData {
  scannedAt: string;
  commands: Command[];
  agents: Agent[];
  skills: Skill[];
  scripts: Script[];
  marketplaces: Marketplace[];
  installedPlugins: InstalledPlugin[];
  mcpServers: McpServer[];
}

function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  const frontmatter: Record<string, unknown> = {};
  const lines = match[1].split("\n");

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value: unknown = line.slice(colonIdx + 1).trim();

    // Handle arrays (tools list)
    if (value === "") {
      const nextLineIdx = lineIdx + 1;
      const arrayItems: string[] = [];
      for (let i = nextLineIdx; i < lines.length; i++) {
        const item = lines[i];
        if (item.trim().startsWith("- ")) {
          arrayItems.push(item.trim().slice(2));
        } else if (item.trim() && !item.trim().startsWith("-")) {
          break;
        }
      }
      if (arrayItems.length > 0) value = arrayItems;
    }

    frontmatter[key] = value;
  }

  return { frontmatter, body: match[2] };
}

async function scanCommands(): Promise<Command[]> {
  const commands: Command[] = [];
  const dir = join(CLAUDE_DIR, "commands");

  try {
    const files = await readdir(dir);
    for (const file of files) {
      if (!file.endsWith(".md")) continue;

      const content = await readFile(join(dir, file), "utf-8");
      const { frontmatter, body } = parseFrontmatter(content);

      commands.push({
        name: file.replace(".md", ""),
        filename: file,
        description: (frontmatter.description as string) || "",
        content: body.trim(),
      });
    }
  } catch (e) {
    console.error("Error scanning commands:", e);
  }

  return commands.sort((a, b) => a.name.localeCompare(b.name));
}

async function scanAgents(): Promise<Agent[]> {
  const agents: Agent[] = [];
  const dir = join(CLAUDE_DIR, "agents");

  try {
    const files = await readdir(dir);
    for (const file of files) {
      if (!file.endsWith(".md") || file === "AGENTS-README.md") continue;

      const content = await readFile(join(dir, file), "utf-8");
      const { frontmatter, body } = parseFrontmatter(content);

      agents.push({
        name: (frontmatter.name as string) || file.replace(".md", ""),
        filename: file,
        description: (frontmatter.description as string) || "",
        model: frontmatter.model as string | undefined,
        color: frontmatter.color as string | undefined,
        tools: frontmatter.tools as string[] | undefined,
        content: body.trim(),
      });
    }
  } catch (e) {
    console.error("Error scanning agents:", e);
  }

  return agents.sort((a, b) => a.name.localeCompare(b.name));
}

async function scanSkills(): Promise<Skill[]> {
  const skills: Skill[] = [];
  const dir = join(CLAUDE_DIR, "skills");

  try {
    const entries = await readdir(dir);

    for (const entry of entries) {
      const entryPath = join(dir, entry);
      const entryStat = await stat(entryPath);

      // Skip .skill files (ZIP archives for distribution, not readable as text)
      if (entry.endsWith(".skill")) {
        continue;
      }

      // Handle directories with SKILL.md
      if (entryStat.isDirectory()) {
        const skillMdPath = join(entryPath, "SKILL.md");
        try {
          const content = await readFile(skillMdPath, "utf-8");
          const { frontmatter, body } = parseFrontmatter(content);

          // Check for subdirectories
          const subentries = await readdir(entryPath);

          const author = frontmatter.author as string | undefined;
          const source = frontmatter.source as string | undefined;

          skills.push({
            name: (frontmatter.name as string) || entry,
            dirname: entry,
            description: (frontmatter.description as string) || "",
            model: frontmatter.model as string | undefined,
            color: frontmatter.color as string | undefined,
            license: frontmatter.license as string | undefined,
            author,
            source,
            isExternal: !!(author || source),
            hasScripts: subentries.includes("scripts"),
            hasReferences: subentries.includes("references"),
            hasAssets: subentries.includes("assets"),
            content: body.trim(),
          });
        } catch {
          // No SKILL.md, skip this directory
        }
      }
    }
  } catch (e) {
    console.error("Error scanning skills:", e);
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

function parseScriptDescription(content: string, type: Script['type']): string {
  switch (type) {
    case 'py': {
      // Python docstring: """...""" or '''...'''
      const match = content.match(/^(?:#![^\n]*\n)?(?:\s*\n)*(?:"""([^"]*?)"""|'''([^']*?)''')/);
      return (match?.[1] || match?.[2] || '').trim();
    }
    case 'ts': {
      // JSDoc: /** ... */
      const match = content.match(/^(?:#![^\n]*\n)?(?:\s*\n)*\/\*\*\s*\n?\s*\*?\s*([^@*][^\n]*)/);
      return (match?.[1] || '').trim();
    }
    case 'sh': {
      // Shell: first # comment after shebang
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#!')) continue;
        if (line === '') continue;
        if (line.startsWith('#')) {
          return line.slice(1).trim();
        }
        break;
      }
      return '';
    }
    default:
      return '';
  }
}

async function scanScripts(): Promise<Script[]> {
  const scripts: Script[] = [];
  const dir = join(CLAUDE_DIR, "scripts");

  // Skip config/metadata files and tests
  const skipPatterns = [
    /^\./, // hidden files
    /\.test\.(ts|js)$/, // test files
    /\.spec\.(ts|js)$/, // spec files
    /^(package|tsconfig|bun\.lock)/i, // config files
  ];

  try {
    const files = await readdir(dir);
    for (const file of files) {
      // Skip non-script files
      if (skipPatterns.some(p => p.test(file))) continue;

      const filePath = join(dir, file);
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) continue;

      // Determine type from extension - skip unknown types
      let type: Script['type'] = 'unknown';
      if (file.endsWith('.ts') || file.endsWith('.js')) type = 'ts';
      else if (file.endsWith('.py')) type = 'py';
      else if (file.endsWith('.sh') || file.endsWith('.bash')) type = 'sh';

      // Skip files we can't identify as scripts
      if (type === 'unknown') continue;

      const content = await readFile(filePath, "utf-8");
      const description = parseScriptDescription(content, type);

      scripts.push({
        name: file.replace(/\.[^.]+$/, ''),
        filename: file,
        type,
        description,
        content,
      });
    }
  } catch (e) {
    console.error("Error scanning scripts:", e);
  }

  return scripts.sort((a, b) => a.name.localeCompare(b.name));
}

function parsePluginSource(pluginDef: { name: string; source: unknown }): PluginSourceInfo {
  const source = pluginDef.source;

  // URL source: { source: "url", url: "https://github.com/..." }
  if (typeof source === "object" && source !== null && "url" in source) {
    const urlSource = source as { url: string };
    // Strip .git suffix if present
    const cleanUrl = urlSource.url.replace(/\.git$/, "");
    return {
      name: pluginDef.name,
      sourceType: "url",
      sourceUrl: cleanUrl,
    };
  }

  // Path source: "./path/to/plugin" or "./.claude-plugin/plugins/name"
  if (typeof source === "string") {
    // "./" means the plugin is the whole repo
    if (source === "./" || source === ".") {
      return {
        name: pluginDef.name,
        sourceType: "root",
      };
    }
    // Relative path within repo
    return {
      name: pluginDef.name,
      sourceType: "path",
      sourcePath: source.replace(/^\.\//, ""), // Remove leading ./
    };
  }

  // Unknown format, fallback to default path assumption
  return {
    name: pluginDef.name,
    sourceType: "path",
    sourcePath: `plugins/${pluginDef.name}`,
  };
}

async function scanMarketplaces(): Promise<Marketplace[]> {
  const marketplaces: Marketplace[] = [];
  const knownPath = join(CLAUDE_DIR, "plugins", "known_marketplaces.json");

  try {
    const content = await readFile(knownPath, "utf-8");
    const data = JSON.parse(content);

    for (const [name, info] of Object.entries(data)) {
      const mp = info as {
        source: { repo: string };
        installLocation: string;
        lastUpdated: string;
      };

      // Read marketplace.json to get plugin sources
      const pluginSources: PluginSourceInfo[] = [];
      try {
        // Try .claude-plugin/marketplace.json first, then root marketplace.json
        let marketplaceJson: string | null = null;
        const paths = [
          join(mp.installLocation, ".claude-plugin", "marketplace.json"),
          join(mp.installLocation, "marketplace.json"),
        ];

        for (const p of paths) {
          try {
            marketplaceJson = await readFile(p, "utf-8");
            break;
          } catch {
            continue;
          }
        }

        if (marketplaceJson) {
          const mpData = JSON.parse(marketplaceJson);
          for (const plugin of mpData.plugins || []) {
            pluginSources.push(parsePluginSource(plugin));
          }
        }
      } catch {
        // Couldn't read marketplace.json, pluginSources stays empty
      }

      marketplaces.push({
        name,
        repo: mp.source.repo,
        lastUpdated: mp.lastUpdated,
        pluginSources,
      });
    }
  } catch (e) {
    console.error("Error scanning marketplaces:", e);
  }

  return marketplaces.sort((a, b) => a.name.localeCompare(b.name));
}

async function scanInstalledPlugins(): Promise<InstalledPlugin[]> {
  const plugins: InstalledPlugin[] = [];
  const path = join(CLAUDE_DIR, "plugins", "installed_plugins.json");

  try {
    const content = await readFile(path, "utf-8");
    const data = JSON.parse(content);

    for (const [fullName, installations] of Object.entries(data.plugins || {})) {
      const [name, marketplace] = fullName.split("@");
      const installs = installations as Array<{
        scope: string;
        version: string;
        projectPath?: string;
        installedAt: string;
      }>;

      for (const install of installs) {
        plugins.push({
          name,
          marketplace,
          scope: install.scope,
          version: install.version,
          projectPath: install.projectPath,
          installedAt: install.installedAt,
        });
      }
    }
  } catch (e) {
    console.error("Error scanning installed plugins:", e);
  }

  return plugins.sort((a, b) => a.name.localeCompare(b.name));
}

async function loadMcpUrls(): Promise<Record<string, string>> {
  try {
    const urlsPath = join(CLAUDE_DIR, ".mcp-urls.json");
    const content = await readFile(urlsPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function scanMcpServers(): Promise<McpServer[]> {
  const servers: McpServer[] = [];
  const path = join(CLAUDE_DIR, ".mcp.json");
  const mcpUrls = await loadMcpUrls();

  try {
    const content = await readFile(path, "utf-8");
    const data = JSON.parse(content);

    for (const [name, config] of Object.entries(data.mcpServers || {})) {
      const srv = config as {
        type: string;
        command: string;
        args?: string[];
        env?: Record<string, string>;
      };

      servers.push({
        name,
        type: srv.type,
        command: srv.command,
        args: srv.args || [],
        envKeys: Object.keys(srv.env || {}),
        rawConfig: { [name]: config },
        url: mcpUrls[name],
      });
    }
  } catch (e) {
    console.error("Error scanning MCP servers:", e);
  }

  return servers.sort((a, b) => a.name.localeCompare(b.name));
}

// URL Validation Functions

function collectUrls(data: ConfigData): UrlToValidate[] {
  const urls: UrlToValidate[] = [];

  // Build lookup maps from marketplace data
  const mpMap = new Map(data.marketplaces.map((m) => [m.name, m]));

  // Marketplace repo URLs
  for (const mp of data.marketplaces) {
    urls.push({
      url: `https://github.com/${mp.repo}`,
      type: "marketplace",
      source: { marketplace: mp.name },
    });
  }

  // Plugin URLs (use actual source info from marketplace.json)
  for (const plugin of data.installedPlugins) {
    const mp = mpMap.get(plugin.marketplace);
    if (!mp) continue;

    // Find plugin source info
    const sourceInfo = mp.pluginSources.find((ps) => ps.name === plugin.name);

    let url: string;
    if (sourceInfo) {
      switch (sourceInfo.sourceType) {
        case "url":
          // Direct URL to separate repo
          url = sourceInfo.sourceUrl!;
          break;
        case "root":
          // Plugin is the whole marketplace repo
          url = `https://github.com/${mp.repo}`;
          break;
        case "path":
          // Relative path within marketplace repo
          url = `https://github.com/${mp.repo}/tree/main/${sourceInfo.sourcePath}`;
          break;
        default:
          // Fallback to default path
          url = `https://github.com/${mp.repo}/tree/main/plugins/${plugin.name}`;
      }
    } else {
      // No source info found, fallback to default path
      url = `https://github.com/${mp.repo}/tree/main/plugins/${plugin.name}`;
    }

    urls.push({
      url,
      type: "plugin",
      source: { marketplace: plugin.marketplace, plugin: plugin.name },
    });
  }

  return urls;
}

async function loadCache(): Promise<LinkCache> {
  try {
    const content = await readFile(CACHE_PATH, "utf-8");
    return JSON.parse(content);
  } catch {
    return { version: 1, ttlHours: DEFAULT_TTL_HOURS, entries: {} };
  }
}

async function saveCache(cache: LinkCache): Promise<void> {
  await Bun.write(CACHE_PATH, JSON.stringify(cache, null, 2));
}

function isCacheValid(entry: CacheEntry, ttlHours: number): boolean {
  const validatedAt = new Date(entry.validatedAt);
  const expiresAt = new Date(validatedAt.getTime() + ttlHours * 60 * 60 * 1000);
  return new Date() < expiresAt;
}

async function validateUrl(url: string): Promise<{ status: number }> {
  try {
    const response = await fetch(url, { method: "HEAD" });
    return { status: response.status };
  } catch {
    return { status: 0 };
  }
}

async function validateUrls(
  urls: UrlToValidate[],
  cache: LinkCache,
  concurrency = 5
): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];
  const toValidate: UrlToValidate[] = [];

  // Check cache first
  for (const item of urls) {
    const cached = cache.entries[item.url];
    if (cached && isCacheValid(cached, cache.ttlHours)) {
      results.push({
        url: item.url,
        status: cached.status,
        ok: cached.status >= 200 && cached.status < 400,
        source: item.source,
        type: item.type,
        cached: true,
      });
    } else {
      toValidate.push(item);
    }
  }

  // Validate uncached URLs in parallel batches
  for (let i = 0; i < toValidate.length; i += concurrency) {
    const batch = toValidate.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (item) => {
        const { status } = await validateUrl(item.url);
        cache.entries[item.url] = {
          status,
          validatedAt: new Date().toISOString(),
        };
        return {
          url: item.url,
          status,
          ok: status >= 200 && status < 400,
          source: item.source,
          type: item.type,
          cached: false,
        };
      })
    );
    results.push(...batchResults);
  }

  return results;
}

function formatValidationErrors(failures: ValidationResult[]): ValidationError[] {
  return failures.map((f) => {
    let suggestion: string;
    if (f.type === "marketplace") {
      suggestion = `Check if repository "${f.source.marketplace}" exists at the expected location. The repo may have been renamed, moved, or made private.`;
    } else {
      suggestion = `Check if plugin "${f.source.plugin}" exists in the "${f.source.marketplace}" marketplace. The plugin path may not match the expected structure (plugins/{name}/).`;
    }

    return {
      url: f.url,
      status: f.status,
      type: f.type,
      marketplace: f.source.marketplace,
      plugin: f.source.plugin,
      suggestion,
    };
  });
}

function printValidationReport(errors: ValidationError[]): void {
  console.error("\n=== URL VALIDATION FAILED ===\n");

  for (const err of errors) {
    console.error(`[ERROR] ${err.type.toUpperCase()}: ${err.url}`);
    console.error(`  Status: ${err.status === 0 ? "Network Error" : err.status}`);
    console.error(`  Marketplace: ${err.marketplace}`);
    if (err.plugin) {
      console.error(`  Plugin: ${err.plugin}`);
    }
    console.error(`  Suggestion: ${err.suggestion}`);
    console.error("");
  }

  console.error("--- MACHINE READABLE ---");
  console.error(JSON.stringify({ validationErrors: errors }, null, 2));
  console.error("--- END ---\n");
}

async function main() {
  console.log("Scanning ~/.claude configuration...\n");

  const data: ConfigData = {
    scannedAt: new Date().toISOString(),
    commands: await scanCommands(),
    agents: await scanAgents(),
    skills: await scanSkills(),
    scripts: await scanScripts(),
    marketplaces: await scanMarketplaces(),
    installedPlugins: await scanInstalledPlugins(),
    mcpServers: await scanMcpServers(),
  };

  // URL Validation
  if (!skipValidation) {
    console.log("Validating URLs...");
    const urls = collectUrls(data);
    const cache = await loadCache();
    const results = await validateUrls(urls, cache);
    await saveCache(cache);

    const failures = results.filter((r) => !r.ok);
    const cached = results.filter((r) => r.cached).length;

    console.log(`  Checked: ${results.length} URLs (${cached} cached)`);

    if (failures.length > 0) {
      const errors = formatValidationErrors(failures);
      printValidationReport(errors);
      console.error(`data.json NOT written. Fix broken links or use --skip-validation.\n`);
      process.exit(1);
    }

    console.log("  All URLs valid.\n");
  } else {
    console.log("Skipping URL validation (--skip-validation)\n");
  }

  const outputPath = join(import.meta.dir, "data.json");
  await Bun.write(outputPath, JSON.stringify(data, null, 2));

  console.log(`Commands:     ${data.commands.length}`);
  console.log(`Agents:       ${data.agents.length}`);
  console.log(`Skills:       ${data.skills.length}`);
  console.log(`Scripts:      ${data.scripts.length}`);
  console.log(`Marketplaces: ${data.marketplaces.length}`);
  console.log(`Plugins:      ${data.installedPlugins.length}`);
  console.log(`MCP Servers:  ${data.mcpServers.length}`);
  console.log(`\nWritten to: ${outputPath}`);
}

main();
