/**
 * The store boundary that keeps the method handlers transport-agnostic: the
 * stdio binding reads a live filesystem and can rescan; the Worker binding
 * serves a prebuilt snapshot where refresh is identity. Handlers never touch
 * the filesystem directly.
 */
import type { SkillEntry } from "./types.ts";

export interface StoredSkill {
  entry: SkillEntry;
  tier: "portable" | "machine-bound";
}

export interface SkillStore {
  skills(): StoredSkill[];
  /** Bytes of one skill file, or null when it does not exist. */
  read(name: string, rel: string): Promise<Uint8Array | null> | Uint8Array | null;
  /** Point-in-time re-observation of one skill; a snapshot store returns the entry unchanged. */
  refresh(name: string): SkillEntry | { error: string };
}

/**
 * A prebuilt snapshot: entries from a build-time manifest, content through an
 * asset fetcher (Workers static assets, or anything else addressable by
 * skill-relative path). A deployed snapshot cannot drift from its manifest,
 * so refresh returns the entry as built.
 */
export class SnapshotStore implements SkillStore {
  constructor(
    private entries: StoredSkill[],
    private fetchAsset: (name: string, rel: string) => Promise<Uint8Array | null>,
  ) {}

  skills(): StoredSkill[] {
    return this.entries;
  }

  read(name: string, rel: string): Promise<Uint8Array | null> {
    if (!this.entries.some((s) => s.entry.frontmatter.name === name)) return Promise.resolve(null);
    return this.fetchAsset(name, rel);
  }

  refresh(name: string): SkillEntry | { error: string } {
    const skill = this.entries.find((s) => s.entry.frontmatter.name === name);
    return skill ? skill.entry : { error: "unknown skill" };
  }
}
