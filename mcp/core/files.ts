/** Bounded reads within an explicitly selected, canonical skill directory. */
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { MAX_TOTAL_BYTES_PER_SKILL } from "./types.ts";

export function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith("../") && !rel.startsWith("..\\"));
}

export function checkedPath(root: string, rel: string): string {
  const parts = rel.split("/");
  if (!rel || parts.some(p => !p || p === "." || p === ".." || /[\\\u0000-\u001f\u007f]/.test(p))) throw new Error("unsafe resource path");
  let path = root;
  for (const part of parts) {
    path = join(path, part);
    if (lstatSync(path).isSymbolicLink()) throw new Error("nested symlinks are not supported");
  }
  if (!inside(root, realpathSync(path))) throw new Error("resource escapes skill root");
  return path;
}

export function readSkillFile(root: string, rel: string, limit = MAX_TOTAL_BYTES_PER_SKILL): { bytes: Buffer; mode: number } {
  const path = checkedPath(root, rel);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    const current = lstatSync(checkedPath(root, rel));
    if (!stat.isFile() || stat.ino !== current.ino || stat.dev !== current.dev) throw new Error("resource changed during open");
    if (stat.size > limit) throw new Error("resource exceeds byte limit");
    // One extra byte detects growth after stat without an unbounded allocation.
    const buffer = Buffer.alloc(Math.min(stat.size, limit) + 1);
    let used = 0;
    while (used < buffer.length) {
      const count = readSync(fd, buffer, used, buffer.length - used, null);
      if (!count) break;
      used += count;
    }
    if (used > stat.size || used > limit) throw new Error("resource grew during read");
    const after = fstatSync(fd);
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) throw new Error("resource changed during read");
    return { bytes: buffer.subarray(0, used), mode: stat.mode & 0o777 };
  } finally { closeSync(fd); }
}
