#!/usr/bin/env bun
/**
 * Config Inventory - Scan projects for Claude Code configuration
 *
 * Usage: bun ~/.claude/skills/dotclaude-config/scripts/inventory.ts [path]
 *
 * Scans ~/code/ (or specified path) for .claude/ directories
 * Reports what's configured per project and flags potential issues.
 */

import { readdir, stat } from "fs/promises";
import { join, basename } from "path";
import { homedir } from "os";

interface ProjectConfig {
  name: string;
  path: string;
  hasClaudeDir: boolean;
  hasClaudeMd: boolean;
  hasSettings: boolean;
  hasSkills: boolean;
  hasCommands: boolean;
  skillCount: number;
  commandCount: number;
  skillNames: string[];
  overlappingSkills: string[];
  packageManager: string | null;
}

const IGNORED_DIRS = new Set(["backlog", "references", "backburner", "node_modules", ".git"]);

async function detectPackageManager(projectPath: string): Promise<string | null> {
  const lockfiles: Record<string, string> = {
    "bun.lock": "bun",
    "bun.lockb": "bun",
    "pnpm-lock.yaml": "pnpm",
    "package-lock.json": "npm",
    "uv.lock": "uv",
    "poetry.lock": "poetry",
    "Cargo.lock": "cargo",
    "go.sum": "go",
  };

  for (const [file, manager] of Object.entries(lockfiles)) {
    try {
      await stat(join(projectPath, file));
      return manager;
    } catch {}
  }
  return null;
}

async function countItems(dirPath: string): Promise<number> {
  try {
    const items = await readdir(dirPath);
    return items.filter((i) => !i.startsWith(".")).length;
  } catch {
    return 0;
  }
}

async function getSkillNames(skillsDir: string): Promise<string[]> {
  try {
    const entries = await readdir(skillsDir);
    return entries.filter((e) => !e.startsWith("."));
  } catch {
    return [];
  }
}

async function scanProject(
  projectPath: string,
  globalSkillNames: Set<string>,
): Promise<ProjectConfig> {
  const name = basename(projectPath);
  const claudeDir = join(projectPath, ".claude");

  let hasClaudeDir = false;
  let hasClaudeMd = false;
  let hasSettings = false;
  let hasSkills = false;
  let hasCommands = false;
  let skillCount = 0;
  let commandCount = 0;
  let skillNames: string[] = [];

  try {
    await stat(claudeDir);
    hasClaudeDir = true;

    try {
      await stat(join(claudeDir, "CLAUDE.md"));
      hasClaudeMd = true;
    } catch {}

    try {
      await stat(join(claudeDir, "settings.json"));
      hasSettings = true;
    } catch {}
    try {
      await stat(join(claudeDir, "settings.local.json"));
      hasSettings = true;
    } catch {}

    try {
      await stat(join(claudeDir, "skills"));
      hasSkills = true;
      skillNames = await getSkillNames(join(claudeDir, "skills"));
      skillCount = skillNames.length;
    } catch {}

    try {
      await stat(join(claudeDir, "commands"));
      hasCommands = true;
      commandCount = await countItems(join(claudeDir, "commands"));
    } catch {}
  } catch {}

  // Also check root CLAUDE.md
  if (!hasClaudeMd) {
    try {
      await stat(join(projectPath, "CLAUDE.md"));
      hasClaudeMd = true;
    } catch {}
  }

  const packageManager = await detectPackageManager(projectPath);
  const overlappingSkills = skillNames.filter((s) => globalSkillNames.has(s));

  return {
    name,
    path: projectPath,
    hasClaudeDir,
    hasClaudeMd,
    hasSettings,
    hasSkills,
    hasCommands,
    skillCount,
    commandCount,
    skillNames,
    overlappingSkills,
    packageManager,
  };
}

async function scanProjects(
  basePath: string,
  globalSkillNames: Set<string>,
): Promise<ProjectConfig[]> {
  const projects: ProjectConfig[] = [];

  try {
    const entries = await readdir(basePath);

    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry) || entry.startsWith(".")) continue;

      const fullPath = join(basePath, entry);
      try {
        const stats = await stat(fullPath);
        if (stats.isDirectory()) {
          const config = await scanProject(fullPath, globalSkillNames);
          projects.push(config);
        }
      } catch {}
    }
  } catch (e) {
    console.error(`Error scanning ${basePath}:`, e);
  }

  return projects;
}

async function loadGlobalSkills(): Promise<Set<string>> {
  const skills = new Set<string>();
  const skillsDir = join(homedir(), ".claude", "skills");

  try {
    const entries = await readdir(skillsDir);
    for (const entry of entries) {
      if (!entry.startsWith(".")) {
        skills.add(entry.replace(/\.skill$/, "").replace(/\.md$/, ""));
      }
    }
  } catch {}

  return skills;
}

function formatTable(projects: ProjectConfig[]): void {
  const configured = projects.filter((p) => p.hasClaudeDir || p.hasClaudeMd);
  const unconfigured = projects.filter((p) => !p.hasClaudeDir && !p.hasClaudeMd);

  console.log("\n## Configured Projects\n");
  console.log("| Project | .claude/ | CLAUDE.md | settings | skills | commands | stack |");
  console.log("|---------|----------|-----------|----------|--------|----------|-------|");

  for (const p of configured.sort((a, b) => a.name.localeCompare(b.name))) {
    const check = (v: boolean) => (v ? "yes" : "-");
    const skills = p.skillCount > 0 ? `${p.skillCount}` : "-";
    const commands = p.commandCount > 0 ? `${p.commandCount}` : "-";
    console.log(
      `| ${p.name} | ${check(p.hasClaudeDir)} | ${check(p.hasClaudeMd)} | ${check(p.hasSettings)} | ${skills} | ${commands} | ${p.packageManager || "-"} |`
    );
  }

  if (unconfigured.length > 0) {
    console.log("\n## Unconfigured Projects (using global config)\n");
    console.log("| Project | Stack |");
    console.log("|---------|-------|");
    for (const p of unconfigured.sort((a, b) => a.name.localeCompare(b.name))) {
      console.log(`| ${p.name} | ${p.packageManager || "-"} |`);
    }
  }

  const withOverlap = projects.filter((p) => p.overlappingSkills.length > 0);
  if (withOverlap.length > 0) {
    console.log("\n## Skill Overlap\n");
    console.log("| Project | Overlapping Skills | Action |");
    console.log("|---------|-------------------|--------|");
    for (const p of withOverlap.sort((a, b) => a.name.localeCompare(b.name))) {
      console.log(
        `| ${p.name} | ${p.overlappingSkills.join(", ")} | Review if project versions add value |`
      );
    }
  }
}

async function main() {
  const basePath = process.argv[2] || join(homedir(), "code");

  console.log(`# Claude Code Configuration Inventory`);
  console.log(`\nScanning: ${basePath}`);

  const globalSkills = await loadGlobalSkills();
  const projects = await scanProjects(basePath, globalSkills);

  formatTable(projects);

  // Summary stats
  const configured = projects.filter((p) => p.hasClaudeDir || p.hasClaudeMd).length;
  const withSettings = projects.filter((p) => p.hasSettings).length;

  console.log("\n## Summary\n");
  console.log(`- Total projects: ${projects.length}`);
  console.log(`- Configured: ${configured}`);
  console.log(`- With settings.json: ${withSettings}`);
  console.log(`- Using global only: ${projects.length - configured}`);
  console.log(`- Global skills available: ${globalSkills.size}`);
}

main().catch(console.error);
