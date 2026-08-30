/**
 * Wire types for the MCP Skills Extension (SEP-2640).
 * https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2640
 *
 * A skill entry is a complete manifest: verbatim SKILL.md frontmatter plus
 * every file as {uri, digest, size}. Hosts verify reads against it and bind
 * approvals to it, so completeness is load-bearing, not advisory.
 */
import { z } from "zod";

export const EXTENSION_ID = "io.modelcontextprotocol/skills";
export const SKILL_SCHEME = "skill";
export const DIRECTORY_MIME = "inode/directory";

/** Fixed per-skill limits from the SEP — what every conforming host accepts. */
export const MAX_RESOURCES_PER_SKILL = 512;
export const MAX_TOTAL_BYTES_PER_SKILL = 16 * 1024 * 1024;

export const SkillResourceSchema = z.object({
  uri: z.string(),
  digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  size: z.number().int().nonnegative(),
});

export const SkillEntrySchema = z.object({
  uri: z.string(),
  frontmatter: z.record(z.string(), z.unknown()).and(
    z.object({ name: z.string(), description: z.string() }),
  ),
  resources: z.union([z.array(SkillResourceSchema), z.literal("dynamic")]),
});

export type SkillResource = z.infer<typeof SkillResourceSchema>;
export type SkillEntry = z.infer<typeof SkillEntrySchema>;

export const SkillsListRequestSchema = z.object({
  method: z.literal("skills/list"),
  params: z.object({ cursor: z.string().optional() }).optional(),
});

export const SkillsListResultSchema = z.object({
  resultType: z.literal("complete").optional(),
  skills: z.array(SkillEntrySchema),
  nextCursor: z.string().optional(),
});

export const SkillsGetRequestSchema = z.object({
  method: z.literal("skills/get"),
  params: z.object({ uri: z.string() }),
});

export const SkillsGetResultSchema = z.object({
  resultType: z.literal("complete").optional(),
  skill: SkillEntrySchema,
});

export const DirectoryReadRequestSchema = z.object({
  method: z.literal("resources/directory/read"),
  params: z.object({ uri: z.string(), cursor: z.string().optional() }),
});

export const DirectoryReadResultSchema = z.object({
  resultType: z.literal("complete").optional(),
  resources: z.array(
    z.object({
      uri: z.string(),
      name: z.string(),
      mimeType: z.string().optional(),
      description: z.string().optional(),
    }),
  ),
  nextCursor: z.string().optional(),
});

/** skill://<skill-path>/<file-path> — no trailing slash on directories. */
export function skillUri(skillPath: string, filePath?: string): string {
  return filePath ? `${SKILL_SCHEME}://${skillPath}/${filePath}` : `${SKILL_SCHEME}://${skillPath}`;
}

/** Split a skill:// URI into path segments; null for other schemes. */
export function parseSkillUri(uri: string): string[] | null {
  const prefix = `${SKILL_SCHEME}://`;
  if (!uri.startsWith(prefix)) return null;
  const segments = uri.slice(prefix.length).split("/").filter(Boolean);
  return segments.length > 0 ? segments : null;
}
