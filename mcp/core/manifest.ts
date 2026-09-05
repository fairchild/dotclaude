/**
 * Scan a skills directory into SEP-2640 skill entries.
 *
 * A skill is a subdirectory holding a SKILL.md whose frontmatter `name`
 * equals the directory name (the Agent Skills spec's naming rule — it is what
 * makes the name recoverable from the URI alone). Directories that fail that
 * rule, fail to parse, or exceed the SEP's per-skill limits are skipped and
 * reported as diagnostics rather than served malformed.
 *
 * Digests are computed at scan time because the listing carries them; content
 * reads always serve current bytes, so a file changed after a scan surfaces
 * client-side as a digest mismatch, and `skills/get` — which rescans the one
 * skill — is the refresh path, exactly as the SEP prescribes.
 */
import { createHash } from "node:crypto";
import { opendirSync, readdirSync, lstatSync, realpathSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { parse as parseYaml } from "yaml";
import { checkedPath, readSkillFile } from "./files.ts";

import {
  MAX_RESOURCES_PER_SKILL,
  MAX_TOTAL_BYTES_PER_SKILL,
  type SkillEntry,
  skillUri,
} from "./types.ts";

/** Junk and dependency trees are not part of a skill's published file set. */
const EXCLUDED_DIRS = new Set(["node_modules", "__pycache__", ".git", ".venv"]);
const EXCLUDED_FILES = new Set([".DS_Store"]);

export interface ScannedSkill {
  entry: SkillEntry;
  dir: string;
  tier: "portable" | "machine-bound";
}

export interface ScanDiagnostic {
  skill: string;
  reason: string;
}

export interface Catalog {
  skills: ScannedSkill[];
  diagnostics: ScanDiagnostic[];
}

function isExcluded(name: string): boolean {
  return name.startsWith(".") || EXCLUDED_DIRS.has(name) || EXCLUDED_FILES.has(name);
}

function walkFiles(root: string): string[] {
  const files: string[] = [];
  let visited = 0;
  function walk(dir: string, depth: number): void {
    if (depth > 64) throw new Error("directory depth limit exceeded");
    if (dir !== root) checkedPath(root, relative(root, dir).split(sep()).join("/"));
    const directory = opendirSync(dir);
    try {
      let entry;
      while ((entry = directory.readSync()) !== null) {
        if (isExcluded(entry.name)) continue;
        if (++visited > MAX_RESOURCES_PER_SKILL * 2) throw new Error("directory entry limit exceeded");
        const path = join(dir, entry.name);
        const stat = lstatSync(path);
        if (stat.isSymbolicLink()) throw new Error("nested symlinks are not supported");
        if (stat.isDirectory()) walk(path, depth + 1);
        else if (stat.isFile()) {
          if (files.length >= MAX_RESOURCES_PER_SKILL) throw new Error("resource limit exceeded");
          files.push(path);
        } else throw new Error("special files are not supported");
      }
    } finally { directory.closeSync(); }
  }
  walk(root, 0);
  return files.sort();
}

export function parseFrontmatter(source: string): Record<string, unknown> | null {
  if (!source.startsWith("---")) return null;
  const end = source.indexOf("\n---", 3);
  if (end === -1) return null;
  let parsed: unknown;
  try {
    parsed = parseYaml(source.slice(3, end + 1));
  } catch {
    return null; // a live directory holds skills this server did not author
  }
  return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
}

export function scanSkill(dir: string, name = basename(dir)): ScannedSkill | ScanDiagnostic {
  if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.exec(name)?.[0] !== name) return { skill: name, reason: "unsafe skill name" };
  try {
    dir = realpathSync(dir);

    let raw: string;
    try {
      raw = readSkillFile(dir, "SKILL.md").bytes.toString("utf-8");
    } catch {
      return { skill: name, reason: "no readable SKILL.md" };
    }

    const frontmatter = parseFrontmatter(raw);
    if (!frontmatter) return { skill: name, reason: "SKILL.md has no YAML frontmatter" };
    if (typeof frontmatter.name !== "string" || typeof frontmatter.description !== "string") {
      return { skill: name, reason: "frontmatter missing required name/description" };
    }
    if (frontmatter.name !== name) {
      return { skill: name, reason: `frontmatter name '${frontmatter.name}' != directory name` };
    }

    const files = walkFiles(dir);

    let totalBytes = 0;
    const resources = files.map((path) => {
      const bytes = readSkillFile(dir, relative(dir, path).split(sep()).join("/"), MAX_TOTAL_BYTES_PER_SKILL - totalBytes).bytes;
      if (path === join(dir, "SKILL.md") && bytes.toString("utf-8") !== raw) throw new Error("SKILL.md changed during scan");
      totalBytes += bytes.length;
      return {
        uri: skillUri(name, relative(dir, path).split(sep()).join("/")),
        digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        size: bytes.length,
      };
    });

    const metadata = (frontmatter.metadata ?? {}) as Record<string, unknown>;
    return {
      dir,
      tier: metadata.portability === "machine-bound" ? "machine-bound" : "portable",
      entry: { uri: skillUri(name, "SKILL.md"), frontmatter: frontmatter as SkillEntry["frontmatter"], resources },
    };
  } catch (error) {
    return { skill: name, reason: error instanceof Error ? error.message : "cannot scan skill" };
  }
}

function sep(): string {
  return process.platform === "win32" ? "\\" : "/";
}

export function scanCatalog(root: string): Catalog {
  const skills: ScannedSkill[] = [];
  const diagnostics: ScanDiagnostic[] = [];
  let dirs: string[];
  try {
    dirs = readdirSync(root, { withFileTypes: true })
      .filter((e) => !isExcluded(e.name))
      .map((e) => join(root, e.name))
      .filter((p) => {
        try {
          return statSync(p).isDirectory();
        } catch {
          return false; // broken symlink
        }
      })
      .sort();
  } catch (err) {
    throw new Error(`cannot read skills root ${root}: ${err}`);
  }

  for (const dir of dirs) {
    const result = scanSkill(dir);
    if ("entry" in result) skills.push(result);
    else diagnostics.push(result);
  }
  return { skills, diagnostics };
}
