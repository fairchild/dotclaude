#!/usr/bin/env bun
/**
 * Scans ~/.claude configuration and generates data.json for the webui
 */

import { readdir, readFile, stat } from "fs/promises";
import { join, basename } from "path";

const CLAUDE_DIR = `${process.env.HOME}/.claude`;

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
  hasScripts: boolean;
  hasReferences: boolean;
  hasAssets: boolean;
  content: string;
}

interface Marketplace {
  name: string;
  repo: string;
  lastUpdated: string;
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
}

interface ConfigData {
  scannedAt: string;
  commands: Command[];
  agents: Agent[];
  skills: Skill[];
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

      // Handle .skill files
      if (entry.endsWith(".skill")) {
        const content = await readFile(entryPath, "utf-8");
        const { frontmatter, body } = parseFrontmatter(content);

        skills.push({
          name: (frontmatter.name as string) || entry.replace(".skill", ""),
          dirname: entry,
          description: (frontmatter.description as string) || "",
          model: frontmatter.model as string | undefined,
          color: frontmatter.color as string | undefined,
          license: frontmatter.license as string | undefined,
          hasScripts: false,
          hasReferences: false,
          hasAssets: false,
          content: body.trim(),
        });
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

          skills.push({
            name: (frontmatter.name as string) || entry,
            dirname: entry,
            description: (frontmatter.description as string) || "",
            model: frontmatter.model as string | undefined,
            color: frontmatter.color as string | undefined,
            license: frontmatter.license as string | undefined,
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

async function scanMarketplaces(): Promise<Marketplace[]> {
  const marketplaces: Marketplace[] = [];
  const path = join(CLAUDE_DIR, "plugins", "known_marketplaces.json");

  try {
    const content = await readFile(path, "utf-8");
    const data = JSON.parse(content);

    for (const [name, info] of Object.entries(data)) {
      const mp = info as { source: { repo: string }; lastUpdated: string };
      marketplaces.push({
        name,
        repo: mp.source.repo,
        lastUpdated: mp.lastUpdated,
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

async function scanMcpServers(): Promise<McpServer[]> {
  const servers: McpServer[] = [];
  const path = join(CLAUDE_DIR, ".mcp.json");

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
      });
    }
  } catch (e) {
    console.error("Error scanning MCP servers:", e);
  }

  return servers.sort((a, b) => a.name.localeCompare(b.name));
}

async function main() {
  console.log("Scanning ~/.claude configuration...\n");

  const data: ConfigData = {
    scannedAt: new Date().toISOString(),
    commands: await scanCommands(),
    agents: await scanAgents(),
    skills: await scanSkills(),
    marketplaces: await scanMarketplaces(),
    installedPlugins: await scanInstalledPlugins(),
    mcpServers: await scanMcpServers(),
  };

  const outputPath = join(import.meta.dir, "data.json");
  await Bun.write(outputPath, JSON.stringify(data, null, 2));

  console.log(`Commands:     ${data.commands.length}`);
  console.log(`Agents:       ${data.agents.length}`);
  console.log(`Skills:       ${data.skills.length}`);
  console.log(`Marketplaces: ${data.marketplaces.length}`);
  console.log(`Plugins:      ${data.installedPlugins.length}`);
  console.log(`MCP Servers:  ${data.mcpServers.length}`);
  console.log(`\nWritten to: ${outputPath}`);
}

main();
