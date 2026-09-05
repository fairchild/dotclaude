/**
 * Live-filesystem store for the stdio binding: scans at construction, reads
 * current bytes, and rescans one skill on refresh — the skills/get path.
 */
import { readSkillFile } from "./files.ts";

import { type Catalog, type ScannedSkill, scanCatalog, scanSkill } from "./manifest.ts";
import type { SkillStore, StoredSkill } from "./store.ts";
import type { SkillEntry } from "./types.ts";

export class FsStore implements SkillStore {
  private catalog: Catalog;

  constructor(
    private root: string,
    onDiagnostic: (message: string) => void = () => {},
  ) {
    this.catalog = scanCatalog(root);
    for (const d of this.catalog.diagnostics) onDiagnostic(`skipped ${d.skill}: ${d.reason}`);
  }

  skills(): StoredSkill[] {
    return this.catalog.skills.map(({ entry, tier }) => ({ entry, tier }));
  }

  private find(name: string): ScannedSkill | undefined {
    return this.catalog.skills.find((s) => s.entry.frontmatter.name === name);
  }

  read(name: string, rel: string): Uint8Array | null {
    const skill = this.find(name);
    if (!skill || skill.entry.resources === "dynamic" || !skill.entry.resources.some(r => r.uri === `skill://${name}/${rel}`)) return null;
    try {
      return readSkillFile(skill.dir, rel).bytes;
    } catch {
      return null;
    }
  }

  refresh(name: string): SkillEntry | { error: string } {
    const skill = this.find(name);
    if (!skill) return { error: "unknown skill" };
    const fresh = scanSkill(skill.dir, name);
    if (!("entry" in fresh)) return { error: fresh.reason };
    this.catalog.skills = this.catalog.skills.map((s) => (s.dir === skill.dir ? fresh : s));
    return fresh.entry;
  }
}
