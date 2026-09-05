import type { Download } from "./skill-page.ts";
import type { StoredSkill } from "../core/store.ts";
import { negotiate } from "./accept.ts";

export interface Assets { fetch(request: Request): Promise<Response> }
type Representation = { asset: string; contentType: string; headers?: Record<string, string> };
type HostedSkill = StoredSkill & { download?: Download };
type Route = { name: string; path: string; formats: string[] };

const textTypes: Record<string, string> = {
  md: "text/markdown", txt: "text/plain", py: "text/x-python", ts: "text/plain",
  tsx: "text/plain", js: "text/javascript", mjs: "text/javascript", sh: "text/x-shellscript",
  bash: "text/x-shellscript", zsh: "text/x-shellscript", json: "application/json",
  jsonc: "text/plain", yaml: "application/yaml", yml: "application/yaml", toml: "application/toml",
  html: "text/html", css: "text/css", csv: "text/csv", svg: "image/svg+xml", xml: "application/xml",
};
const binaryTypes: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  ico: "image/vnd.microsoft.icon", pdf: "application/pdf", zip: "application/zip",
  gz: "application/gzip", tgz: "application/gzip", wasm: "application/wasm",
  woff: "font/woff", woff2: "font/woff2", mp3: "audio/mpeg", mp4: "video/mp4",
};
const encoded = (path: string) => path.split("/").map(encodeURIComponent).join("/");
function fileType(path: string, plain = false): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return textTypes[ext] ? `${plain ? "text/plain" : textTypes[ext]}; charset=utf-8`
    : binaryTypes[ext] ?? "application/octet-stream";
}

// Each format owns its asset selection, media type, and custom headers.
const formats: Record<string, (name: string, path: string) => Representation> = {
  html: name => ({ asset: `/skill/${encoded(name)}.html`, contentType: "text/html; charset=utf-8" }),
  markdown: name => ({ asset: `/skill/${encoded(name)}.md`, contentType: "text/markdown; charset=utf-8" }),
  directoryPlain: name => ({ asset: `/skill/${encoded(name)}.md`, contentType: "text/plain; charset=utf-8" }),
  plain: (name, path) => ({ asset: `/skills/${encoded(name + "/" + path)}`, contentType: fileType(path, true) }),
  raw: (name, path) => ({ asset: `/skills/${encoded(name + "/" + path)}`, contentType: fileType(path) }),
  archive: name => ({
    asset: `/downloads/${encoded(name)}/skill.tgz`, contentType: "application/gzip",
    headers: { "Content-Disposition": `attachment; filename="${name}.tgz"` },
  }),
};
const preferred = ["html", "markdown", "directoryPlain", "archive"];
const suffixFormats: Record<string, string> = { html: "html", md: "markdown", txt: "directoryPlain", tgz: "archive", "tar.gz": "archive" };
const routes: Array<{ pattern: RegExp; resolve: (match: RegExpMatchArray) => Route }> = [
  { pattern: /^\/(?:skill|skills)\/([^/]+)\.(html|md|txt|tgz|tar\.gz)$/, resolve: m => ({ name: m[1]!, path: "SKILL.md", formats: [suffixFormats[m[2]!]!] }) },
  { pattern: /^\/(?:skill|skills)\/([^/]+)\/?$/, resolve: m => ({ name: m[1]!, path: "SKILL.md", formats: preferred }) },
  { pattern: /^\/txt\/([^/]+)(?:\/(.+))?$/, resolve: m => ({ name: m[1]!, path: m[2] ?? "SKILL.md", formats: ["plain"] }) },
  { pattern: /^\/(?:skill|skills)\/([^/]+)\/(.+)$/, resolve: m => ({ name: m[1]!, path: m[2]!, formats: ["raw"] }) },
  { pattern: /^\/downloads\/([^/]+)\/skill\.(?:tgz|tar\.gz)$/, resolve: m => ({ name: m[1]!, path: "SKILL.md", formats: ["archive"] }) },
];

function pathname(request: Request): string | null {
  try {
    const parts = new URL(request.url).pathname.split("/").slice(1).map(decodeURIComponent);
    if (parts.some((part, i) => /[\\/\u0000-\u001f\u007f%]/.test(part) || part === "." || part === ".." || (!part && i !== parts.length - 1))) return null;
    return "/" + parts.join("/");
  } catch { return null; }
}

export async function serveHttp(request: Request, assets: Assets, skills: () => Promise<HostedSkill[]>): Promise<Response> {
  const error = (status: number, message: string, extra: Record<string, string> = {}) => new Response(
    request.method === "HEAD" ? null : message,
    { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...extra } },
  );
  if (!["GET", "HEAD"].includes(request.method)) return error(405, "Use GET or HEAD", { Allow: "GET, HEAD" });
  const path = pathname(request);
  if (path === null) return error(400, "Invalid path");
  let candidates: Representation[];
  if (path === "/" || path === "/index.html") {
    candidates = [
      { asset: "/index.html", contentType: "text/html; charset=utf-8" },
      { asset: "/llms.txt", contentType: "text/markdown; charset=utf-8" },
      { asset: "/llms.txt", contentType: "text/plain; charset=utf-8" },
      { asset: "/index.json", contentType: "application/json; charset=utf-8" },
    ];
  } else if (path === "/llms.txt" || path === "/index.md") {
    candidates = [
      { asset: "/llms.txt", contentType: "text/markdown; charset=utf-8" },
      { asset: "/llms.txt", contentType: "text/plain; charset=utf-8" },
    ];
  } else if (path === "/index.json" || path === "/manifest.json" || path === "/library.css") {
    candidates = [{ asset: path, contentType: path.endsWith(".css") ? "text/css; charset=utf-8" : "application/json; charset=utf-8" }];
  } else {
    const pinned = path.match(/^\/downloads\/([a-z0-9]+(?:-[a-z0-9]+)*)\/([a-f0-9]{64})\.(tgz|json)$/);
    if (pinned) {
      const download = (await skills()).find(s => s.entry.frontmatter.name === pinned[1])?.download;
      if (!download || ![download.archive, download.manifest].includes(path)) return error(404, "Snapshot unavailable");
      candidates = [{ asset: path, contentType: pinned[3] === "json" ? "application/json; charset=utf-8" : "application/gzip",
        headers: pinned[3] === "tgz" ? { "Content-Disposition": `attachment; filename="${pinned[1]}.tgz"` } : undefined }];
    } else {
      const policy = routes.find(route => route.pattern.test(path));
      if (!policy) return error(404, "Not found");
      const route = policy.resolve(path.match(policy.pattern)!);
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(route.name)) return error(404, "Unknown skill");
      const skill = (await skills()).find(s => s.entry.frontmatter.name === route.name);
      if (!skill || skill.entry.resources === "dynamic" || !skill.entry.resources.some(r => r.uri === `skill://${route.name}/${route.path}`)) return error(404, "Unknown skill or file");
      candidates = route.formats.map(format => formats[format]!(route.name, route.path));
    }
  }
  const selected = negotiate(request.headers.get("Accept"), candidates);
  // Even explicit paths vary: Accept can change a successful response to 406.
  if (!selected) return error(406, `Available content types: ${candidates.map(c => c.contentType).join(", ")}`, { Vary: "Accept" });
  const url = new URL(request.url);
  url.pathname = selected.asset;
  url.search = "";
  // The binding supplies ETag, revalidation, ranges, and cache headers for the
  // selected bytes. Forward conditional headers and the original GET/HEAD.
  const response = await assets.fetch(new Request(url.toString(), request));
  const headers = new Headers(response.headers);
  const vary = headers.get("Vary");
  if (vary !== "*" && !vary?.split(",").some(v => v.trim().toLowerCase() === "accept")) headers.set("Vary", vary ? `${vary}, Accept` : "Accept");
  if (response.ok || response.status === 304) {
    headers.set("Content-Type", selected.contentType);
    headers.set("X-Content-Type-Options", "nosniff");
    const alternate = selected.asset.startsWith("/skill/") ? selected.asset.replace(/\.(html|md)$/, ".md")
      : ["/index.html", "/llms.txt"].includes(selected.asset) ? "/llms.txt" : null;
    headers.set("Link", `${alternate ? `<${alternate}>; rel="alternate"; type="text/markdown", ` : ""}</llms.txt>; rel="describedby"`);
    for (const [key, value] of Object.entries(selected.headers ?? {})) headers.set(key, value);
  }
  return new Response(request.method === "HEAD" ? null : response.body, { status: response.status, headers });
}
