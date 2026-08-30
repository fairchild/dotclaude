/**
 * Integration over the real repo corpus: every tracked skill scans into a
 * serveable entry, tiers match the portability lint's view, and no skill
 * exceeds the SEP limits.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { scanCatalog } from "../core/manifest.ts";
import { MAX_RESOURCES_PER_SKILL, MAX_TOTAL_BYTES_PER_SKILL } from "../core/types.ts";

const REPO_SKILLS = join(import.meta.dir, "..", "..", "skills");

describe("repo corpus", () => {
  const catalog = scanCatalog(REPO_SKILLS);

  test("every skill directory scans cleanly", () => {
    expect(catalog.diagnostics).toEqual([]);
    expect(catalog.skills.length).toBeGreaterThanOrEqual(36);
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
