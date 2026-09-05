import { describe, expect, test } from "bun:test";
import { serveHttp } from "../worker/http.ts";
import type { StoredSkill } from "../core/store.ts";

const directoryBytes = new TextEncoder().encode("# Example\n\n## Files\n[SKILL.md](/skills/example/SKILL.md)\n");
const files: Record<string, Uint8Array> = {
  "SKILL.md": new TextEncoder().encode("# Example\r\nExact bytes, no final newline"),
  "scripts/run.py": new TextEncoder().encode("print('hello')\n"),
  "references/a b.md": new TextEncoder().encode("# Space\n"),
  "example.html": new TextEncoder().encode("<!doctype html><title>Supporting file</title>"),
  "image.png": new Uint8Array([137, 80, 78, 71, 0, 255, 128]),
};
const skills: StoredSkill[] = [{ tier: "portable", entry: {
  uri: "skill://example/SKILL.md", frontmatter: { name: "example", description: "Example" },
  resources: Object.entries(files).map(([path, bytes]) => ({ uri: `skill://example/${path}`, size: bytes.length, digest: `sha256:${"0".repeat(64)}` })),
} }];
let forwarded: Request;
const assets = { async fetch(request: Request) {
  forwarded = request;
  const path = decodeURIComponent(new URL(request.url).pathname);
  const body = path === "/skill/example.html" ? new TextEncoder().encode("<h1>Example</h1>")
    : path === "/skill/example.md" ? directoryBytes
    : path === "/downloads/example/skill.tgz" ? new Uint8Array([31, 139, 8, 0, 255])
    : files[path.replace("/skills/example/", "")];
  if (!body) return new Response(null, { status: 404 });
  const headers = { ETag: `"${path}"`, "Cache-Control": "public, max-age=0, must-revalidate", Vary: "Accept-Encoding" };
  if (request.headers.get("If-None-Match") === headers.ETag) return new Response(null, { status: 304, headers });
  return new Response(request.method === "HEAD" ? null : body, { headers });
} };
const get = (path: string, accept?: string, method = "GET", headers: Record<string, string> = {}) => serveHttp(
  new Request(`https://skills.test${path}`, { method, headers: { ...(accept === undefined ? {} : { Accept: accept }), ...headers } }),
  assets, async () => skills,
);

describe("HTTP route and representation contract", () => {
  test.each([
    [undefined, "text/html"], ["*/*", "text/html"], ["text/*", "text/html"],
    ["text/plain", "text/plain"], ["text/markdown", "text/markdown"], ["application/gzip", "application/gzip"],
    ["text/html;q=0, text/*;q=0.8", "text/markdown"],
    ["text/*;q=0, */*;q=0.5", "application/gzip"],
    ["text/plain;q=0.9, text/html;q=0.2", "text/plain"],
    ["text/html;q=0.1, text/*;q=0.9", "text/markdown"],
    ['TEXT/PLAIN;CHARSET="UTF-8"', "text/plain"],
    ['text/plain;profile="a,b;c",text/markdown;q=0.5', "text/markdown"],
    ["text/plain;charset=ascii, text/markdown", "text/markdown"],
  ])("negotiates %s", async (accept, type) => {
    for (const path of ["/skill/example", "/skills/example", "/skills/example/"]) {
      const response = await get(path, accept);
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toStartWith(type!);
      expect(response.headers.get("Vary")).toBe("Accept-Encoding, Accept");
    }
  });

  test.each(["application/json", "*/*;q=0", "text/html;q=0", "", "text/plain;q=2", "text/plain;q=0.1234", "text/plain;charset=ascii"])("rejects unacceptable %s", async accept => {
    const response = await get("/skills/example", accept);
    expect(response.status).toBe(406);
    expect(response.headers.get("Vary")).toBe("Accept");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  test.each([
    ["/txt/example/SKILL.md", "text/plain", "SKILL.md"],
    ["/txt/example", "text/plain", "SKILL.md"],
    ["/skills/example/SKILL.md", "text/markdown", "SKILL.md"],
    ["/skill/example/SKILL.md", "text/markdown", "SKILL.md"],
    ["/txt/example/scripts/run.py", "text/plain", "scripts/run.py"],
    ["/skills/example/scripts/run.py", "text/x-python", "scripts/run.py"],
    ["/txt/example/image.png", "image/png", "image.png"],
    ["/skills/example/image.png", "image/png", "image.png"],
    ["/skills/example/example.html", "text/html", "example.html"],
    ["/txt/example/example.html", "text/plain", "example.html"],
    ["/txt/example/references/a%20b.md", "text/plain", "references/a b.md"],
  ])("preserves bytes at %s", async (path, type, file) => {
    const response = await get(path!);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toStartWith(type!);
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual(Array.from(files[file!]!));
    expect((await get(path!, "application/unavailable")).status).toBe(406);
  });

  test("directory representations retain navigation while SKILL.md stays pristine", async () => {
    for (const path of ["/skill/example.md", "/skills/example.txt", "/skills/example/"]) {
      const response = await get(path, path.endsWith(".txt") ? "text/plain" : "text/markdown");
      expect(await response.text()).toBe(new TextDecoder().decode(directoryBytes));
    }
    expect(await (await get("/skills/example/SKILL.md")).text()).toBe(new TextDecoder().decode(files["SKILL.md"]));
  });

  test("explicit format constrains negotiation and ignores request Content-Type", async () => {
    expect((await get("/skill/example.html", "text/plain")).status).toBe(406);
    expect((await get("/txt/example/SKILL.md", "text/html")).status).toBe(406);
    expect((await get("/skill/example", undefined, "GET", { "Content-Type": "text/plain" })).headers.get("Content-Type")).toStartWith("text/html");
  });

  test("archives have attachment names and exact bytes", async () => {
    for (const path of ["/downloads/example/skill.tgz", "/downloads/example/skill.tar.gz", "/skill/example.tgz", "/skills/example.tar.gz", "/skill/example"]) {
      const response = await get(path, "application/gzip");
      expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="example.tgz"');
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([31, 139, 8, 0, 255]));
    }
  });

  test("HEAD and conditions reach the selected asset; 304 retains Vary and type", async () => {
    const head = await get("/skills/example", "text/plain", "HEAD");
    expect(await head.text()).toBe("");
    expect(forwarded.method).toBe("HEAD");
    const headers = { "If-None-Match": head.headers.get("ETag")! };
    const cached = await get("/skills/example", "text/plain", "GET", headers);
    expect(cached.status).toBe(304);
    expect(cached.headers.get("Content-Type")).toStartWith("text/plain");
    expect(cached.headers.get("Vary")).toBe("Accept-Encoding, Accept");
    expect((await get("/skills/example", "text/html", "GET", headers)).status).toBe(200);
    expect((await get("/skills/example", "image/png", "HEAD")).status).toBe(406);
    expect(await (await get("/skills/missing", undefined, "HEAD")).text()).toBe("");
  });

  test.each(["/skills/missing", "/txt/example/missing.py", "/downloads/missing/skill.tgz", "/skills/example/scripts", "/skills/example/no-extension", "/random"])("missing %s is 404", async path => {
    expect((await get(path)).status).toBe(404);
  });
  test.each(["/txt/example/%GG", "/txt/example/%252e%252e/SKILL.md", "/txt/example/a%2fb", "/txt/example/%00", "/txt/example/a%5cb", "/txt//example/SKILL.md"])("malformed %s is 400", async path => {
    expect((await get(path)).status).toBe(400);
  });
  test("normalized traversal cannot escape the manifest; methods are restricted", async () => {
    expect((await get("/txt/example/%2e%2e/manifest.json")).status).toBe(404);
    const response = await get("/skills/example", undefined, "POST");
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET, HEAD");
  });
});
