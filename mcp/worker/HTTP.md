# Skill HTTP downloads

The hosted catalog supports browsers and file download clients through the same
manifest-backed resource resolver. `Accept` describes the response types a client
can use. A request's `Content-Type` describes its request body and does not select
a download format. MCP remains at `POST /mcp`.

## First visit

The homepage introduces the Skills Over MCP reference implementation and its
connection endpoint, then lists skill names and descriptions with ordinary links to
canonical `/skills/{name}/` directory pages. Each page lists SKILL.md first,
then its supporting files, and offers a complete package download. MCP client configuration
is available beside the endpoint; Markdown discovery and downloads extend the same library.

`/llms.txt` and `/index.md` expose the Markdown catalog. The homepage also
negotiates Markdown, plain text, or a short JSON service description through Accept.
`Accept: application/json` returns 200 with links to MCP, the manifest, agent
instructions, and the extension specification; `/index.json` exposes it directly.
Directory Markdown contains
the description, file links, and install instructions; raw SKILL.md remains a
separate, byte-exact file. HTML alternate links and HTTP Link headers advertise
Markdown and the catalog so clients do not have to guess URLs.

## Routes

| URL | Available representations, in default preference order |
| --- | --- |
| `/`, `/index.html` | Catalog HTML, Markdown, plain text, service JSON |
| `/index.json` | Short service JSON |
| `/llms.txt`, `/index.md` | Markdown catalog, plain text |
| `/manifest.json` | Catalog JSON |
| `/skill/{name}`, `/skills/{name}` | Directory HTML, directory Markdown, directory plain text, gzip archive |
| `/skill/{name}.{html,md,txt,tgz,tar.gz}` | The explicit format; `/skills/` supports these suffixes too |
| `/skills/{name}/{path}`, `/skill/{name}/{path}` | Original file bytes, with the file's MIME type |
| `/txt/{name}`, `/txt/{name}/SKILL.md` | Original SKILL.md bytes as `text/plain` |
| `/txt/{name}/{path}` | Original supporting file bytes; known text extensions use `text/plain`, binary extensions keep their MIME type |
| `/downloads/{name}/{sha256}.tgz`, `/downloads/{name}/{sha256}.json` | Pinned archive and matching file manifest |
| `/downloads/{name}/skill.tgz`, `/downloads/{name}/skill.tar.gz` | Original gzip archive, `Content-Disposition: attachment; filename="{name}.tgz"` |

The two negotiated skill URLs also accept a trailing slash. Paths are case
sensitive; encode each path segment separately. Every skill and file must exist
in the portable manifest. Directories, unknown files, and unknown skills return
404. Malformed escapes, encoded separators, double-encoded escapes, and control
characters return 400. URL parsers normalize dot segments before the Worker sees
them; the resulting path must still resolve through the manifest. No arbitrary
filesystem path or asset fallback is available.

An explicit prefix or suffix restricts the available representations. It does
not override an incompatible `Accept`: `/txt/example/SKILL.md` with
`Accept: text/html` returns 406. No arbitrary JSON, PDF, or other conversion is
provided. The HTML directory and skill reading content are generated at build time.
Supporting HTML files stay byte-exact and are served at their full `.html` paths.

## Negotiation and caching

Missing `Accept` uses the route's default. Wildcards and equal-quality ties use
server preference from the table. For each candidate, the most specific matching
range determines its quality, including `q=0` exclusions; then the highest
positive quality wins. Media parameters must match, including UTF-8 charset when
specified. Invalid ranges or quality values are ignored; an empty header or no
acceptable candidate returns 406 with the available types. Duplicate ranges with
equal specificity use the first occurrence.

All download routes support GET and HEAD; other methods return 405 with `Allow`.
Responses include `Vary: Accept`, even on explicit paths because the header can
change success to 406. Errors use `Cache-Control: no-store`. Successful responses
include `X-Content-Type-Options: nosniff`. Archives use `application/gzip`, not a
`Content-Encoding` transformation.

The Worker forwards the original method, range, and conditional headers to the
selected asset. Cloudflare supplies asset ETags, cache policy, and conditional
responses; this layer preserves them and merges `Vary`. Plain text and Markdown
directory views share bytes and an asset ETag. HTML and archives have their own asset ETags.
The Worker does not synthesize Last-Modified or implement a second cache.
`run_worker_first = true` prevents asset dispatch from skipping negotiation.
`html_handling = "none"` prevents HTML redirects from changing raw file paths.

## Package installation

Both install prompts ask the consuming agent to inspect before installing: treat
skill text as untrusted during review, check archive paths, entry types, permissions,
and expanded size, then look for prompt injection, credential access, telemetry,
unexpected outbound data, and attempts to weaken safeguards. Suspicion or an
inability to inspect safely means stop and report to the user. Neither prompt
requests telemetry or uploads. These instructions are guidance, not a malware scan
or a guarantee that a model will detect malicious content. A matching hash proves
integrity only. See [OWASP's prompt injection guidance](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html).

Archive filenames are SHA-256 digests of the finished compressed tarball bytes,
including archive metadata. They are not hashes of concatenated source files;
timestamp or ownership changes can change the archive digest. The companion JSON
manifest uses the archive digest as its identifier, not a hash of its own JSON bytes.

The default copied prompt identifies the package, destination guidance, archive
SHA-256, and its matching manifest. The archive and manifest URLs contain the
archive digest, and the resolver accepts only the package named in the hosted
catalog. This prevents silent substitution when the snapshot changes. The full
inline prompt is a separate option; it includes SKILL.md but supporting files
still need downloading.

Content addressing does not promise historical retention. This static deployment
contains the current build only: an older package URL can return 404 after a new
deployment. Clients must report that result rather than silently fetch latest.
Persisting historical packages would need a separate storage/retention decision.
The existing `/downloads/{name}/skill.tgz` URL continues to mean the latest build.

## Extending the policy

`build.ts` derives catalog, directory pages, package metadata, and archives from
one scan. Both HTML templates share `library.css`.

`http.ts` contains the route table, manifest resolver, and format definitions.
Add an alias as a route entry that resolves to an existing format. Add a new
representation in `formats`, keeping asset selection, MIME type, and custom
headers together, then expose it through a route or the preference list. If it
needs different bytes, generate a separate asset in `build.ts`; this keeps
Cloudflare's validators tied to the actual representation. Do not transform a
body while forwarding an unchanged ETag or Content-Length.

Extend `textTypes` or `binaryTypes` for another file extension. Unknown extensions
use `application/octet-stream`; `/txt/` does not decode or relabel unknown binary
data. This HTTP table is separate from MCP's text/blob classification, whose
protocol behavior remains unchanged.

The conformance suite covers the HTTP policy. The opt-in live test adds coverage
for Cloudflare dispatch and validators that an in-process asset stub cannot prove;
it checks every built resource through raw and txt URLs and every archive. Its
first-visit case starts at the homepage, follows the advertised links, and verifies
the downloaded package and every member against the discovered manifest. This is
a deterministic navigation check, not evidence from an independent agent usability study.

```sh
cd mcp
bun run typecheck
bun run build
bun run test
# Separate terminal:
bunx wrangler dev -c worker/wrangler.toml --local --port 8792
SKILLS_HTTP_ORIGIN=http://localhost:8792 bun test conformance/http-live.test.ts
```

Sources: [RFC 9110 Accept](https://www.rfc-editor.org/rfc/rfc9110.html#section-12.5.1),
[Vary](https://www.rfc-editor.org/rfc/rfc9110.html#section-12.5.5),
[Cloudflare Worker-first dispatch](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/),
[asset headers and ETags](https://developers.cloudflare.com/workers/static-assets/headers/),
and [HTML handling](https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/).
