/**
 * End-to-end smoke over the real stdio binding: spawn the server as a
 * subprocess, initialize, and exercise each method through the actual
 * transport rather than the in-memory pair.
 */
import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join } from "node:path";

import { EXTENSION_ID, SkillsListResultSchema } from "../core/types.ts";

describe("stdio binding", () => {
  test("serves fixtures end-to-end over a spawned process", async () => {
    const transport = new StdioClientTransport({
      command: "bun",
      args: [join(import.meta.dir, "..", "stdio.ts"), "--root", join(import.meta.dir, "fixtures")],
    });
    const client = new Client({ name: "stdio-smoke", version: "0.0.0" }, { capabilities: {} });
    await client.connect(transport);
    try {
      expect(client.getServerCapabilities()?.extensions?.[EXTENSION_ID]).toEqual({ directoryRead: true });
      const { skills } = await client.request({ method: "skills/list", params: {} }, SkillsListResultSchema);
      expect(skills.map((s) => s.frontmatter.name).sort()).toEqual([
        "bound-skill", "git-workflow", "pdf-processing",
      ]);
      const read = await client.readResource({ uri: "skill://git-workflow/SKILL.md" });
      expect((read.contents[0] as { text: string }).text).toContain("Git workflow");
    } finally {
      await client.close();
    }
  }, 15000);

  test("--portable-only narrows to the hosted catalog", async () => {
    const transport = new StdioClientTransport({
      command: "bun",
      args: [join(import.meta.dir, "..", "stdio.ts"), "--root", join(import.meta.dir, "fixtures"), "--portable-only"],
    });
    const client = new Client({ name: "stdio-smoke", version: "0.0.0" }, { capabilities: {} });
    await client.connect(transport);
    try {
      const { skills } = await client.request({ method: "skills/list", params: {} }, SkillsListResultSchema);
      expect(skills.map((s) => s.frontmatter.name).sort()).toEqual(["git-workflow", "pdf-processing"]);
    } finally {
      await client.close();
    }
  }, 15000);
});
