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
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

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

const catalog = scanCatalog(values.root!);
for (const d of catalog.diagnostics) console.error(`skipped ${d.skill}: ${d.reason}`);

const portable = catalog.skills.filter((s) => s.tier === "portable");
const excluded = catalog.skills.filter((s) => s.tier !== "portable");

for (const skill of portable) {
  const name = String(skill.entry.frontmatter.name);
  if (skill.entry.resources === "dynamic") continue;
  for (const resource of skill.entry.resources) {
    const rel = resource.uri.slice(`skill://${name}/`.length);
    const target = join(publicDir, "skills", name, rel);
    mkdirSync(join(target, ".."), { recursive: true });
    cpSync(join(skill.dir, rel), target);
  }
}

writeFileSync(
  join(publicDir, "manifest.json"),
  JSON.stringify(
    { skills: portable.map(({ entry, tier }) => ({ entry, tier })) },
    null,
    2,
  ),
);

const totalBytes = portable.reduce(
  (n, s) => n + (s.entry.resources === "dynamic" ? 0 : s.entry.resources.reduce((m, r) => m + r.size, 0)),
  0,
);
console.error(
  `built ${portable.length} portable skills (${(totalBytes / 1e6).toFixed(1)}MB) into ${publicDir}; ` +
    `excluded machine-bound: [${excluded.map((s) => s.entry.frontmatter.name).join(", ")}]`,
);
