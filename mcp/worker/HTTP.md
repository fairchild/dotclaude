# Skill HTTP downloads

The hosted catalog supports browsers and file download clients through the same
manifest-backed resource resolver. `Accept` describes the response types a client
can use. A request's `Content-Type` describes its request body and does not select
a download format. MCP remains at `POST /mcp`.

## Routes

| URL | Available representations, in default preference order |
| --- | --- |
| `/`, `/index.html` | Catalog HTML |
| `/manifest.json` | Catalog JSON |
| `/skill/{name}`, `/skills/{name}` | Reading-page HTML, SKILL.md as Markdown, SKILL.md as plain text, gzip archive |
| `/skill/{name}.{html,md,txt,tgz,tar.gz}` | The explicit format; `/skills/` supports these suffixes too |
| `/skills/{name}/{path}`, `/skill/{name}/{path}` | Original file bytes, with the file's MIME type |
| `/txt/{name}`, `/txt/{name}/SKILL.md` | Original SKILL.md bytes as `text/plain` |
| `/txt/{name}/{path}` | Original supporting file bytes; known text extensions use `text/plain`, binary extensions keep their MIME type |
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
provided. The only HTML rendering is the reading page generated at build time.
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
views share bytes and an asset ETag. HTML and archives have their own asset ETags.
The Worker does not synthesize Last-Modified or implement a second cache.
`run_worker_first = true` prevents asset dispatch from skipping negotiation.
`html_handling = "none"` prevents HTML redirects from changing raw file paths.

## Extending the policy

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
it checks every built resource through raw and txt URLs and every archive.

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
