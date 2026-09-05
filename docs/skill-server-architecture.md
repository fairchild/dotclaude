# skill-server architecture

A walkthrough of `mcp/` for someone reading the implementation or embedding it.
It describes the code as it stands at `d2fd7a8a`; every mechanism claim links to
the line that implements it. The user-facing contract lives in
[mcp/README.md](../mcp/README.md), the HTTP surface in
[worker/HTTP.md](../mcp/worker/HTTP.md), and the publication gates in the
[release plan](skill-server-release-plan.md).

The package implements the experimental
[Skills over MCP extension](https://github.com/modelcontextprotocol/ext-skills)
(SEP-2640): a skill is a directory holding a `SKILL.md`, and the extension
publishes it as a complete manifest — verbatim frontmatter plus `{uri, digest,
size}` for every file — that a host verifies later reads against.

## The store boundary

`SkillStore` is the only thing the method handlers talk to
([store.ts](../mcp/core/store.ts#L14)). It has three members: `skills()` returns
the served entries, `read(name, rel)` returns one file's bytes or null
([store.ts](../mcp/core/store.ts#L17)), and `refresh(name)` re-observes one skill
([store.ts](../mcp/core/store.ts#L19)). `createSkillsServer` takes a store and
returns a stock SDK `Server`
([server.ts](../mcp/core/server.ts#L79)); the handler for `resources/read` reaches
content only through `store.read`
([server.ts](../mcp/core/server.ts#L159)). No handler opens a file, resolves a
path, or issues a `readdir`. `resources/directory/read` derives children from the
manifest rather than the filesystem, so a directory listing can never advertise a
child the entry does not carry
([server.ts](../mcp/core/server.ts#L174)).

Two stores implement it.

`FsStore` serves a live directory. It scans the whole root at construction and
hands each rejected directory to a diagnostics callback rather than serving a
malformed entry ([fs-store.ts](../mcp/core/fs-store.ts#L18),
[fs-store.ts](../mcp/core/fs-store.ts#L19)). A read is refused unless the
requested URI is in the scanned manifest
([fs-store.ts](../mcp/core/fs-store.ts#L32)), and `refresh` rescans that one skill
and replaces its cached entry ([fs-store.ts](../mcp/core/fs-store.ts#L43)).
Digests are computed at scan time
([manifest.ts](../mcp/core/manifest.ts#L122)) while reads always serve current
bytes, so an edit between scan and read surfaces to the client as a digest
mismatch, and `skills/get` is the prescribed way to resolve one.

`SnapshotStore` serves a build-time manifest through an asset fetcher
([store.ts](../mcp/core/store.ts#L28)). A deployed snapshot cannot drift from the
manifest built alongside it, so `refresh` returns the entry as built
([store.ts](../mcp/core/store.ts#L43)).

## Transports

Two bindings, one server factory.

Stdio connects the SDK's `StdioServerTransport` to a server over an `FsStore`
([stdio.ts](../mcp/stdio.ts#L33) for the Bun development entry point,
[cli.ts](../mcp/cli.ts#L26) for the packaged `skill-server stdio`).

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
([handler.ts](../mcp/worker/handler.ts#L17)). Each request constructs its own
store, server and transport
([handler.ts](../mcp/worker/handler.ts#L131)) and closes the server in a `finally`
([handler.ts](../mcp/worker/handler.ts#L152)). There is no session id and no
server-sent-event stream: a notification (no `id`) answers 202 with no body
([handler.ts](../mcp/worker/handler.ts#L139)), any method other than POST answers
405 with `Allow: POST` — GET and DELETE included
([handler.ts](../mcp/worker/handler.ts#L82)) — and a handler that has not replied
within ten seconds loses a race against a timeout
([handler.ts](../mcp/worker/handler.ts#L141)).

Issue #277 is open and proposes replacing `OneShotTransport` with the SDK's
`WebStandardStreamableHTTPServerTransport`, keeping the byte bound in front of it.
That is a simplification, not a defect report; this document describes only the
current code.

Two hosts wrap the same handler. `startServer` backs the CLI's `serve`: it reads
the snapshot's `public/` directory, checks that `manifest.json` parses before
listening, and pins the request origin to the listener's own bound address so an
attacker-controlled `Host` header cannot slip past the origin check
([node-server.ts](../mcp/node-server.ts#L9),
[node-server.ts](../mcp/node-server.ts#L20)). `worker.ts` is the Cloudflare
adapter: it delegates every non-`/mcp` path straight to `handleRequest`, and on
`/mcp` it measures latency, writes one Analytics Engine datapoint
([worker.ts](../mcp/worker/worker.ts#L43)) and fires a PostHog event when a key is
configured ([worker.ts](../mcp/worker/worker.ts#L15)). Telemetry emission lives only in
that file — the reusable package has none.

## Building a snapshot

`buildSnapshot({root, out, baseUrl, sourceSha})`
([snapshot.ts](../mcp/worker/snapshot.ts#L12)) turns a live skills directory into
a static tree. It validates `baseUrl` as a bare HTTP(S) origin — no credentials,
path, query or fragment ([snapshot.ts](../mcp/worker/snapshot.ts#L16)) — and
threads that origin through every generated page, install prompt and endpoint
reference ([snapshot.ts](../mcp/worker/snapshot.ts#L88),
[snapshot.ts](../mcp/worker/snapshot.ts#L101)).

Output validation runs before anything is created. The requested output is
canonicalized through its nearest existing ancestor
([snapshot.ts](../mcp/worker/snapshot.ts#L21)), then rejected if it contains, or
is contained by, the source root, or if it contains the working directory
([snapshot.ts](../mcp/worker/snapshot.ts#L27)). Because a top-level skill may be a
symlink pointing outside the root, the same containment test runs again against
each scanned skill's resolved directory
([snapshot.ts](../mcp/worker/snapshot.ts#L30)). An existing output is replaced
only when it is not a symlink and carries the builder's own
`.skill-server-output` marker ([snapshot.ts](../mcp/worker/snapshot.ts#L33)).

The build then writes into a fresh `mkdtemp` staging directory
([snapshot.ts](../mcp/worker/snapshot.ts#L35)). Copying re-hashes each source file
and aborts if size or digest disagrees with the scan
([snapshot.ts](../mcp/worker/snapshot.ts#L56)), so a manifest never describes
bytes the snapshot does not hold. Staging receives `public/skills/<name>/<path>`
with modes preserved ([snapshot.ts](../mcp/worker/snapshot.ts#L57)), one archive
and one pinned manifest per skill
([snapshot.ts](../mcp/worker/snapshot.ts#L60)), the catalog `manifest.json`
([snapshot.ts](../mcp/worker/snapshot.ts#L73)), generated `.md` and `.html`
detail pages ([snapshot.ts](../mcp/worker/snapshot.ts#L88)), `llms.txt` and
`index.json` ([snapshot.ts](../mcp/worker/snapshot.ts#L116)), the landing page,
and `version.json` ([snapshot.ts](../mcp/worker/snapshot.ts#L145)). Only after all
of that does the marker get written, the previous output get renamed aside, and
staging get renamed into place — with the old snapshot restored if the rename
fails ([snapshot.ts](../mcp/worker/snapshot.ts#L155)). Staging is removed in a
`finally` either way ([snapshot.ts](../mcp/worker/snapshot.ts#L164)).

Detail pages are separate assets from resource paths, which is what keeps served
skill files byte-exact ([snapshot.ts](../mcp/worker/snapshot.ts#L81)).

## HTTP representations

`serveHttp` resolves a path to a set of candidate representations, then lets
`Accept` choose among them. The route table is five patterns
([http.ts](../mcp/worker/http.ts#L44)); each format owns its asset selection,
media type and extra headers in one place
([http.ts](../mcp/worker/http.ts#L31)), and the default preference order is HTML,
Markdown, plain text, archive ([http.ts](../mcp/worker/http.ts#L42)). Paths are
decoded segment-by-segment and rejected on separators, dot segments, control
characters or residual `%` ([http.ts](../mcp/worker/http.ts#L52)). Selection runs
through an RFC 9110 media-range implementation where specificity picks each
candidate's quality and candidate order breaks ties
([accept.ts](../mcp/worker/accept.ts#L29),
[accept.ts](../mcp/worker/accept.ts#L50)). Chosen bytes are fetched from the asset
binding with the original method and conditional headers
([http.ts](../mcp/worker/http.ts#L108)), `Vary: Accept` is merged into whatever
the binding returned ([http.ts](../mcp/worker/http.ts#L111)), and successful
responses get `X-Content-Type-Options: nosniff`
([http.ts](../mcp/worker/http.ts#L114)). The full URL table, negotiation rules and
caching behavior are in [worker/HTTP.md](../mcp/worker/HTTP.md); this section does
not restate them.

## Digests and archives

Manifest digests are per-file SHA-256 over the exact bytes read, formatted
`sha256:<64 hex>` and schema-checked in that form
([manifest.ts](../mcp/core/manifest.ts#L122),
[types.ts](../mcp/core/types.ts#L21)).

An archive digest is a different thing: it is the SHA-256 of the finished gzip
bytes, not a hash over the member files
([snapshot.ts](../mcp/worker/snapshot.ts#L66)). Those bytes are reproducible
because the tar is created with `portable: true`, a fixed `mtime` of the epoch and
no directory recursion ([snapshot.ts](../mcp/worker/snapshot.ts#L62)) over a
sorted member list ([snapshot.ts](../mcp/worker/snapshot.ts#L64)), while file
modes survive the copy ([snapshot.ts](../mcp/worker/snapshot.ts#L57)). Two builds
of the same source produce identical archive bytes; the packaged consumer check
asserts exactly that
([consumer-test.mjs](../mcp/scripts/consumer-test.mjs#L29)).

That digest is then the address. Each skill gets
`/downloads/{name}/{sha256}.tgz` and a companion `{sha256}.json` carrying the
archive record and the skill entry
([snapshot.ts](../mcp/worker/snapshot.ts#L67)), and the pinned route serves them
only when the digest matches the current manifest's download record
([http.ts](../mcp/worker/http.ts#L84)). Old digests are not retained: a snapshot
holds the current build only, so a previously published digest URL returns 404
after a rebuild. `/downloads/{name}/skill.tgz` always means the latest build.

## What is bounded, and what is not

| Bound | Value | Where |
| --- | --- | --- |
| HTTP request body | 64 KiB, checked on `Content-Length` and again while streaming, cancelling the reader | [handler.ts](../mcp/worker/handler.ts#L70), [handler.ts](../mcp/worker/handler.ts#L98), [handler.ts](../mcp/worker/handler.ts#L108) |
| MCP handler wall time | 10 s | [handler.ts](../mcp/worker/handler.ts#L143) |
| CLI `serve` request timeout | 15 s | [node-server.ts](../mcp/node-server.ts#L40) |
| Scan directory depth | 64 | [manifest.ts](../mcp/core/manifest.ts#L56) |
| Scan directory entries visited | 1,024 (`MAX_RESOURCES_PER_SKILL * 2`) | [manifest.ts](../mcp/core/manifest.ts#L63) |
| Files per skill | 512, enforced before the file is recorded | [types.ts](../mcp/core/types.ts#L16), [manifest.ts](../mcp/core/manifest.ts#L69) |
| Bytes per skill | 16 MiB, checked against `stat` before allocation and re-checked during the read | [types.ts](../mcp/core/types.ts#L17), [files.ts](../mcp/core/files.ts#L30) |
| Remaining per-skill budget | passed down per file so the scan cannot exceed the total | [manifest.ts](../mcp/core/manifest.ts#L117) |
| `skills/list` page size | 50 entries; resource and directory pages use 200 | [server.ts](../mcp/core/server.ts#L80), [server.ts](../mcp/core/server.ts#L141) |
| Materialize: skills, batch bytes, catalog pages | 256 skills, 256 MiB, 256 pages | [materialize.ts](../mcp/core/materialize.ts#L8), [materialize.ts](../mcp/core/materialize.ts#L9), [materialize.ts](../mcp/materialize.ts#L62) |

The explicit non-guarantees matter as much as the limits.

A digest establishes byte identity, not safe behavior. Both install prompts say
so and ask the consuming agent to inspect before installing
([skill-page.ts](../mcp/worker/skill-page.ts#L12)).

Filesystem staging assumes an operator-owned parent with no concurrent hostile
writers. `checkedPath` rejects nested symlinks and paths that escape the skill
root ([files.ts](../mcp/core/files.ts#L11)), reads open with `O_NOFOLLOW` and
verify inode and device identity across the open
([files.ts](../mcp/core/files.ts#L25)), and materialization walks every existing
ancestor of its destination rejecting symlinks
([materialize.ts](../mcp/core/materialize.ts#L28)). These are portable path checks,
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
([package.json](../mcp/package.json#L34)). Three exports:

| Export | Contents |
| --- | --- |
| `skill-server` | `createSkillsServer`, `SnapshotStore`, store and entry types ([index.ts](../mcp/index.ts#L1)) |
| `skill-server/fs` | `FsStore` ([fs.ts](../mcp/fs.ts#L1)) |
| `skill-server/http` | `buildSnapshot`, `handleRequest`, `serve`, `serveHttp` ([http.ts](../mcp/http.ts#L1)) |

The `skill-server` executable maps to `dist/cli.js` and offers three commands —
`stdio`, `build`, `serve` ([cli.ts](../mcp/cli.ts#L17)).

The tarball carries `dist`, `examples` and `LICENSE` from the `files` allowlist
([package.json](../mcp/package.json#L51)), plus the `README.md` and
`package.json` that npm always includes. The packaged consumer test asserts that
nothing else appears
([test-package.mjs](../mcp/scripts/test-package.mjs#L38)). `dist` is whatever
`tsconfig.package.json` compiles, which is five entry points and their transitive
imports ([tsconfig.package.json](../mcp/tsconfig.package.json#L12)), plus the two
HTML templates and `library.css` copied in afterwards
([build-package.mjs](../mcp/scripts/build-package.mjs#L11)).

Four things stay source-only because nothing in that include list reaches them:
`materialize.ts` and `core/materialize.ts` (the host-side consumption example),
`metrics.ts` (an Analytics Engine query tool), `worker/worker.ts` (the Cloudflare
adapter, and the only file that emits telemetry), and `conformance/`.

## Disposition of the quality review against `d2fd7a8a`

The [quality review](skill-server-quality-review.md) is preserved as historical
evidence; it was written against PR #270 at `81f4189e`. Each row below states
where the candidate commit stands and what was read to say so.

| Review finding | Status | Evidence at `d2fd7a8a` |
| --- | --- | --- |
| P1 — nested symlinks escape a selected skill | Closed | `checkedPath` throws on any symlink component and on a resolved path outside the root ([files.ts](../mcp/core/files.ts#L17), [files.ts](../mcp/core/files.ts#L19)); the scan walk throws on symlinks and special files ([manifest.ts](../mcp/core/manifest.ts#L66)); reads open `O_NOFOLLOW` and compare inode/device across the open ([files.ts](../mcp/core/files.ts#L25)); the build copies through the same checked read ([snapshot.ts](../mcp/worker/snapshot.ts#L55)). Regression tests cover external links, cycles, and a listed file replaced by a symlink ([security.test.ts](../mcp/conformance/security.test.ts#L21), [security.test.ts](../mcp/conformance/security.test.ts#L30)). |
| P1 — parsed JSON cast to a message without envelope validation | Closed | `JSONRPCMessageSchema.safeParse` runs before dispatch and a failure answers 400 ([handler.ts](../mcp/worker/handler.ts#L123)); notifications answer 202 rather than waiting ([handler.ts](../mcp/worker/handler.ts#L139)); the timeout handle is cleared on every exit ([handler.ts](../mcp/worker/handler.ts#L151)). Covered by [security.test.ts](../mcp/conformance/security.test.ts#L110). |
| P1 — no Origin or protocol-version validation | Closed | A present `Origin` must match the request origin or an exact `ALLOWED_ORIGINS` entry, else 403 ([handler.ts](../mcp/worker/handler.ts#L79)); an unsupported `MCP-Protocol-Version` answers 400 ([handler.ts](../mcp/worker/handler.ts#L81)); non-POST answers 405 with `Allow`, the spec-permitted stateless behavior ([handler.ts](../mcp/worker/handler.ts#L82)). `serve` fixes the origin to the bound listener ([node-server.ts](../mcp/node-server.ts#L20)). Covered by [security.test.ts](../mcp/conformance/security.test.ts#L123). |
| P1 — whole body read before length check; scanner budgets checked after traversal | Closed | `Content-Length` is rejected above 64 KiB before reading, and the stream is bounded per chunk with the reader cancelled on overflow ([handler.ts](../mcp/worker/handler.ts#L98), [handler.ts](../mcp/worker/handler.ts#L108)); the walk bounds depth and visited entries during traversal ([manifest.ts](../mcp/core/manifest.ts#L56), [manifest.ts](../mcp/core/manifest.ts#L63)); the file limit is checked before the path is recorded ([manifest.ts](../mcp/core/manifest.ts#L69)); size is checked against `stat` before allocation and the remaining budget is passed per file ([files.ts](../mcp/core/files.ts#L30), [manifest.ts](../mcp/core/manifest.ts#L117)). Covered by [security.test.ts](../mcp/conformance/security.test.ts#L49), [security.test.ts](../mcp/conformance/security.test.ts#L116). |
| P1 — output deleted before validation; representations derived at different times | Closed | Every overlap check, including against each resolved skill directory, runs before any directory is created ([snapshot.ts](../mcp/worker/snapshot.ts#L27), [snapshot.ts](../mcp/worker/snapshot.ts#L30)); replacement requires the `.skill-server-output` marker ([snapshot.ts](../mcp/worker/snapshot.ts#L33)); the build stages, re-verifies each file against the scan ([snapshot.ts](../mcp/worker/snapshot.ts#L56)), and swaps with a restorable rename ([snapshot.ts](../mcp/worker/snapshot.ts#L155)). Covered by [security.test.ts](../mcp/conformance/security.test.ts#L55), [security.test.ts](../mcp/conformance/security.test.ts#L64), [security.test.ts](../mcp/conformance/security.test.ts#L79). |
| P1 — generated instructions embed the original service origin | Partially | The publisher origin is an explicit, validated build input threaded through pages, prompts, JSON discovery and the MCP endpoint line ([snapshot.ts](../mcp/worker/snapshot.ts#L16), [snapshot.ts](../mcp/worker/snapshot.ts#L88), [snapshot.ts](../mcp/worker/snapshot.ts#L101)), the landing template's literal origin is substituted ([snapshot.ts](../mcp/worker/snapshot.ts#L137)), and a second-origin build is asserted ([security.test.ts](../mcp/conformance/security.test.ts#L93), [consumer-test.mjs](../mcp/scripts/consumer-test.mjs#L30)). Two residues remain: `skill-page.ts` still defaults `origin` to `https://skills.cloudcompute.com` for library callers that omit it ([skill-page.ts](../mcp/worker/skill-page.ts#L14)), and generated `llms.txt` hardcodes this repository as the implementation source ([snapshot.ts](../mcp/worker/snapshot.ts#L103)). Neither is reachable through `buildSnapshot`, which always passes an origin. |
| Conditional blocker — `materialize.ts` joins resource-derived paths | Closed, and still out of the package | Namespaces, portable paths, path collisions, dynamic manifests and a missing `SKILL.md` are all validated before any fetch ([materialize.ts](../mcp/core/materialize.ts#L41), [materialize.ts](../mcp/core/materialize.ts#L19), [materialize.ts](../mcp/core/materialize.ts#L60), [materialize.ts](../mcp/core/materialize.ts#L67)); every existing destination ancestor is checked for symlinks ([materialize.ts](../mcp/core/materialize.ts#L77)); writes go to a fresh `mkdtemp` staging as `0600`/`0700` with `wx`, and only a complete verified batch is renamed into place ([materialize.ts](../mcp/core/materialize.ts#L104), [materialize.ts](../mcp/core/materialize.ts#L107)). It stays outside the public CLI: `tsconfig.package.json` does not compile it ([tsconfig.package.json](../mcp/tsconfig.package.json#L12)). |

The review's follow-up paragraph is also closed. The package now has compiled
exports, a CLI mapping, a version, a file allowlist and clean-install tests
([package.json](../mcp/package.json#L31),
[test-package.mjs](../mcp/scripts/test-package.mjs#L38)); analytics are confined
to the deployment adapter ([worker.ts](../mcp/worker/worker.ts#L43)); archive
metadata is normalized before any reproducibility claim
([snapshot.ts](../mcp/worker/snapshot.ts#L62)); and skill-name validation happens
in the scanner, so stdio and hosted builds reject the same names
([manifest.ts](../mcp/core/manifest.ts#L93)). One residue: the same name regex is
written out separately in the scanner, the page generator, the HTTP resolver and
the materializer ([skill-page.ts](../mcp/worker/skill-page.ts#L7),
[http.ts](../mcp/worker/http.ts#L94),
[materialize.ts](../mcp/core/materialize.ts#L41)) rather than shared from one
place.
