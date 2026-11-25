/**
 * Wire shape against the extension's own JSON Schema: every 2026-07-28
 * response the hosted handler gives for a Skills method must validate as the
 * schema's `*ResultResponse` (or `JSONRPCErrorResponse`) definition.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/server/validators/cf-worker";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import worker from "../worker/worker.ts";
import { modernRequest } from "./wire.ts";

const SCHEMA_FILE = join(import.meta.dir, "schema", "ext-skills-beta.schema.json");
const SCHEMA = JSON.parse(readFileSync(SCHEMA_FILE, "utf-8"));
const FIXTURES = join(import.meta.dir, "fixtures");
const TMP_PARENT = mkdtempSync(join(tmpdir(), "skill-server-schema-"));
const PUBLIC = join(TMP_PARENT, "dist", "public");

const env = {
  ASSETS: {
    async fetch(request: Request): Promise<Response> {
      const file = join(PUBLIC, decodeURIComponent(new URL(request.url).pathname));
      return existsSync(file) ? new Response(readFileSync(file)) : new Response("not found", { status: 404 });
    },
  },
};

const validators = new CfWorkerJsonSchemaValidator({ shortcircuit: false });
function check(definition: string, value: unknown) {
  return validators.getValidator({ $schema: SCHEMA.$schema, $defs: SCHEMA.$defs, $ref: `#/$defs/${definition}` })(value);
}

let id = 0;
async function send(method: string, params: Record<string, unknown> = {}) {
  const response = await worker.fetch(modernRequest("https://skills.example/mcp", ++id, method, params), env);
  return response.json();
}

beforeAll(() => {
  const build = spawnSync("bun", [join(import.meta.dir, "..", "worker", "build.ts"), "--root", FIXTURES, "--out", join(TMP_PARENT, "dist")], { encoding: "utf-8" });
  if (build.status !== 0) throw new Error(`build failed: ${build.stderr}`);
});

afterAll(() => rmSync(TMP_PARENT, { recursive: true, force: true }));

describe("ext-skills beta schema", () => {
  test("the vendored copy is the pinned spec commit's bytes", () => {
    const digest = createHash("sha256").update(readFileSync(SCHEMA_FILE)).digest("hex");
    expect(readFileSync(join(import.meta.dir, "schema", "README.md"), "utf-8")).toContain(digest);
  });

  const cases: Array<[string, string, Record<string, unknown>]> = [
    ["ListSkillsResultResponse", "skills/list", {}],
    ["GetSkillResultResponse", "skills/get", { uri: "skill://pdf-processing/SKILL.md" }],
    ["ReadResourceDirectoryResultResponse", "resources/directory/read", { uri: "skill://pdf-processing" }],
    ["ReadResourceDirectoryResultResponse", "resources/directory/read", { uri: "skill://pdf-processing/references" }],
    ["ReadResourceResultResponse", "resources/read", { uri: "skill://pdf-processing/SKILL.md" }],
    ["JSONRPCErrorResponse", "skills/get", { uri: "skill://nope/SKILL.md" }],
    ["JSONRPCErrorResponse", "resources/directory/read", { uri: "skill://pdf-processing/SKILL.md" }],
  ];
  for (const [definition, method, params] of cases) {
    test(`${method} ${JSON.stringify(params)} is a valid ${definition}`, async () => {
      const result = check(definition, await send(method, params));
      expect(result.errorMessage ?? "").toBe("");
      expect(result.valid).toBe(true);
    });
  }

  test("the check rejects a result that drops a required cache field", async () => {
    const response = await send("skills/list") as { result: Record<string, unknown> };
    delete response.result.ttlMs;
    expect(check("ListSkillsResultResponse", response).valid).toBe(false);
  });
});
