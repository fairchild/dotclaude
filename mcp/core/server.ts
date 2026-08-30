/**
 * SEP-2640 Skills Extension server on the stock MCP TypeScript SDK.
 *
 * Declaring the extension commits the server to `skills/list` and
 * `skills/get`; `resources/directory/read` is gated behind the extension's
 * `directoryRead` setting. Everything else rides the base Resources
 * primitive: reading a skill file is an ordinary `resources/read`, with no
 * skill-specific read semantics — activation is the host's business.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ErrorCode,
  ListResourcesRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { type Catalog, type ScannedSkill, scanCatalog, scanSkill } from "./manifest.ts";
import {
  DIRECTORY_MIME,
  DirectoryReadRequestSchema,
  EXTENSION_ID,
  SkillsGetRequestSchema,
  SkillsListRequestSchema,
  parseSkillUri,
  skillUri,
} from "./types.ts";

export interface SkillsServerOptions {
  root: string;
  name?: string;
  version?: string;
  /** Serve only this tier; omit to serve every scanned skill. */
  tier?: "portable";
  pageSize?: number;
  onDiagnostic?: (message: string) => void;
}

const TEXT_EXTENSIONS = new Set([
  "md", "txt", "py", "ts", "tsx", "js", "mjs", "sh", "bash", "zsh",
  "json", "jsonc", "yaml", "yml", "toml", "html", "css", "csv", "svg",
]);

function mimeFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (path.endsWith(".md")) return "text/markdown";
  if (ext === "json") return "application/json";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return TEXT_EXTENSIONS.has(ext) ? "text/plain" : "application/octet-stream";
}

function isText(path: string): boolean {
  return TEXT_EXTENSIONS.has(path.split(".").pop()?.toLowerCase() ?? "");
}

function encodeCursor(index: number): string {
  return Buffer.from(String(index)).toString("base64url");
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const index = Number(Buffer.from(cursor, "base64url").toString());
  if (!Number.isInteger(index) || index < 0) {
    throw new McpError(ErrorCode.InvalidParams, `invalid cursor: ${cursor}`);
  }
  return index;
}

export function createSkillsServer(options: SkillsServerOptions): Server {
  const pageSize = options.pageSize ?? 50;
  const note = options.onDiagnostic ?? (() => {});

  let catalog: Catalog = scanCatalog(options.root);
  for (const d of catalog.diagnostics) note(`skipped ${d.skill}: ${d.reason}`);

  const served = (): ScannedSkill[] =>
    options.tier ? catalog.skills.filter((s) => s.tier === options.tier) : catalog.skills;

  const findSkill = (name: string): ScannedSkill | undefined =>
    served().find((s) => s.entry.frontmatter.name === name);

  /** Resolve a skill:// URI to its skill and skill-relative path ('' = root). */
  const resolve = (uri: string): { skill: ScannedSkill; rel: string } => {
    const segments = parseSkillUri(uri);
    const skill = segments && findSkill(segments[0]!);
    if (!segments || !skill) {
      throw new McpError(ErrorCode.InvalidParams, `unknown resource: ${uri}`);
    }
    const rel = segments.slice(1).join("/");
    if (rel.split("/").includes("..")) {
      throw new McpError(ErrorCode.InvalidParams, `invalid path in: ${uri}`);
    }
    return { skill, rel };
  };

  const server = new Server(
    { name: options.name ?? "dotclaude-skills", version: options.version ?? "0.1.0" },
    {
      capabilities: {
        resources: {},
        extensions: { [EXTENSION_ID]: { directoryRead: true } },
      },
    },
  );

  server.setRequestHandler(SkillsListRequestSchema, (request) => {
    const skills = served();
    const start = decodeCursor(request.params?.cursor);
    const page = skills.slice(start, start + pageSize).map((s) => s.entry);
    const next = start + pageSize < skills.length ? encodeCursor(start + pageSize) : undefined;
    return { resultType: "complete", skills: page, ...(next ? { nextCursor: next } : {}) };
  });

  server.setRequestHandler(SkillsGetRequestSchema, (request) => {
    const { skill, rel } = resolve(request.params.uri);
    if (rel !== "SKILL.md") {
      throw new McpError(ErrorCode.InvalidParams, `not a skill's SKILL.md: ${request.params.uri}`);
    }
    // A get is a point-in-time snapshot and the refresh path after a digest
    // mismatch, so rescan the one skill rather than answering from the
    // startup catalog.
    const fresh = scanSkill(skill.dir);
    if (!("entry" in fresh)) {
      throw new McpError(ErrorCode.InvalidParams, `skill no longer serveable: ${fresh.reason}`);
    }
    catalog.skills = catalog.skills.map((s) => (s.dir === skill.dir ? fresh : s));
    return { resultType: "complete", skill: fresh.entry };
  });

  server.setRequestHandler(ListResourcesRequestSchema, (request) => {
    const all = served().flatMap((s) =>
      (s.entry.resources === "dynamic" ? [] : s.entry.resources).map((r) => ({
        uri: r.uri,
        name: r.uri.split("/").pop()!,
        mimeType: mimeFor(r.uri),
        ...(r.uri === s.entry.uri ? { description: String(s.entry.frontmatter.description) } : {}),
      })),
    );
    const start = decodeCursor(request.params?.cursor);
    const page = all.slice(start, start + pageSize * 4);
    const next = start + page.length < all.length ? encodeCursor(start + page.length) : undefined;
    return { resources: page, ...(next ? { nextCursor: next } : {}) };
  });

  server.setRequestHandler(ReadResourceRequestSchema, (request) => {
    const { skill, rel } = resolve(request.params.uri);
    const path = rel ? join(skill.dir, rel) : skill.dir;
    let stat;
    try {
      stat = statSync(path);
    } catch {
      throw new McpError(ErrorCode.InvalidParams, `unknown resource: ${request.params.uri}`);
    }
    if (stat.isDirectory()) {
      throw new McpError(ErrorCode.InvalidParams, `directory, not a file: ${request.params.uri} (use resources/directory/read)`);
    }
    const bytes = readFileSync(path);
    return {
      contents: [
        isText(rel)
          ? { uri: request.params.uri, mimeType: mimeFor(rel), text: bytes.toString("utf-8") }
          : { uri: request.params.uri, mimeType: mimeFor(rel), blob: bytes.toString("base64") },
      ],
    };
  });

  server.setRequestHandler(DirectoryReadRequestSchema, (request) => {
    const { skill, rel } = resolve(request.params.uri);
    const skillName = String(skill.entry.frontmatter.name);
    // The manifest, not a live readdir, is the served view: directory reads
    // must never advertise a child the entry does not list.
    const manifest = skill.entry.resources === "dynamic" ? [] : skill.entry.resources;
    const prefix = rel ? `${rel}/` : "";
    const children = new Map<string, { uri: string; name: string; mimeType: string }>();
    let isDir = rel === "";
    for (const resource of manifest) {
      const filePath = resource.uri.slice(skillUri(skillName).length + 1);
      if (rel && !filePath.startsWith(prefix)) {
        if (filePath === rel) {
          throw new McpError(ErrorCode.InvalidParams, `file, not a directory: ${request.params.uri}`);
        }
        continue;
      }
      isDir = true;
      const remainder = filePath.slice(prefix.length);
      const [head, ...rest] = remainder.split("/");
      if (!head) continue;
      children.set(
        head,
        rest.length === 0
          ? { uri: skillUri(skillName, prefix + head), name: head, mimeType: mimeFor(head) }
          : { uri: skillUri(skillName, prefix + head), name: head, mimeType: DIRECTORY_MIME },
      );
    }
    if (!isDir) {
      throw new McpError(ErrorCode.InvalidParams, `unknown directory: ${request.params.uri}`);
    }
    const sorted = [...children.values()].sort((a, b) => a.name.localeCompare(b.name));
    const start = decodeCursor(request.params.cursor);
    const page = sorted.slice(start, start + pageSize * 4);
    const next = start + page.length < sorted.length ? encodeCursor(start + page.length) : undefined;
    return { resultType: "complete", resources: page, ...(next ? { nextCursor: next } : {}) };
  });

  return server;
}
