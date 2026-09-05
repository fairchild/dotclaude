#!/usr/bin/env bun
/**
 * Build the hosted binding's snapshot: scan a skills directory, keep the
 * portable tier (machine-bound skills are meaningful only on the machine
 * they name — the local stdio binding serves those), and emit
 *
 *   dist/public/manifest.json        the served entries, tiers included
 *   dist/public/skills/<name>/<path> file contents, addressed as the
 *                                    SnapshotStore fetches them
 *
 * The deployed snapshot cannot drift from its manifest — both come from this
 * one scan, which is what lets the Worker's skills/get answer as built.
 *
 * Usage: bun worker/build.ts [--root <skills-dir>] [--out <dist-dir>]
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { directoryMarkdown, escapeHtml, renderSkillPage, validateSkillName, type Download } from "./skill-page.ts";

import { scanCatalog } from "../core/manifest.ts";

const { values } = parseArgs({
  options: {
    root: { type: "string", default: join(import.meta.dir, "..", "..", "skills") },
    out: { type: "string", default: join(import.meta.dir, "dist") },
  },
});

const publicDir = join(values.out!, "public");
rmSync(values.out!, { recursive: true, force: true });
mkdirSync(join(publicDir, "skills"), { recursive: true });
cpSync(join(import.meta.dir, "library.css"), join(publicDir, "library.css"));

const catalog = scanCatalog(values.root!);
for (const d of catalog.diagnostics) console.error(`skipped ${d.skill}: ${d.reason}`);

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
    cpSync(join(skill.dir, rel), target, { dereference: true });
  }
  const archiveDir = join(publicDir, "downloads", name);
  mkdirSync(archiveDir, { recursive: true });
  execFileSync("tar", ["-czf", join(archiveDir, "skill.tgz"), "-C", join(publicDir, "skills"), name], {
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
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
const detailTemplate = readFileSync(join(import.meta.dir, "skill.html"), "utf-8");
mkdirSync(join(publicDir, "skill"), { recursive: true });
for (const { entry, dir } of portable) {
  const name = String(entry.frontmatter.name);
  const markdown = readFileSync(join(dir, "SKILL.md"), "utf-8");
  const paths = entry.resources === "dynamic" ? ["SKILL.md"] : entry.resources.map(r => r.uri.slice(`skill://${name}/`.length));
  writeFileSync(join(publicDir, "skill", `${name}.md`), directoryMarkdown(name, String(entry.frontmatter.description ?? ""), paths, downloads[name]));
  writeFileSync(join(publicDir, "skill", `${name}.html`), renderSkillPage(
    detailTemplate, name, String(entry.frontmatter.description ?? ""), markdown,
    paths, downloads[name],
  ));
}

const catalogMarkdown = `# Skills over MCP

This site began as a reference implementation of the experimental [Skills Over MCP project](https://github.com/modelcontextprotocol/ext-skills). The same library now supports readable pages, Markdown discovery, and verified downloads, intended to make access intuitive and efficient for agents.

## Connect through MCP

Endpoint: https://skills.cloudcompute.com/mcp

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
const template = readFileSync(join(import.meta.dir, "index.html"), "utf-8");
writeFileSync(
  join(publicDir, "index.html"),
  template
    .replaceAll("{{PORTABLE}}", String(portable.length))
    .replaceAll("{{TOTAL}}", String(catalog.skills.length))
    .replaceAll("{{MACHINE_BOUND}}", excluded.map((s) => String(s.entry.frontmatter.name)).join(", ") || "none")
    .replaceAll("{{SKILL_ROWS}}", rows)
    .replaceAll("{{BUILT_AT}}", new Date().toISOString().slice(0, 10)),
);

const totalBytes = portable.reduce(
  (n, s) => n + (s.entry.resources === "dynamic" ? 0 : s.entry.resources.reduce((m, r) => m + r.size, 0)),
  0,
);
console.error(
  `built ${portable.length} portable skills (${(totalBytes / 1e6).toFixed(1)}MB) into ${publicDir}; ` +
    `excluded machine-bound: [${excluded.map((s) => s.entry.frontmatter.name).join(", ")}]`,
);
