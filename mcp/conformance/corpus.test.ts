/**
 * Integration over the real repo corpus: every tracked skill scans into a
 * serveable entry, tiers match the portability lint's view, and no skill
 * exceeds the SEP limits.
 *
 * A checkout can carry gitignored directories under skills/ (an ecosystem
 * install's workspace, a stray scratch dir) that the scanner rightly reports
 * as diagnostics. Those are not a corpus regression, so this file scopes its
 * "no diagnostics" guarantee to skills git tracks rather than every
 * directory scanCatalog happens to see; a diagnostic naming a tracked skill
 * still fails the test.
 */
import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { scanCatalog } from "../core/manifest.ts";
import { MAX_RESOURCES_PER_SKILL, MAX_TOTAL_BYTES_PER_SKILL } from "../core/types.ts";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const REPO_SKILLS = join(REPO_ROOT, "skills");

/** Directory names of skills git tracks (each has a tracked skills/<name>/SKILL.md). */
function trackedSkillNames(): Set<string> {
  const listing = execFileSync("git", ["ls-files", "skills"], { cwd: REPO_ROOT, encoding: "utf-8" });
  const names = new Set<string>();
  for (const path of listing.split("\n")) {
    const match = /^skills\/([^/]+)\/SKILL\.md$/.exec(path);
    if (match?.[1]) names.add(match[1]);
  }
  return names;
}

describe("repo corpus", () => {
  const catalog = scanCatalog(REPO_SKILLS);
  const tracked = trackedSkillNames();

  test("every tracked skill directory scans cleanly (stray gitignored directories under skills/ may be skipped)", () => {
    const diagnosedTracked = catalog.diagnostics.filter((d) => tracked.has(d.skill));
    expect(diagnosedTracked).toEqual([]);
    expect(tracked.size).toBeGreaterThanOrEqual(36);
    const served = new Set(catalog.skills.map((s) => String(s.entry.frontmatter.name)));
    for (const name of tracked) expect(served.has(name)).toBe(true);
  });

  test("no skill exceeds the SEP per-skill limits", () => {
    for (const skill of catalog.skills) {
      if (skill.entry.resources === "dynamic") continue;
      expect(skill.entry.resources.length).toBeLessThanOrEqual(MAX_RESOURCES_PER_SKILL);
      const total = skill.entry.resources.reduce((n, r) => n + r.size, 0);
      expect(total).toBeLessThanOrEqual(MAX_TOTAL_BYTES_PER_SKILL);
    }
  });

  test("machine-bound tier matches declared frontmatter", () => {
    const bound = catalog.skills
      .filter((s) => s.tier === "machine-bound")
      .map((s) => String(s.entry.frontmatter.name))
      .sort();
    expect(bound).toEqual(["canon-printer", "signoz-log"]);
  });
});
