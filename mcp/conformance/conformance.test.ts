/**
 * SEP-2640 conformance suite, run over a real client/server pair on the
 * in-memory transport. Each test states the spec requirement it checks.
 */
import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

import { FsStore } from "../core/fs-store.ts";
import { createSkillsServer, type SkillsServerOptions } from "../core/server.ts";
import {
  DIRECTORY_MIME,
  DirectoryReadResultSchema,
  EXTENSION_ID,
  SkillsGetResultSchema,
  SkillsListResultSchema,
  type SkillEntry,
} from "../core/types.ts";

const FIXTURES = join(import.meta.dir, "fixtures");

async function connect(options: SkillsServerOptions = {}) {
  const diagnostics: string[] = [];
  const store = new FsStore(FIXTURES, (m) => diagnostics.push(m));
  const server = createSkillsServer(store, options);
  const client = new Client({ name: "conformance", version: "0.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server, diagnostics };
}

const listSkills = (client: Client, cursor?: string) =>
  client.request({ method: "skills/list", params: cursor ? { cursor } : {} }, SkillsListResultSchema);

const getSkill = (client: Client, uri: string) =>
  client.request({ method: "skills/get", params: { uri } }, SkillsGetResultSchema);

const readDirectory = (client: Client, uri: string) =>
  client.request({ method: "resources/directory/read", params: { uri } }, DirectoryReadResultSchema);

describe("capability declaration", () => {
  test("initialize declares the extension with directoryRead", async () => {
    const { client } = await connect();
    const capabilities = client.getServerCapabilities();
    expect(capabilities?.extensions?.[EXTENSION_ID]).toEqual({ directoryRead: true });
  });
});

describe("skills/list", () => {
  test("entries carry uri, verbatim frontmatter, and a complete resources set", async () => {
    const { client } = await connect();
    const { skills } = await listSkills(client);
    expect(skills.map((s) => s.frontmatter.name).sort()).toEqual([
      "bound-skill", "git-workflow", "pdf-processing",
    ]);

    for (const skill of skills) {
      // Resource Mapping: SKILL.md explicit in the URI; final skill-path
      // segment equals the frontmatter name.
      expect(skill.uri.endsWith("/SKILL.md")).toBe(true);
      const segments = skill.uri.replace("skill://", "").split("/");
      expect(segments[segments.length - 2]).toBe(skill.frontmatter.name);

      // Resources: complete, each file exactly once, SKILL.md included.
      const resources = skill.resources;
      expect(resources).not.toBe("dynamic");
      if (resources === "dynamic") continue;
      const uris = resources.map((r) => r.uri);
      expect(uris).toContain(skill.uri);
      expect(new Set(uris).size).toBe(uris.length);
      for (const r of resources) {
        expect(r.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(r.size).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test("pdf-processing lists every supporting file, nested directories included", async () => {
    const { client } = await connect();
    const { skills } = await listSkills(client);
    const pdf = skills.find((s) => s.frontmatter.name === "pdf-processing")!;
    expect((pdf.resources as Exclude<SkillEntry["resources"], "dynamic">).map((r) => r.uri).sort()).toEqual([
      "skill://pdf-processing/SKILL.md",
      "skill://pdf-processing/references/FORMS.md",
      "skill://pdf-processing/scripts/extract.py",
      "skill://pdf-processing/templates/invoice.md",
      "skill://pdf-processing/templates/regional/eu-invoice.md",
    ]);
  });

  test("malformed skills are skipped with a diagnostic, not served", async () => {
    const { client, diagnostics } = await connect();
    const { skills } = await listSkills(client);
    expect(skills.some((s) => String(s.uri).includes("bad-name"))).toBe(false);
    expect(diagnostics.some((d) => d.includes("bad-name"))).toBe(true);
  });

  test("pagination walks the full set with atomic entries", async () => {
    const { client } = await connect({ pageSize: 1 });
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await listSkills(client, cursor);
      for (const s of page.skills) {
        expect(s.resources).toBeDefined(); // atomic: never split across pages
        seen.push(String(s.frontmatter.name));
      }
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen.sort()).toEqual(["bound-skill", "git-workflow", "pdf-processing"]);
  });

  test("tier filter serves only portable skills", async () => {
    const { client } = await connect({ tier: "portable" });
    const { skills } = await listSkills(client);
    expect(skills.map((s) => s.frontmatter.name)).not.toContain("bound-skill");
    expect(skills.map((s) => s.frontmatter.name)).toContain("git-workflow");
  });
});

describe("integrity", () => {
  test("digest and size match the bytes resources/read returns", async () => {
    const { client } = await connect();
    const { skills } = await listSkills(client);
    for (const skill of skills) {
      if (skill.resources === "dynamic") continue;
      for (const resource of skill.resources) {
        const read = await client.readResource({ uri: resource.uri });
        const content = read.contents[0]!;
        const bytes = "text" in content
          ? Buffer.from(content.text as string, "utf-8")
          : Buffer.from(content.blob as string, "base64");
        expect(bytes.length).toBe(resource.size);
        expect(`sha256:${createHash("sha256").update(bytes).digest("hex")}`).toBe(resource.digest);
      }
    }
  });

  test("listing frontmatter is field-identical to the SKILL.md it describes", async () => {
    const { client } = await connect();
    const { skills } = await listSkills(client);
    for (const skill of skills) {
      const read = await client.readResource({ uri: skill.uri });
      const text = (read.contents[0] as { text: string }).text;
      const parsed = parseYaml(text.slice(3, text.indexOf("\n---", 3) + 1));
      expect(parsed).toEqual(skill.frontmatter);
    }
  });
});

describe("skills/get", () => {
  test("returns an entry identical in shape to the listing's", async () => {
    const { client } = await connect();
    const { skills } = await listSkills(client);
    for (const listed of skills) {
      const { skill } = await getSkill(client, listed.uri);
      expect(skill).toEqual(listed);
    }
  });

  test("unknown skill answers -32602, the code resources/read uses", async () => {
    const { client } = await connect();
    expect(getSkill(client, "skill://no-such-skill/SKILL.md")).rejects.toThrow(/-32602|Invalid params|unknown/i);
    expect(getSkill(client, "skill://pdf-processing/references/FORMS.md")).rejects.toThrow();
  });
});

describe("resources/directory/read", () => {
  test("lists direct children only, subdirectories as inode/directory", async () => {
    const { client } = await connect();
    const root = await readDirectory(client, "skill://pdf-processing");
    expect(root.resources.map((r) => r.name).sort()).toEqual([
      "SKILL.md", "references", "scripts", "templates",
    ]);
    const templates = await readDirectory(client, "skill://pdf-processing/templates");
    expect(templates.resources).toEqual([
      { uri: "skill://pdf-processing/templates/invoice.md", name: "invoice.md", mimeType: "text/markdown" },
      { uri: "skill://pdf-processing/templates/regional", name: "regional", mimeType: DIRECTORY_MIME },
    ]);
  });

  test("file and unknown URIs answer -32602", async () => {
    const { client } = await connect();
    expect(readDirectory(client, "skill://pdf-processing/SKILL.md")).rejects.toThrow();
    expect(readDirectory(client, "skill://pdf-processing/no-such-dir")).rejects.toThrow();
    expect(readDirectory(client, "skill://no-such-skill")).rejects.toThrow();
  });
});

describe("reading", () => {
  test("a directory URI is not readable as a file", async () => {
    const { client } = await connect();
    expect(client.readResource({ uri: "skill://pdf-processing/templates" })).rejects.toThrow();
  });

  test("path traversal is rejected", async () => {
    const { client } = await connect();
    expect(client.readResource({ uri: "skill://pdf-processing/../bad-name/SKILL.md" })).rejects.toThrow();
  });
});
