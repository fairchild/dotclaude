# skill-server architecture

A walkthrough of `mcp/` for someone reading the implementation or embedding it.
It describes the code at commit `5ea05d4f`, and every mechanism claim links to
the line that implements it at that commit, so newer code may have moved. The
user-facing contract lives in [mcp/README.md](../mcp/README.md), the HTTP surface
in [worker/HTTP.md](../mcp/worker/HTTP.md), and the publication gates in the
[release plan](skill-server-release-plan.md).

The package implements the experimental
[Skills over MCP extension](https://github.com/modelcontextprotocol/ext-skills)
(SEP-2640): a skill is a directory holding a `SKILL.md`, and the extension
publishes it as a complete manifest — verbatim frontmatter plus `{uri, digest,
size}` for every file — that a host verifies later reads against.

## The store boundary

`SkillStore` is the only thing the method handlers talk to
([store.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/store.ts#L14)). It has three members: `skills()` returns
the served entries, `read(name, rel)` returns one file's bytes or null
([store.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/store.ts#L17)), and `refresh(name)` re-observes one skill
([store.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/store.ts#L19)). `createSkillsServer` takes a store and
returns a stock SDK `Server`
([server.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/server.ts#L79)); the handler for `resources/read` reaches
content only through `store.read`
([server.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/server.ts#L159)). No handler opens a file, resolves a
path, or issues a `readdir`. `resources/directory/read` derives children from the
manifest rather than the filesystem, so a directory listing can never advertise a
child the entry does not carry
([server.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/server.ts#L174)).

Two stores implement it.

`FsStore` serves a live directory. It scans the whole root at construction and
hands each rejected directory to a diagnostics callback rather than serving a
malformed entry ([fs-store.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/fs-store.ts#L18),
[fs-store.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/fs-store.ts#L19)). A read is refused unless the
requested URI is in the scanned manifest
([fs-store.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/fs-store.ts#L32)), and `refresh` rescans that one skill
and replaces its cached entry ([fs-store.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/fs-store.ts#L43)).
Digests are computed at scan time
([manifest.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/manifest.ts#L122)) while reads always serve current
bytes, so an edit between scan and read surfaces to the client as a digest
mismatch, and `skills/get` is the prescribed way to resolve one.

`SnapshotStore` serves a build-time manifest through an asset fetcher
([store.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/store.ts#L28)). A deployed snapshot cannot drift from the
manifest built alongside it, so `refresh` returns the entry as built
([store.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/store.ts#L43)).

## Transports

Two bindings, one server factory.

Stdio connects the SDK's `StdioServerTransport` to a server over an `FsStore`
([stdio.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/stdio.ts#L33) for the Bun development entry point,
[cli.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/cli.ts#L32) for the packaged `skill-server stdio`). With
`--strict`, the packaged command exits 1 on any scan diagnostic before it opens
the transport ([cli.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/cli.ts#L30)).

HTTP is stateless Streamable HTTP. One POST carries one JSON-RPC message through
one fresh server:

```
POST /mcp -> serve()  origin/version/media/size checks
          -> loadStore(env)          cached manifest, per-ASSETS binding
          -> createSkillsServer      fresh Server
          -> OneShotTransport        one message in, one message out
          -> JSON response, server.close()
```

`OneShotTransport` implements the SDK `Transport` interface with a promise that
resolves on the first outbound message
([handler.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/handler.ts#L19)). Each request constructs its own
store, server and transport
([handler.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/handler.ts#L133)) and closes the server in a `finally`
([handler.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/handler.ts#L154)). There is no session id and no
server-sent-event stream: a notification (no `id`) answers 202 with no body
([handler.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/handler.ts#L141)), any method other than POST answers
405 with `Allow: POST` — GET and DELETE included
([handler.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/handler.ts#L84)) — and a handler that has not replied
within ten seconds loses a race against a timeout
([handler.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/handler.ts#L143)).

Issue #277 is open and proposes replacing `OneShotTransport` with the SDK's
`WebStandardStreamableHTTPServerTransport`, keeping the byte bound in front of it.
That is a simplification, not a defect report; this document describes only the
current code.

Two hosts wrap the same handler. `startServer` backs the CLI's `serve`: it reads
the snapshot's `public/` directory, checks that `manifest.json` parses before
listening, and pins the request origin to the listener's own bound address so an
attacker-controlled `Host` header cannot slip past the origin check
([node-server.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/node-server.ts#L9),
[node-server.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/node-server.ts#L38)). The handler caches one parsed
manifest per asset binding, so when a rebuild replaces `manifest.json` under a
running `serve`, `startServer` hands the handler a fresh binding and the new
snapshot is served ([node-server.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/node-server.ts#L28)).

`worker.ts` is the Cloudflare adapter, and it holds the policy that belongs to one
deployment rather than to the package. It answers `/robots.txt` itself, with
content signals and a pointer to `sitemap.xml`
([worker.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/worker.ts#L78)), and passes every other non-`/mcp`
path to `handleRequest` ([worker.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/worker.ts#L87)). On `/mcp` it
measures latency, writes one Analytics Engine datapoint
([worker.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/worker.ts#L47)) and, when a key is configured, sends a
PostHog event that creates no person profile
([worker.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/worker.ts#L16),
[worker.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/worker.ts#L27)). It adds `Strict-Transport-Security` to
every HTTPS response, `/mcp` included
([worker.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/worker.ts#L69)). Telemetry emission lives only in this
file; the reusable package has none.

## Building a snapshot

`buildSnapshot({root, out, baseUrl, sourceSha, sourceRepository, sourceDate, strict})`
([snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L17)) turns a live skills directory into
a static tree. It validates `baseUrl` as a bare HTTP(S) origin — no credentials,
path, query or fragment ([snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L21)) — and
threads that origin through every generated page, install prompt and endpoint
reference ([snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L105),
[snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L127)). With `strict`, any scan
diagnostic fails the build before anything is written
([snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L40)).

The three source inputs are optional and describe the commit the snapshot came
from. `sourceRepository` is the repository's web URL, validated like `baseUrl`
but allowed a path ([snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L205)). With
`sourceSha` it yields links pinned to that commit: each skill page's Source link
to `<repository>/tree/<sha>/skills/<name>`, and the implementation link in
`llms.txt` and on the landing page to `<repository>/tree/<sha>/mcp`
([snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L209)). Without a sha those links are
left out rather than pointed at a branch. `sourceDate`, the commit's ISO 8601
date, is the date in the landing page footer
([snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L175)); without it the footer shows no
date, so two builds of the same commit produce the same page. The deployment
build passes all three from the CI checkout
([prepare-worker.mjs](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/scripts/prepare-worker.mjs#L26)); the packaged CLI's
`build` passes only `sourceSha`, read from `GITHUB_SHA`
([cli.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/cli.ts#L36)).

The landing page and `llms.txt` open with the same intro, written once and
rendered as HTML or Markdown ([snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L227)).

Output validation runs before anything is created. The requested output is
canonicalized through its nearest existing ancestor
([snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L28)), then rejected if it contains, or
is contained by, the source root, or if it contains the working directory
([snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L34)). Because a top-level skill may be a
symlink pointing outside the root, the same containment test runs again against
each scanned skill's resolved directory
([snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L44)). An existing output is replaced
only when it is not a symlink and carries the builder's own
`.skill-server-output` marker ([snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L47)).

The build then writes into a fresh `mkdtemp` staging directory
([snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L49)). Copying re-hashes each source file
and aborts if size or digest disagrees with the scan
([snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L69)), so a manifest never describes
bytes the snapshot does not hold. Staging receives:

- `public/skills/<name>/<path>` with modes preserved
  ([snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L70));
- one archive and one pinned manifest per skill
  ([snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L75));
- the catalog `manifest.json` ([snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L85));
- generated `.md` and `.html` detail pages
  ([snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L102));
- a `sitemap.xml` of the landing page and each skill's directory page
  ([snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L111));
- `llms.txt` and `index.json` ([snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L142));
- the landing page ([snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L161));
- the self-hosted `library.css` and `fonts/` — Source Serif 4 and JetBrains Mono
  as WOFF2, so pages make no third-party requests
  ([snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L53),
  [snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L54));
- `version.json` ([snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L178)).

Only after all of that does the marker get written
([snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L188)), the previous output get renamed
aside, and staging get renamed into place — with the old snapshot restored if the
rename fails ([snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L195)). Staging is removed
in a `finally` either way ([snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L197)).

Detail pages are separate assets from resource paths, which is what keeps served
skill files byte-exact ([snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L94)).

## HTTP representations

`serveHttp` resolves a path to a set of candidate representations, then lets
`Accept` choose among them. The route table is five patterns
([http.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/http.ts#L49)); each format owns its asset selection,
media type and extra headers in one place
([http.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/http.ts#L36)), and the default preference order is HTML,
Markdown, plain text, archive ([http.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/http.ts#L47)). Paths are
decoded segment-by-segment and rejected on separators, dot segments, control
characters or residual `%` ([http.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/http.ts#L60)). Selection runs
through an RFC 9110 media-range implementation where specificity picks each
candidate's quality and candidate order breaks ties
([accept.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/accept.ts#L29),
[accept.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/accept.ts#L50)). Chosen bytes are fetched from the asset
binding with the original method and conditional headers
([http.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/http.ts#L116)), `Vary: Accept` is merged into whatever
the binding returned ([http.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/http.ts#L120)), and successful
responses get `X-Content-Type-Options: nosniff`
([http.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/http.ts#L123)). Every response refuses framing and sets a
`strict-origin-when-cross-origin` referrer policy
([http.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/http.ts#L33)). The raw and `/txt/` formats, whose bytes a
skill wrote, add a CSP `sandbox` so a bundled HTML or SVG file cannot run script
on the catalog's origin ([http.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/http.ts#L40),
[http.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/http.ts#L124)). The full URL table, negotiation rules,
caching and header behavior are in [worker/HTTP.md](../mcp/worker/HTTP.md); this
section does not restate them.

## Digests and archives

Manifest digests are per-file SHA-256 over the exact bytes read, formatted
`sha256:<64 hex>` and schema-checked in that form
([manifest.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/manifest.ts#L122),
[types.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/types.ts#L21)).

An archive digest is a different thing: it is the SHA-256 of the finished gzip
bytes, not a hash over the member files
([snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L79)). Those bytes are reproducible
because the tar is created with `portable: true`, a fixed `mtime` of the epoch and
no directory recursion ([snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L75)) over a
sorted member list ([snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L77)), while file
modes survive the copy ([snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L71)). Two builds
of the same source produce identical archive bytes; the packaged consumer check
asserts exactly that
([consumer-test.mjs](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/scripts/consumer-test.mjs#L50)).

That digest is then the address. Each skill gets
`/downloads/{name}/{sha256}.tgz` and a companion `{sha256}.json` carrying the
archive record and the skill entry
([snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L80)), and the pinned route serves them
only when the digest matches the current manifest's download record
([http.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/http.ts#L95)). Old digests are not retained: a snapshot
holds the current build only, so a previously published digest URL returns 404
after a rebuild. `/downloads/{name}/skill.tgz` always means the latest build.

## What is bounded, and what is not

| Bound | Value | Where |
| --- | --- | --- |
| HTTP request body | 64 KiB, checked on `Content-Length` and again while streaming, cancelling the reader | [handler.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/handler.ts#L72), [handler.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/handler.ts#L100), [handler.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/handler.ts#L110) |
| MCP handler wall time | 10 s | [handler.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/handler.ts#L145) |
| CLI `serve` request timeout | 15 s | [node-server.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/node-server.ts#L54) |
| Scan directory depth | 64 | [manifest.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/manifest.ts#L56) |
| Scan directory entries visited | 1,024 (`MAX_RESOURCES_PER_SKILL * 2`) | [manifest.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/manifest.ts#L63) |
| Files per skill | 512, enforced before the file is recorded | [types.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/types.ts#L16), [manifest.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/manifest.ts#L69) |
| Bytes per skill | 16 MiB, checked against `stat` before allocation and re-checked during the read | [types.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/types.ts#L17), [files.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/files.ts#L30) |
| Remaining per-skill budget | passed down per file so the scan cannot exceed the total | [manifest.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/manifest.ts#L117) |
| `skills/list` page size | 50 entries; resource and directory pages use 200 | [server.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/server.ts#L80), [server.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/server.ts#L141), [server.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/server.ts#L204) |
| Materialize: skills, batch bytes, catalog pages | 256 skills, 256 MiB, 256 pages | [materialize.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/materialize.ts#L8), [materialize.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/materialize.ts#L9), [materialize.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/materialize.ts#L62) |

The explicit non-guarantees matter as much as the limits.

A digest establishes byte identity, not safe behavior. Both install prompts say
so and ask the consuming agent to inspect before installing
([skill-page.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/skill-page.ts#L12)). The shell install command on
each skill page checks the archive digest, refuses to replace an installed skill,
and does nothing more ([skill-page.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/skill-page.ts#L38)); the
caution line above it says so ([skill.html](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/skill.html#L29)).

Filesystem staging assumes an operator-owned parent with no concurrent hostile
writers. `checkedPath` rejects nested symlinks and paths that escape the skill
root ([files.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/files.ts#L11)), reads open with `O_NOFOLLOW` and
verify inode and device identity across the open
([files.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/files.ts#L25)), and materialization walks every existing
ancestor of its destination rejecting symlinks
([materialize.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/materialize.ts#L77)). These are portable path checks,
not an OS sandbox against a process mutating the filesystem with equal privileges.

Nothing here bounds the SDK's allocation of an incoming stdio message. The
materialize limits bound accepted content after the SDK has parsed it.

There is no authentication. The hosted deployment is public and read-only; a
private or local deployment establishes its own access policy before network
exposure ([worker/HTTP.md](../mcp/worker/HTTP.md)). There is no sandbox around
skill contents: scanning, rendering, downloading and packaging read bytes and
never execute a skill's scripts.

## Package surface

The published tarball is a compiled Node package
([package.json](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/package.json#L37)). Three exports:

| Export | Contents |
| --- | --- |
| `skill-server` | `createSkillsServer`, `SnapshotStore`, store and entry types ([index.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/index.ts#L1)) |
| `skill-server/fs` | `FsStore` ([fs.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/fs.ts#L1)) |
| `skill-server/http` | `buildSnapshot`, `handleRequest`, `serve`, `serveHttp` ([http.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/http.ts#L1)) |

The `skill-server` executable maps to `dist/cli.js`
([package.json](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/package.json#L34)) and offers three commands — `stdio`,
`build`, `serve` ([cli.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/cli.ts#L26)).

The tarball carries `dist`, `examples` and `LICENSE` from the `files` allowlist
([package.json](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/package.json#L51)), plus the `README.md` and
`package.json` that npm always includes. The packaged consumer test asserts that
nothing else appears
([test-package.mjs](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/scripts/test-package.mjs#L40)). `dist` is whatever
`tsconfig.package.json` compiles, which is five entry points and their transitive
imports ([tsconfig.package.json](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/tsconfig.package.json#L12)), plus the two
HTML templates, `library.css` and the `fonts/` directory copied in afterwards
([build-package.mjs](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/scripts/build-package.mjs#L11),
[build-package.mjs](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/scripts/build-package.mjs#L12)).

Everything that list does not reach stays source-only. That includes the Bun
development entry points `stdio.ts` and `worker/build.ts`, `materialize.ts` and
`core/materialize.ts` (the host-side consumption example), `metrics.ts` (an
Analytics Engine query tool), `worker/worker.ts` (the Cloudflare adapter, and the
only file that emits telemetry), and `conformance/`.

## Disposition of the quality review against `d2fd7a8a`, re-checked at `5ea05d4f`

The [quality review](skill-server-quality-review.md) is preserved as historical
evidence; it was written against PR #270 at `81f4189e`. The disposition was first
recorded against the release candidate `d2fd7a8a`. Each row below states where the
code stands at `5ea05d4f` and what was read to say so.

| Review finding | Status | Evidence at `5ea05d4f` |
| --- | --- | --- |
| P1 — nested symlinks escape a selected skill | Closed | `checkedPath` throws on any symlink component and on a resolved path outside the root ([files.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/files.ts#L17), [files.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/files.ts#L19)); the scan walk throws on symlinks and special files ([manifest.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/manifest.ts#L66)); reads open `O_NOFOLLOW` and compare inode/device across the open ([files.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/files.ts#L25)); the build copies through the same checked read ([snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L68)). Regression tests cover external links, cycles, and a listed file replaced by a symlink ([security.test.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/conformance/security.test.ts#L21), [security.test.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/conformance/security.test.ts#L30)). |
| P1 — parsed JSON cast to a message without envelope validation | Closed | `JSONRPCMessageSchema.safeParse` runs before dispatch and a failure answers 400 ([handler.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/handler.ts#L125)); notifications answer 202 rather than waiting ([handler.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/handler.ts#L141)); the timeout handle is cleared on every exit ([handler.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/handler.ts#L153)). Covered by [security.test.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/conformance/security.test.ts#L110). |
| P1 — no Origin or protocol-version validation | Closed | A present `Origin` must match the request origin or an exact `ALLOWED_ORIGINS` entry, else 403 ([handler.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/handler.ts#L81)); an unsupported `MCP-Protocol-Version` answers 400 ([handler.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/handler.ts#L83)); non-POST answers 405 with `Allow`, the spec-permitted stateless behavior ([handler.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/handler.ts#L84)). `serve` fixes the origin to the bound listener ([node-server.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/node-server.ts#L38)). Covered by [security.test.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/conformance/security.test.ts#L123). |
| P1 — whole body read before length check; scanner budgets checked after traversal | Closed | `Content-Length` is rejected above 64 KiB before reading, and the stream is bounded per chunk with the reader cancelled on overflow ([handler.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/handler.ts#L100), [handler.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/handler.ts#L110)); the walk bounds depth and visited entries during traversal ([manifest.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/manifest.ts#L56), [manifest.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/manifest.ts#L63)); the file limit is checked before the path is recorded ([manifest.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/manifest.ts#L69)); size is checked against `stat` before allocation and the remaining budget is passed per file ([files.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/files.ts#L30), [manifest.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/manifest.ts#L117)). Covered by [security.test.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/conformance/security.test.ts#L49), [security.test.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/conformance/security.test.ts#L116). |
| P1 — output deleted before validation; representations derived at different times | Closed | Every overlap check, including against each resolved skill directory, runs before any directory is created ([snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L34), [snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L44)); replacement requires the `.skill-server-output` marker ([snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L47)); the build stages, re-verifies each file against the scan ([snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L69)), and swaps with a restorable rename ([snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L195)). Covered by [security.test.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/conformance/security.test.ts#L55), [security.test.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/conformance/security.test.ts#L64), [security.test.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/conformance/security.test.ts#L79). |
| P1 — generated instructions embed the original service origin | Partially | The publisher origin is an explicit, validated build input threaded through pages, prompts and the MCP endpoint line ([snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L21), [snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L105), [snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L127)); `index.json`, the JSON discovery document, uses origin-relative paths ([snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L143)); the landing template's literal origin is substituted ([snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L164)); and a second-origin build is asserted ([security.test.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/conformance/security.test.ts#L93), [consumer-test.mjs](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/scripts/consumer-test.mjs#L51)). One residue remains: `skill-page.ts` still defaults `origin` to `https://skills.cloudcompute.com` for library callers that omit it ([skill-page.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/skill-page.ts#L14)); it is not reachable through `buildSnapshot`, which always passes an origin. A second residue, a hardcoded implementation-source link in `llms.txt` and on the landing page, closed after `d2fd7a8a`: both now come from the optional `sourceRepository` build input and are omitted without it ([snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L129), [snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L173)). |
| Conditional blocker — `materialize.ts` joins resource-derived paths | Closed, and still out of the package | Namespaces, portable paths, path collisions, dynamic manifests and a missing `SKILL.md` are all validated before any fetch ([materialize.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/materialize.ts#L41), [materialize.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/materialize.ts#L19), [materialize.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/materialize.ts#L60), [materialize.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/materialize.ts#L46), [materialize.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/materialize.ts#L67)); every existing destination ancestor is checked for symlinks ([materialize.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/materialize.ts#L77)); writes go to a fresh `mkdtemp` staging as `0600`/`0700` with `wx`, and only a complete verified batch is renamed into place ([materialize.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/materialize.ts#L104), [materialize.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/materialize.ts#L108)). It stays outside the public CLI: `tsconfig.package.json` does not compile it ([tsconfig.package.json](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/tsconfig.package.json#L12)). |

The review's follow-up paragraph is also closed. The package now has compiled
exports, a CLI mapping, a version, a file allowlist and clean-install tests
([package.json](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/package.json#L31),
[test-package.mjs](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/scripts/test-package.mjs#L40)); analytics are confined
to the deployment adapter ([worker.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/worker.ts#L47)); archive
metadata is normalized before any reproducibility claim
([snapshot.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/snapshot.ts#L75)); and skill-name validation happens
in the scanner, so stdio and hosted builds reject the same names
([manifest.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/manifest.ts#L93)). One residue: the same name regex is
written out separately in the scanner, the page generator, the HTTP resolver and
the materializer ([skill-page.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/skill-page.ts#L7),
[http.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/worker/http.ts#L102),
[materialize.ts](https://github.com/fairchild/dotclaude/blob/5ea05d4f5e34a6dd0636d882c20c4091c048b3f3/mcp/core/materialize.ts#L41)) rather than shared from one
place.

To re-pin this document to a newer commit, re-derive each line by what
the sentence claims rather than by its old number, and update the commit in every
link and in the opening paragraph.
