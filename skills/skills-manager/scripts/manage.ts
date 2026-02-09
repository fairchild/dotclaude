#!/usr/bin/env bun
/**
 * Skills Manager - Local skill inspection, validation, and audit
 *
 * Usage: bun skills/skills-manager/scripts/manage.ts <command> [args]
 *
 * Commands:
 *   status              Quick overview: counts, agents
 *   list                All skills with origin, description, agents
 *   inspect <name>      Deep-read a skill: frontmatter, body, scripts, references
 *   validate [path]     Validate skill structure and frontmatter
 *   audit               System-wide health check
 */

import { readdir, readFile, stat, lstat, readlink } from "fs/promises";
import { join, basename, resolve } from "path";
import { homedir } from "os";

const HOME = homedir();

// --- Types ---

interface Frontmatter {
  name: string;
  description: string;
  [key: string]: unknown;
}

interface SkillInfo {
  name: string;
  path: string;
  origin: "local" | "ecosystem" | "symlink";
  agent: string;
  frontmatter: Record<string, unknown>;
  description: string;
  symlinkTarget?: string;
}

interface LockFile {
  version: number;
  skills: Record<string, { source: string; sourceUrl: string; updatedAt: string }>;
}

// --- Skill discovery dirs ---

const SKILL_DIRS: { path: string; agent: string }[] = [
  { path: join(HOME, ".claude", "skills"), agent: "claude-code" },
  { path: join(HOME, ".codex", "skills"), agent: "codex" },
  { path: join(HOME, ".agents", "skills"), agent: "agents-cli" },
];

const SPEC_ALLOWED_KEYS = new Set(["name", "description", "license", "allowed-tools", "metadata", "compatibility"]);
const NON_SPEC_KEYS = new Set(["origin", "inspired-by", "hooks", "status"]);
const FORBIDDEN_FILES = new Set(["README.md", "CHANGELOG.md", "INSTALLATION.md", "QUICK_REFERENCE.md", "INSTALLATION_GUIDE.md"]);
const SCRIPT_EXTENSIONS = new Set([".ts", ".js", ".mjs", ".py", ".sh", ".bash", ".zsh"]);
const REQUIRED_FIELDS = ["name", "description"] as const;

// --- Frontmatter parsing ---

function parseFrontmatter(content: string): Record<string, unknown> | null {
  if (!content.startsWith("---")) return null;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return null;

  const raw = content.slice(4, end);
  const fm: Record<string, unknown> = {};
  let currentKey = "";
  let multiline = false;

  for (const line of raw.split("\n")) {
    if (multiline) {
      if (line.startsWith("  ") || line.startsWith("\t")) {
        const prev = fm[currentKey];
        fm[currentKey] = (prev ? prev + " " : "") + line.trim();
        continue;
      }
      multiline = false;
    }

    const match = line.match(/^(\S[\w-]*)\s*:\s*(.*)/);
    if (!match) continue;

    const [, key, value] = match;
    currentKey = key;

    if (value === ">-" || value === ">") {
      multiline = true;
      fm[key] = "";
    } else if (value === "" || value === "|") {
      fm[key] = "";
    } else {
      fm[key] = value.replace(/^["']|["']$/g, "").trim();
    }
  }

  return fm;
}

function getBodyAfterFrontmatter(content: string): string {
  if (!content.startsWith("---")) return content;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return content;
  return content.slice(end + 4).trim();
}

// --- Lock file ---

async function readLockFile(): Promise<LockFile | null> {
  try {
    const raw = await readFile(join(HOME, ".agents", ".skill-lock.json"), "utf-8");
    return JSON.parse(raw) as LockFile;
  } catch {
    return null;
  }
}

// --- Discovery ---

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function discoverSkills(): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = [];
  const lock = await readLockFile();
  const ecosystemNames = new Set(lock ? Object.keys(lock.skills) : []);

  for (const { path: dir, agent } of SKILL_DIRS) {
    if (!(await exists(dir))) continue;

    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const skillPath = join(dir, entry);
      const skillMd = join(skillPath, "SKILL.md");

      if (!(await exists(skillMd))) continue;

      const content = await readFile(skillMd, "utf-8");
      const fm = parseFrontmatter(content) ?? {};

      let origin: SkillInfo["origin"] = "local";
      let symlinkTarget: string | undefined;

      try {
        const s = await lstat(skillPath);
        if (s.isSymbolicLink()) {
          origin = "symlink";
          symlinkTarget = await readlink(skillPath);
        }
      } catch {}

      if (origin === "local" && ecosystemNames.has(entry)) {
        origin = "ecosystem";
      }

      skills.push({
        name: (fm.name as string) || entry,
        path: skillPath,
        origin,
        agent,
        frontmatter: fm,
        description: ((fm.description as string) || "").slice(0, 80),
        symlinkTarget,
      });
    }
  }

  return skills;
}

// --- Validation ---

async function validateSkill(skillPath: string): Promise<{ errors: string[]; warnings: string[] }> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const dir = resolve(skillPath);

  const skillMd = join(dir, "SKILL.md");
  if (!(await exists(skillMd))) {
    errors.push("SKILL.md not found");
    return { errors, warnings };
  }

  const content = await readFile(skillMd, "utf-8");

  if (!content.startsWith("---")) {
    errors.push("Missing YAML frontmatter (must start with '---')");
    return { errors, warnings };
  }

  const fm = parseFrontmatter(content);
  if (!fm) {
    errors.push("Invalid frontmatter structure (missing closing '---')");
    return { errors, warnings };
  }

  // Required fields
  for (const field of REQUIRED_FIELDS) {
    if (!(field in fm)) {
      errors.push(`Missing required field: '${field}'`);
    } else if (!fm[field]) {
      errors.push(`Field '${field}' cannot be empty`);
    }
  }

  // Name validation
  const name = ((fm.name as string) ?? "").trim();
  if (name) {
    if (!/^[a-z0-9-]+$/.test(name)) {
      errors.push(`Name '${name}' should be hyphen-case (lowercase letters, digits, hyphens only)`);
    }
    if (name.startsWith("-") || name.endsWith("-") || name.includes("--")) {
      errors.push(`Name '${name}' cannot start/end with hyphen or contain consecutive hyphens`);
    }
    if (name.length > 64) {
      errors.push(`Name too long (${name.length} chars, max 64)`);
    }
  }

  // Description validation
  const desc = ((fm.description as string) ?? "").trim();
  if (desc) {
    if (desc.length < 50) {
      errors.push(`Description too short (${desc.length} chars). Should be 50+ chars with what it does AND when to use it.`);
    }
    if (desc.length > 1024) {
      errors.push(`Description too long (${desc.length} chars, max 1024)`);
    }
    if (/<|>/.test(desc)) {
      errors.push("Description cannot contain angle brackets (< or >)");
    }
  }

  // Key validation
  for (const key of Object.keys(fm)) {
    if (!SPEC_ALLOWED_KEYS.has(key)) {
      if (NON_SPEC_KEYS.has(key)) {
        warnings.push(`Non-spec key '${key}' — consider moving to metadata:`);
      } else {
        warnings.push(`Unexpected key '${key}' — allowed: ${[...SPEC_ALLOWED_KEYS].join(", ")}`);
      }
    }
  }

  // Forbidden files
  for (const forbidden of FORBIDDEN_FILES) {
    if (await exists(join(dir, forbidden))) {
      errors.push(`Forbidden file: ${forbidden}`);
    }
  }

  // SKILL.md line count
  const lineCount = content.split("\n").length;
  if (lineCount > 500) {
    warnings.push(`SKILL.md is ${lineCount} lines (consider keeping under 500)`);
  }

  // Scripts exist and are executable
  const scriptsDir = join(dir, "scripts");
  if (await exists(scriptsDir)) {
    try {
      const scripts = await readdir(scriptsDir);
      for (const s of scripts) {
        if (s.startsWith(".")) continue;
        const ext = s.includes(".") ? "." + s.split(".").pop() : "";
        if (!SCRIPT_EXTENSIONS.has(ext)) continue;
        try {
          const st = await stat(join(scriptsDir, s));
          if (st.isFile() && !(st.mode & 0o111)) {
            warnings.push(`Script not executable: scripts/${s}`);
          }
        } catch {}
      }
    } catch {}
  }

  // Internal file references
  const body = getBodyAfterFrontmatter(content);
  const refPattern = /\[.*?\]\(((?!https?:\/\/)[^)]+)\)/g;
  let refMatch;
  while ((refMatch = refPattern.exec(body)) !== null) {
    const ref = refMatch[1];
    if (ref.startsWith("#")) continue;
    if (!(await exists(join(dir, ref)))) {
      warnings.push(`Broken reference: ${ref}`);
    }
  }

  return { errors, warnings };
}

// --- Formatting ---

function formatTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] || "").length))
  );
  const sep = widths.map((w) => "-".repeat(w)).join(" | ");
  const head = headers.map((h, i) => h.padEnd(widths[i])).join(" | ");
  const body = rows.map((r) => r.map((c, i) => (c || "").padEnd(widths[i])).join(" | ")).join("\n");
  return `${head}\n${sep}\n${body}`;
}

// --- Commands ---

async function cmdStatus() {
  const skills = await discoverSkills();
  const lock = await readLockFile();

  const byAgent = new Map<string, number>();
  const byOrigin = new Map<string, number>();
  for (const s of skills) {
    byAgent.set(s.agent, (byAgent.get(s.agent) || 0) + 1);
    byOrigin.set(s.origin, (byOrigin.get(s.origin) || 0) + 1);
  }

  console.log("# Skills Status\n");
  console.log(`Total skills: ${skills.length}`);
  console.log(`  Local: ${byOrigin.get("local") || 0}`);
  console.log(`  Ecosystem: ${byOrigin.get("ecosystem") || 0}`);
  console.log(`  Symlink: ${byOrigin.get("symlink") || 0}`);
  console.log();

  for (const [agent, count] of byAgent) {
    console.log(`  ${agent}: ${count}`);
  }

  if (lock) {
    console.log(`\nLock file: ${Object.keys(lock.skills).length} tracked`);
  }

  console.log("\nRun 'audit' for validation details");
}

async function cmdList() {
  const skills = await discoverSkills();

  if (skills.length === 0) {
    console.log("No skills found.");
    return;
  }

  const rows = skills
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => [s.name, s.origin, s.agent, s.description]);

  console.log("# Installed Skills\n");
  console.log(formatTable(["Name", "Origin", "Agent", "Description"], rows));
  console.log(`\n${skills.length} skills total`);
}

async function cmdInspect(name: string) {
  const skills = await discoverSkills();
  const skill = skills.find((s) => s.name === name || basename(s.path) === name);

  if (!skill) {
    console.error(`Skill '${name}' not found. Run 'list' to see available skills.`);
    process.exit(1);
  }

  const skillMd = join(skill.path, "SKILL.md");
  const content = await readFile(skillMd, "utf-8");
  const fm = parseFrontmatter(content) ?? {};
  const body = getBodyAfterFrontmatter(content);

  console.log(`# ${skill.name}\n`);
  console.log(`Path: ${skill.path}`);
  console.log(`Origin: ${skill.origin}`);
  console.log(`Agent: ${skill.agent}`);
  if (skill.symlinkTarget) console.log(`Symlink: → ${skill.symlinkTarget}`);
  console.log(`Lines: ${content.split("\n").length}`);

  console.log("\n## Frontmatter\n");
  for (const [k, v] of Object.entries(fm)) {
    const val = typeof v === "string" ? v.slice(0, 100) : JSON.stringify(v);
    console.log(`  ${k}: ${val}`);
  }

  const scriptsDir = join(skill.path, "scripts");
  if (await exists(scriptsDir)) {
    console.log("\n## Scripts\n");
    for (const s of (await readdir(scriptsDir)).filter((s) => !s.startsWith("."))) {
      const st = await stat(join(scriptsDir, s));
      const exec = st.mode & 0o111 ? "x" : "-";
      const size = st.size < 1024 ? `${st.size}B` : `${(st.size / 1024).toFixed(1)}K`;
      console.log(`  ${s} (${size}, ${exec})`);
    }
  }

  const refsDir = join(skill.path, "references");
  if (await exists(refsDir)) {
    console.log("\n## References\n");
    for (const r of (await readdir(refsDir)).filter((r) => !r.startsWith("."))) {
      console.log(`  ${r}`);
    }
  }

  const headings = body.split("\n").filter((l) => l.startsWith("#"));
  if (headings.length > 0) {
    console.log("\n## Structure\n");
    for (const h of headings.slice(0, 15)) console.log(`  ${h}`);
    if (headings.length > 15) console.log(`  ... and ${headings.length - 15} more sections`);
  }
}

async function cmdValidate(pathArg: string) {
  const dir = resolve(pathArg);

  if (!(await exists(dir))) {
    console.error(`Path not found: ${dir}`);
    process.exit(1);
  }

  const dirStat = await stat(dir);
  let targets: string[];

  if (dirStat.isDirectory() && (await exists(join(dir, "SKILL.md")))) {
    targets = [dir];
  } else if (dirStat.isDirectory()) {
    const entries = await readdir(dir);
    targets = [];
    for (const e of entries) {
      if (e.startsWith(".")) continue;
      if (await exists(join(dir, e, "SKILL.md"))) targets.push(join(dir, e));
    }
  } else {
    console.error("Path must be a skill directory or a directory containing skills");
    process.exit(1);
  }

  if (targets.length === 0) {
    console.error("No skills found at path");
    process.exit(1);
  }

  let allPassed = true;

  for (const target of targets) {
    const name = basename(target);
    const { errors, warnings } = await validateSkill(target);

    if (errors.length === 0 && warnings.length === 0) {
      console.log(`OK  ${name}`);
    } else {
      if (errors.length > 0) allPassed = false;
      console.log(`\n${errors.length > 0 ? "FAIL" : "WARN"}  ${name}`);
      for (const e of errors) console.log(`  ERR  ${e}`);
      for (const w of warnings) console.log(`  WARN ${w}`);
    }
  }

  if (!allPassed) process.exit(1);
}

async function cmdAudit() {
  const skills = await discoverSkills();
  const lock = await readLockFile();
  let totalErrors = 0;
  let totalWarnings = 0;

  console.log("# Skills Audit\n");

  // 1. Validation pass
  console.log("## Validation\n");
  for (const s of skills.sort((a, b) => a.name.localeCompare(b.name))) {
    const { errors, warnings } = await validateSkill(s.path);
    totalErrors += errors.length;
    totalWarnings += warnings.length;

    if (errors.length === 0 && warnings.length === 0) {
      console.log(`OK   ${s.name} (${s.agent})`);
    } else {
      console.log(`${errors.length > 0 ? "FAIL" : "WARN"} ${s.name} (${s.agent})`);
      for (const e of errors) console.log(`  ERR  ${e}`);
      for (const w of warnings) console.log(`  WARN ${w}`);
    }
  }

  // 2. Symlink health
  const symlinks = skills.filter((s) => s.origin === "symlink");
  if (symlinks.length > 0) {
    console.log("\n## Symlinks\n");
    for (const s of symlinks) {
      const target = s.symlinkTarget || "unknown";
      const targetExists = await exists(resolve(s.path, "..", target));
      console.log(`${targetExists ? "OK  " : "DEAD"} ${s.name} → ${target}`);
      if (!targetExists) totalErrors++;
    }
  }

  // 3. Lock file consistency
  if (lock) {
    console.log("\n## Ecosystem Lock\n");
    const installedNames = new Set(skills.map((s) => basename(s.path)));
    for (const [name, entry] of Object.entries(lock.skills)) {
      const present = installedNames.has(name);
      const age = Math.floor((Date.now() - new Date(entry.updatedAt).getTime()) / 86400000);
      console.log(`${present ? "OK  " : "MISS"} ${name} (${entry.source}, ${age}d ago)`);
      if (!present) {
        totalWarnings++;
        console.log(`  WARN In lock file but not found on disk`);
      }
    }
  }

  // 4. Name overlap across agents
  const nameMap = new Map<string, string[]>();
  for (const s of skills) {
    const key = s.name;
    if (!nameMap.has(key)) nameMap.set(key, []);
    nameMap.get(key)!.push(s.agent);
  }
  const overlaps = [...nameMap.entries()].filter(([, agents]) => agents.length > 1);
  if (overlaps.length > 0) {
    console.log("\n## Name Overlap\n");
    for (const [name, agents] of overlaps) {
      console.log(`  ${name}: ${agents.join(", ")}`);
      totalWarnings++;
    }
  }

  // Summary
  console.log("\n## Summary\n");
  console.log(`Skills: ${skills.length}`);
  console.log(`Errors: ${totalErrors}`);
  console.log(`Warnings: ${totalWarnings}`);

  if (totalErrors > 0) process.exit(1);
}

// --- Main ---

const [cmd, ...args] = process.argv.slice(2);

switch (cmd) {
  case "status":
    await cmdStatus();
    break;
  case "list":
    await cmdList();
    break;
  case "inspect":
    if (!args[0]) {
      console.error("Usage: manage.ts inspect <name>");
      process.exit(1);
    }
    await cmdInspect(args[0]);
    break;
  case "validate":
    if (!args[0]) {
      console.error("Usage: manage.ts validate <path>");
      process.exit(1);
    }
    await cmdValidate(args[0]);
    break;
  case "audit":
    await cmdAudit();
    break;
  default:
    console.log(`Usage: manage.ts <command> [args]

Commands:
  status              Quick overview: counts, agents
  list                All skills with origin, description
  inspect <name>      Deep-read a specific skill
  validate <path>     Validate skill structure and frontmatter
  audit               System-wide health check`);
    if (cmd) process.exit(1);
}
