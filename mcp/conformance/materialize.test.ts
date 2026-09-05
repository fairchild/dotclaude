import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { materializeSkills } from "../core/materialize.ts";
import type { SkillEntry } from "../core/types.ts";

const bytes = Buffer.from("# Example\n");
const resource = (path = "SKILL.md") => ({ uri: `skill://example/${path}`, size: bytes.length, digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}` });
const entry = (): SkillEntry => ({ uri: "skill://example/SKILL.md", frontmatter: { name: "example", description: "Example" }, resources: [resource()] });
const read = async (uri: string) => ({ contents: [{ uri, text: bytes.toString() }] });
async function fixture(run: (root: string, out: string) => Promise<void>) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "materialize-")));
  try { await run(root, join(root, "out")); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test("publishes verified text and binary files with private non-executable permissions", () => fixture(async (_, out) => {
  const value = entry();
  value.resources = [resource(), resource("data/bytes.bin")];
  await materializeSkills([value], async uri => ({ contents: [{ uri, blob: bytes.toString("base64") }] }), out);
  expect(readFileSync(join(out, "example/data/bytes.bin"))).toEqual(bytes);
  expect(statSync(join(out, "example/SKILL.md")).mode & 0o777).toBe(0o600);
}));

test("rejects hostile namespaces and portable path aliases before fetching", () => fixture(async (root, out) => {
  let reads = 0;
  const reader = async (uri: string) => { reads++; return read(uri); };
  for (const path of ["../escape", "/absolute", "a//b", "a/./b", "a\\b", "%2e%2e/escape", "a:b", "NUL.txt", "name.", "name ", "line\nfeed"]) {
    const value = entry();
    value.resources = [resource(), resource(path)];
    await expect(materializeSkills([value], reader, out)).rejects.toThrow();
  }
  for (const uri of ["skill://other/SKILL.md", "https://example.org/file"]) {
    const value = entry(); value.resources = [{ ...resource(), uri }];
    await expect(materializeSkills([value], reader, out)).rejects.toThrow("namespace");
  }
  const value = entry(); value.frontmatter.name = "../escape";
  await expect(materializeSkills([value], reader, out)).rejects.toThrow("namespace");
  expect(reads).toBe(0);
  expect(readdirSync(root)).toEqual([]);
}));

test("rejects duplicate, case-folded and file-directory collisions", () => fixture(async (_, out) => {
  for (const paths of [["SKILL.md", "SKILL.md"], ["SKILL.md", "skill.md"], ["SKILL.md", "a", "a/b"], ["SKILL.md", "a/b", "a"]]) {
    const value = entry(); value.resources = paths.map(resource);
    await expect(materializeSkills([value], read, out)).rejects.toThrow("conflicting");
  }
  await expect(materializeSkills([entry(), entry()], read, out)).rejects.toThrow("duplicate");
}));

test("refuses dynamic, incomplete and over-budget manifests before fetching", () => fixture(async (_, out) => {
  for (const resources of ["dynamic", [], [resource("other")], Array.from({ length: 513 }, (_, i) => resource(`${i}`)), [{ ...resource(), size: 16 * 1024 * 1024 + 1 }]] as SkillEntry["resources"][]) {
    const value = entry(); value.resources = resources;
    await expect(materializeSkills([value], read, out)).rejects.toThrow();
  }
}));

test("failed verification or reads leave no destination or staging files", () => fixture(async (root, out) => {
  const value = entry(); value.resources = [resource(), resource("last.txt")];
  for (const failure of ["digest", "size", "identity", "multiple", "base64", "throw"]) {
    await expect(materializeSkills([value], async uri => {
      if (uri.endsWith("SKILL.md")) return read(uri);
      if (failure === "throw") throw new Error("disconnected");
      if (failure === "identity") return read("skill://other/last.txt");
      if (failure === "multiple") return { contents: [...(await read(uri)).contents, ...(await read(uri)).contents] };
      if (failure === "base64") return { contents: [{ uri, blob: "!".repeat(4 * Math.ceil(bytes.length / 3)) }] };
      return { contents: [{ uri, text: failure === "size" ? "short" : "x".repeat(bytes.length) }] };
    }, out)).rejects.toThrow();
    expect(readdirSync(root)).toEqual([]);
  }
}));

test("existing output and symlink parents preserve external files", () => fixture(async (root, out) => {
  mkdirSync(out); writeFileSync(join(out, "keep"), "keep");
  await expect(materializeSkills([entry()], read, out)).rejects.toThrow("already exists");
  symlinkSync(out, join(root, "linked"));
  await expect(materializeSkills([entry()], read, join(root, "linked/new"))).rejects.toThrow("real directories");
  await expect(materializeSkills([entry()], read, join(root, "linked"))).rejects.toThrow("already exists");
  expect(readFileSync(join(out, "keep"), "utf8")).toBe("keep");
  expect(existsSync(join(out, "new"))).toBe(false);
}));

test("an output created during fetching is preserved", () => fixture(async (_, out) => {
  await expect(materializeSkills([entry()], async uri => {
    mkdirSync(out); writeFileSync(join(out, "keep"), "keep"); return read(uri);
  }, out)).rejects.toThrow("already exists");
  expect(readFileSync(join(out, "keep"), "utf8")).toBe("keep");
}));

test("CLI materializes the real stdio fixture and refuses replacement", () => fixture(async (_, out) => {
  const args = [join(import.meta.dir, "../materialize.ts"), "--root", join(import.meta.dir, "fixtures"), "--out", out];
  const first = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 15000 });
  expect(first.status).toBe(0);
  expect(readdirSync(out).length).toBeGreaterThan(0);
  const second = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 15000 });
  expect(second.status).toBe(1);
  expect(second.stderr).toContain("already exists");
}));
