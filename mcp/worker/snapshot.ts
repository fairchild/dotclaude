import { createHash } from "node:crypto";
import { create as createTar } from "tar";
import { cpSync, chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { directoryMarkdown, escapeHtml, renderSkillPage, validateSkillName, type Download } from "./skill-page.ts";

import { inside, readSkillFile } from "../core/files.ts";
import { scanCatalog } from "../core/manifest.ts";

export interface BuildOptions { root: string; out: string; baseUrl: string; sourceSha?: string; strict?: boolean }
export function buildSnapshot(options: BuildOptions): void {
const templateDir = dirname(fileURLToPath(import.meta.url));
const base = new URL(options.baseUrl);
if (!["https:", "http:"].includes(base.protocol) || base.username || base.password || base.pathname !== "/" || base.search || base.hash) throw new Error("base-url must be an HTTP(S) origin");
const origin = base.origin;
const root = realpathSync(options.root);
const requestedOut = resolve(options.out);
// Canonicalize the nearest existing ancestor before creating any directories.
function canonical(path: string): string {
  if (existsSync(path)) return realpathSync(path);
  const parent = dirname(path);
  return join(canonical(parent), path.slice(parent.length));
}
const out = canonical(requestedOut);
if (inside(root, out) || inside(out, root) || inside(out, process.cwd())) throw new Error("output overlaps source or working directory");
const catalog = scanCatalog(root);
// Diagnostics and the --strict gate run before any filesystem write below
// (including the mkdirSync of dirname(out)) so a strict failure leaves no
// trace on disk, per the CLI contract: "no output directory is created".
for (const d of catalog.diagnostics) console.error(`[skills] skipped ${d.skill}: ${d.reason}`);
if (options.strict && catalog.diagnostics.length > 0) {
  throw new Error(`${catalog.diagnostics.length} scan diagnostic(s) with --strict; see stderr above`);
}
for (const skill of catalog.skills) {
  if (inside(skill.dir, out) || inside(out, skill.dir)) throw new Error("output overlaps selected skill source");
}
const marker = ".skill-server-output";
if (existsSync(requestedOut) && (lstatSync(requestedOut).isSymbolicLink() || !existsSync(join(out, marker)))) throw new Error("refusing to replace unmanaged output");
mkdirSync(dirname(out), { recursive: true });
const staging = mkdtempSync(join(dirname(out), ".skill-server-build-"));
const publicDir = join(staging, "public");
try {
  mkdirSync(join(publicDir, "skills"), { recursive: true });
  cpSync(join(templateDir, "library.css"), join(publicDir, "library.css"));

  const portable = catalog.skills.filter((s) => s.tier === "portable");
  const excluded = catalog.skills.filter((s) => s.tier !== "portable");

  const downloads: Record<string, Download> = {};
  for (const skill of portable) {
    const name = String(skill.entry.frontmatter.name);
    validateSkillName(name);
    if (skill.entry.resources === "dynamic") continue;
    for (const resource of skill.entry.resources) {
      const rel = resource.uri.slice(`skill://${name}/`.length);
      const target = join(publicDir, "skills", name, rel);
      mkdirSync(join(target, ".."), { recursive: true });
      const { bytes, mode } = readSkillFile(skill.dir, rel);
      if (bytes.length !== resource.size || `sha256:${createHash("sha256").update(bytes).digest("hex")}` !== resource.digest) throw new Error(`source changed during build: ${name}/${rel}`);
      writeFileSync(target, bytes, { mode });
      chmodSync(target, mode);
    }
    const archiveDir = join(publicDir, "downloads", name);
    mkdirSync(archiveDir, { recursive: true });
    createTar({ sync: true, gzip: true, portable: true, mtime: new Date(0),
      file: join(archiveDir, "skill.tgz"), cwd: join(publicDir, "skills"), noDirRecurse: true,
    }, skill.entry.resources.map(r => name + "/" + r.uri.slice(("skill://" + name + "/").length)).sort());
    const bytes = readFileSync(join(archiveDir, "skill.tgz"));
    const digest = createHash("sha256").update(bytes).digest("hex");
    downloads[name] = { archive: `/downloads/${name}/${digest}.tgz`, manifest: `/downloads/${name}/${digest}.json`, digest };
    writeFileSync(join(archiveDir, `${digest}.tgz`), bytes);
    writeFileSync(join(archiveDir, `${digest}.json`), JSON.stringify({ archive: downloads[name], entry: skill.entry }, null, 2));
  }

  writeFileSync(
    join(publicDir, "manifest.json"),
    JSON.stringify(
      { skills: portable.map(({ entry, tier }) => ({ entry, tier, download: downloads[String(entry.frontmatter.name)] })) },
      null,
      2,
    ),
  );

  // Detail pages are separate from resource paths so skill files stay byte-exact.
  const detailTemplate = readFileSync(join(templateDir, "skill.html"), "utf-8");
  mkdirSync(join(publicDir, "skill"), { recursive: true });
  for (const { entry } of portable) {
    const name = String(entry.frontmatter.name);
    const markdown = readFileSync(join(publicDir, "skills", name, "SKILL.md"), "utf-8");
    const paths = entry.resources === "dynamic" ? ["SKILL.md"] : entry.resources.map(r => r.uri.slice(`skill://${name}/`.length));
    writeFileSync(join(publicDir, "skill", `${name}.md`), directoryMarkdown(name, String(entry.frontmatter.description ?? ""), paths, downloads[name], origin));
    writeFileSync(join(publicDir, "skill", `${name}.html`), renderSkillPage(
      detailTemplate, name, String(entry.frontmatter.description ?? ""), markdown,
      paths, downloads[name], origin,
    ));
  }

  const catalogMarkdown = `# Skills over MCP

This site began as a reference implementation of the experimental [Skills Over MCP project](https://github.com/modelcontextprotocol/ext-skills). The same library now supports readable pages, Markdown discovery, and verified downloads, intended to make access intuitive and efficient for agents.

## Connect through MCP

Endpoint: ${origin}/mcp

[Implementation source](https://github.com/fairchild/dotclaude/tree/main/mcp). HTTP downloads are also available without MCP setup.

Find a skill, read its SKILL.md, and follow relative file references as needed. Each directory page lists every file and a complete installable archive.

## Skills

${portable.map(({ entry }) => `- [${entry.frontmatter.name}](/skill/${encodeURIComponent(String(entry.frontmatter.name))}.md): ${String(entry.frontmatter.description).replace(/\s+/g, " ")}`).join("\n")}

## Other access

- [Catalog manifest](/manifest.json): file sizes, SHA-256 digests, and package downloads.
- MCP clients can connect to POST /mcp. Ordinary HTTP downloads require no MCP setup.
`;
  writeFileSync(join(publicDir, "llms.txt"), catalogMarkdown);
  writeFileSync(join(publicDir, "index.json"), JSON.stringify({
    description: "dotclaude skills over MCP and HTTP",
    mcp: "/mcp",
    manifest: "/manifest.json",
    instructions: "/llms.txt",
    specification: "https://github.com/modelcontextprotocol/ext-skills",
  }, null, 2));

  const rows = portable
    .map(({ entry }) => {
      const name = String(entry.frontmatter.name);
      const description = String(entry.frontmatter.description ?? "").split(/(?<=[.!?])\s/)[0] ?? "";
      const cell = `<a href="/skills/${encodeURIComponent(name)}/">${escapeHtml(name)}</a>`;
      return `<li><h2>${cell}</h2><p>${escapeHtml(description)}</p></li>`;
    })
    .join("\n");
  const template = readFileSync(join(templateDir, "index.html"), "utf-8");
  writeFileSync(
    join(publicDir, "index.html"),
    template
      .replaceAll("https://skills.cloudcompute.com", escapeHtml(origin))
      .replaceAll("{{PORTABLE}}", String(portable.length))
      .replaceAll("{{TOTAL}}", String(catalog.skills.length))
      .replaceAll("{{MACHINE_BOUND}}", excluded.map((s) => String(s.entry.frontmatter.name)).join(", ") || "none")
      .replaceAll("{{SKILL_ROWS}}", rows)
      .replaceAll("{{BUILT_AT}}", new Date().toISOString().slice(0, 10)),
  );

  writeFileSync(join(publicDir, "version.json"), JSON.stringify({ sourceSha: options.sourceSha ?? null }));
  const totalBytes = portable.reduce(
    (n, s) => n + (s.entry.resources === "dynamic" ? 0 : s.entry.resources.reduce((m, r) => m + r.size, 0)),
    0,
  );
  console.error(
    `built ${portable.length} portable skills (${(totalBytes / 1e6).toFixed(1)}MB) into ${join(out, "public")}; ` +
      `excluded machine-bound: [${excluded.map((s) => s.entry.frontmatter.name).join(", ")}]`,
  );

  writeFileSync(join(staging, marker), "skill-server snapshot\n");
  let backup: string | undefined;
  if (existsSync(out)) {
    backup = mkdtempSync(join(dirname(out), ".skill-server-old-"));
    renameSync(out, join(backup, "snapshot"));
  }
  try { renameSync(staging, out); }
  catch (error) { if (backup) renameSync(join(backup, "snapshot"), out); throw error; }
  if (backup) rmSync(backup, { recursive: true, force: true });
} finally { rmSync(staging, { recursive: true, force: true }); }

}
