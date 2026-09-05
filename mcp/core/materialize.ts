/** Verified, fresh-directory consumption example. Never executes fetched files. */
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, parse, resolve } from "node:path";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { MAX_RESOURCES_PER_SKILL, MAX_TOTAL_BYTES_PER_SKILL, SkillEntrySchema, type SkillEntry } from "./types.ts";

export const MAX_MATERIALIZED_SKILLS = 256;
const MAX_BATCH_BYTES = 256 * 1024 * 1024;

function absent(path: string): void {
  try { lstatSync(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error("destination already exists; choose a new directory");
}

function portablePath(path: string): string[] {
  const parts = path.split("/");
  if (parts.length > 64 || parts.some((part) =>
    !part || part === "." || part === ".." || /[\\%:<>"|?*\x00-\x1f\x7f]/.test(part) ||
    /[. ]$/.test(part) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part)
  )) throw new Error(`unsafe resource path: ${path}`);
  return parts;
}

/** Parent must exist and be operator-owned, without concurrent external writers. */
export async function materializeSkills(
  input: SkillEntry[],
  read: (uri: string) => Promise<ReadResourceResult>,
  output: string,
): Promise<void> {
  if (!input.length || input.length > MAX_MATERIALIZED_SKILLS) throw new Error("skill count limit exceeded or empty selection");
  const names = new Set<string>();
  let batchBytes = 0;
  // Validate the entire manifest before fetching or creating anything.
  const skills = input.map((value) => {
    const entry = SkillEntrySchema.parse(value);
    const name = entry.frontmatter.name;
    if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.exec(name)?.[0] !== name || entry.uri !== `skill://${name}/SKILL.md` || names.has(name)) {
      throw new Error("invalid or duplicate skill namespace");
    }
    portablePath(name);
    names.add(name);
    if (entry.resources === "dynamic") throw new Error(`cannot verify dynamic skill: ${name}`);
    if (!entry.resources.length || entry.resources.length > MAX_RESOURCES_PER_SKILL) throw new Error("resource count limit exceeded");
    const paths = new Map<string, "file" | "directory">();
    let skillBytes = 0;
    const files = entry.resources.map((resource) => {
      const prefix = `skill://${name}/`;
      if (!resource.uri.startsWith(prefix)) throw new Error("resource is outside skill namespace");
      const path = resource.uri.slice(prefix.length);
      const parts = portablePath(path);
      // Reject aliases and file/directory collisions even on case-insensitive filesystems.
      for (let i = 1; i <= parts.length; i++) {
        const key = parts.slice(0, i).join("/").normalize("NFC").toLowerCase();
        const kind = i === parts.length ? "file" : "directory";
        const previous = paths.get(key);
        if (previous && (previous !== "directory" || kind !== "directory")) throw new Error("conflicting resource paths");
        paths.set(key, kind);
      }
      skillBytes += resource.size;
      if (!Number.isSafeInteger(resource.size) || skillBytes > MAX_TOTAL_BYTES_PER_SKILL) throw new Error("skill byte limit exceeded");
      return { ...resource, path };
    });
    if (!files.some((file) => file.path === "SKILL.md")) throw new Error("missing SKILL.md");
    batchBytes += skillBytes;
    if (batchBytes > MAX_BATCH_BYTES) throw new Error("batch byte limit exceeded");
    return { name, files };
  });

  const destination = resolve(output);
  const parent = dirname(destination);
  // Inspect every existing ancestor, including symlinks selected as the parent.
  let ancestor = parse(parent).root;
  for (const part of parent.slice(ancestor.length).split(/[/\\]/).filter(Boolean)) {
    ancestor = join(ancestor, part);
    const stat = lstatSync(ancestor);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("destination parent must contain only real directories");
  }
  absent(destination);
  const staging = mkdtempSync(join(parent, `.${basename(destination)}-`));
  try {
    for (const skill of skills) {
      for (const file of skill.files) {
        const result = await read(file.uri);
        const content = result.contents[0];
        if (result.contents.length !== 1 || !content || content.uri !== file.uri) throw new Error("resource response identity mismatch");
        let bytes: Buffer;
        if ("text" in content && typeof content.text === "string") {
          if (Buffer.byteLength(content.text, "utf8") !== file.size) throw new Error("resource size mismatch");
          bytes = Buffer.from(content.text, "utf8");
        } else if ("blob" in content && typeof content.blob === "string") {
          if (content.blob.length !== 4 * Math.ceil(file.size / 3)) throw new Error("resource size mismatch");
          bytes = Buffer.from(content.blob, "base64");
          if (bytes.toString("base64") !== content.blob) throw new Error("invalid base64 resource");
        } else throw new Error("unsupported resource content");
        if (bytes.length !== file.size || `sha256:${createHash("sha256").update(bytes).digest("hex")}` !== file.digest) {
          throw new Error("resource does not match manifest; content refused");
        }
        const target = join(staging, skill.name, file.path);
        mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
        writeFileSync(target, bytes, { flag: "wx", mode: 0o600 });
      }
    }
    absent(destination);
    renameSync(staging, destination);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
