# skill-server

skill-server is an independent implementation of the
[Skills over MCP extension](https://github.com/modelcontextprotocol/ext-skills),
which lets an MCP (Model Context Protocol) server offer agent skills to hosts.
A skill — a directory with a `SKILL.md`, per the
[Agent Skills spec](https://agentskills.io/specification) — is exposed as one
resource per file under `skill://<name>/<path>`, listed with a manifest of every
file's SHA-256 digest and size. skill-server serves a skills directory over stdio,
or builds it into a static snapshot that it serves over stateless HTTP.

GitHub candidates contain a Node CLI, importable modules, and snapshot templates.
This is not an official MCP specification implementation endorsement. The source
checkout also includes the Cloudflare adapter for skills.cloudcompute.com.

## Connect

The hosted binding is live at `https://skills.cloudcompute.com/mcp`
(portable tier, public). It is a Cloudflare Worker serving a build-time snapshot
of the portable tier over stateless Streamable HTTP, to clients on protocol
revision 2026-07-28 and to 2025-era clients alike (see
[Protocol revisions](#protocol-revisions)). Claude Code or any MCP host
connects to either the hosted binding or the local stdio binding:

```json
{
  "mcpServers": {
    "dotclaude-skills-local": { "command": "bun", "args": ["<repo>/mcp/stdio.ts"] },
    "dotclaude-skills": {
      "type": "http",
      "url": "https://skills.cloudcompute.com/mcp",
      "headers": { "x-skills-client": "<your-label>" }
    }
  }
}
```

`x-skills-client` is optional; it labels your traffic in the usage metrics.

The root of that domain is a landing page built from the snapshot
(`worker/index.html` + build.ts). The homepage links to canonical skill
directories at `/skills/<name>/`, with file lists and a short copyable install
prompt. A filter above the list narrows it as you type — Tab reaches the best
match, Enter opens it, and Enter again copies that skill's install prompt; the
field hides itself when scripting is unavailable, leaving the plain list.
`/llms.txt` supplies the Markdown catalog; Markdown directory pages retain
navigation and install information. Raw files remain under
`/skills/<name>/<path>`.

The default prompt pins a complete archive and its manifest by the archive
SHA-256. A separate full inline prompt carries SKILL.md for offline use. Both
prompts name `~/.claude/skills/<name>` for Claude Code and `~/.agents/skills/<name>`
for Codex and other agents that follow that convention. Skill pages and Markdown
directories also carry a shell command that downloads the pinned archive, checks
its SHA-256, refuses to replace an existing install, and extracts into
`~/.claude/skills`. Archives preserve paths, bytes, and file permissions;
historical package retention is not provided.

For HTTP download routes, supported formats, and `Accept` negotiation, see
[Skill HTTP downloads](worker/HTTP.md).

## Install a GitHub candidate

Download the `.tgz` from a published `skill-server-v<VERSION>` GitHub prerelease,
then install it in a fresh project directory. Installing into an empty directory
also creates `package.json` and `package-lock.json` there, since `npm install`
scaffolds a project when none exists yet. `stdio` and `build` serve a skills
directory, so create `./my-skills/<name>/SKILL.md` first, with frontmatter
`name` matching the directory name and a `description` set, per the
[Agent Skills spec](https://agentskills.io/specification). The smallest
valid `./my-skills/hello/SKILL.md`:

```markdown
---
name: hello
description: Reply with a one-line greeting; a smoke test for skill-server.
---

When asked to say hello, answer with a single friendly sentence.
```

Then, in the project directory:

```sh
npm install ./skill-server-0.1.0-rc.1.tgz
npx --no-install skill-server --help
npx --no-install skill-server stdio --root ./my-skills
npx --no-install skill-server build --root ./my-skills --out ./snapshot --base-url http://127.0.0.1:3000
npx --no-install skill-server serve --snapshot ./snapshot --port 3000
```

The filename is the initial candidate version, not a claim that a release already
exists. Requires Node 22.14+; CI checks Node 22.14.0 and current Node 22/24.
PRs qualify Linux/macOS; main and releases also qualify Windows. Dependencies download
from npm, but this package is distributed through GitHub only. No Bun, TypeScript
compiler, system tar, or consumer installation script is required. `stdio` and
`build` require `--root`; `serve` requires `--snapshot` and defaults to
`127.0.0.1:3000`, overridable with `--host`/`--port`. HTTP listens on loopback
by default; authentication and reverse proxy configuration are the operator's
responsibility for external exposure. On startup, `serve` writes one JSON line
to stderr — `Listening on {"address":"127.0.0.1","family":"IPv4","port":3000}`
— and stdout stays empty, which a wrapper can use as the readiness signal.
`build`'s output `index.json` carries a `specification` field pointing at the
[ext-skills repository](https://github.com/modelcontextprotocol/ext-skills), the
MCP wire protocol for this extension — a different document from the Agent
Skills spec linked above, which is the skill-directory format.

Imports do not scan a directory, listen on a port, or send telemetry:

```js
import { createSkillsServer } from 'skill-server';
import { FsStore } from 'skill-server/fs';
import { buildSnapshot, handleRequest } from 'skill-server/http';
```

`createSkillsServer(store)` returns an MCP SDK server for a transport supplied by
the caller. `buildSnapshot({root, out, baseUrl})` creates a portable snapshot.
`handleRequest(request, {ASSETS})` accepts a Fetch-compatible asset provider for
the stateless HTTP binding. The hosting adapter alone supplies usage telemetry.

Build output must be a fresh directory or a previously managed snapshot.

Symlink policy, as implemented: a top-level skill directory may itself be a
symlink — it is resolved to its real path at scan time and served normally
from there (`core/manifest.ts` `scanSkill`, via `realpathSync`). A symlink
found anywhere nested inside a skill's directory tree is rejected outright
during the scan walk, so the walk never follows one and a symlink loop cannot
be traversed through it (`core/manifest.ts` `walkFiles`); directory recursion
is additionally capped at depth 64 and 1,024 entries as a backstop against
pathological trees. A file that is swapped for a symlink after scanning fails
closed on the next read: reads reject a symlinked path segment and also open
the file with `O_NOFOLLOW` (`core/files.ts` `checkedPath`, `readSkillFile`).
Build output is checked against the resolved, real path of every skill root —
not just its symlinked entry point — so output cannot overlap a linked root
either (`worker/snapshot.ts` `buildSnapshot`).

Imports and scans never execute skill scripts. Archives preserve file modes
with fixed timestamps and sorted members. Operators must retain old snapshots
themselves if historical digest URLs need to remain available.

The GitHub release includes a SHA-256 checksum, source record and build
attestation. Verify a downloaded artifact with:

```sh
gh attestation verify skill-server-0.1.0-rc.1.tgz --repo fairchild/dotclaude
```

## CLI contract

`skill-server` has three commands. `--help` and `--version` print and exit 0
without touching the filesystem; a missing required flag exits 1 naming it.

- `stdio --root <dir> [--strict]` — serve `<dir>` over stdio.
- `build --root <dir> --out <output> --base-url <origin> [--strict]` — write
  a portable snapshot.
- `serve --snapshot <output> [--host 127.0.0.1] [--port 3000]` — serve a
  built snapshot over HTTP.

Scanning a directory under `--root` never executes a skill's scripts: only
`SKILL.md` is parsed and files are read to compute digests.

A non-hidden directory under `--root` that is not a valid skill — no
readable `SKILL.md`, no YAML frontmatter, a missing `name`/`description`, a
frontmatter `name` that does not match the directory name, an unsafe
directory name, or a skill that exceeds the SEP's per-skill limits — prints
one diagnostic line to stderr:

```
[skills] skipped <dir>: <reason>
```

Hidden (dot-prefixed) directories and the fixed exclusion set
(`node_modules`, `__pycache__`, `.git`, `.venv`) are never scanned and never
produce a diagnostic; they are not candidate skills at all.

Without `--strict`, a diagnostic is informational: `stdio` still serves
every valid skill it found, and `build` still writes the snapshot; both
exit 0. With `--strict`, any diagnostic is fatal: `stdio` exits 1 before
opening its transport, and `build` exits 1 before writing anything to
`--out` (no output directory is created). Diagnostics are printed to
stderr the same way either way.

## Run

From a source checkout, the Bun entry points serve without a package build:

```bash
bun stdio.ts                  # serve ~/.claude/skills
bun stdio.ts --root ../skills # serve the repo corpus
bun run test                  # conformance + corpus + worker integration
```

`stdio.ts` serves the live skills directory (default `~/.claude/skills`) —
first-party, local, and ecosystem skills alike; `--portable-only` narrows to the
portable tier.

For a local source snapshot without deployment, run `bun worker/build.ts`.
To see the full site output on a small corpus, build the conformance fixtures:
`bun worker/build.ts --root conformance/fixtures --out /tmp/skills-demo`.
The build skips `bad-name` with a diagnostic and excludes the machine-bound
`bound-skill`, so the snapshot holds the two portable fixtures.

## Serving tiers

`scripts/portability.py` (repo root) gates what may be served where:
portable skills (the default tier, verified by lint) are meaningful on any
machine with their stated prerequisites; skills declaring
`metadata.portability: machine-bound` are served only by this local binding.
See `docs/skill-portability.md`.

Every skill entry states its tier in `_meta`, so a host can tell what runs
anywhere, a cloud sandbox included, from what assumes the author's machine:

```json
{ "uri": "skill://claude-as/SKILL.md", "_meta": { "com.cloudcompute.skills/portability": "machine-bound" }, … }
```

The value is `portable` or `machine-bound`, this server's statement derived
from frontmatter `metadata.portability`. The key carries this project's own
prefix; `io.modelcontextprotocol.skills/` is reserved for keys the extension
defines. The hosted binding lists only `portable` entries; stdio lists both
unless started with `--portable-only`.

## Developing in this repository

Source development uses Bun 1.4 or newer; archive creation uses the installed
`tar` package, not a system executable.

```sh
cd mcp
bun install --frozen-lockfile
bun run typecheck
bun test conformance
bun run build:package
PACKAGE_OUTPUT_DIR=out bun run test:package
node scripts/prepare-worker.mjs out/skill-server-0.1.0-rc.1.tgz
node scripts/check-worker.mjs
```

The last two commands install the package into an isolated Worker consumer,
bundle the deployment adapter, and verify the real local Cloudflare runtime.
They replace source-only verification as the hosted release acceptance check.

Run `bun run typecheck`, `bun run build`, and `bun run test` to verify source
changes, `bun run test` in `mcp/e2e` for the browser flow, and the package
verification commands above before deployment. `mcp/e2e/` records the
homepage filter flow in Chromium against a real Worker.

Production deploys automatically from main through CI, using the package-backed
Worker artifact that passed verification. For recovery, manually run CI on main;
see [GitHub Actions and releases](../docs/github-actions.md#recovery).

## Protocol and source layout

Reference server for the MCP Skills Extension
([SEP-2640](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2640),
extension id `io.modelcontextprotocol/skills`), serving this repo's skills as
the corpus. Built on the TypeScript SDK v2 (`@modelcontextprotocol/server`
2.4.0): the extension's three methods are custom request handlers on the
SDK's `Server`, and everything else rides the base Resources primitive.

**Upstream pin** (recheck and bump at each release candidate): checked
against the extension specification
[`specification/beta/skills.mdx`](https://github.com/modelcontextprotocol/ext-skills/blob/c0705f9071caa539eeb2c9f5f2f77ac16b048ca6/specification/beta/skills.mdx)
at ext-skills commit
[`c0705f9`](https://github.com/modelcontextprotocol/ext-skills/commit/c0705f9071caa539eeb2c9f5f2f77ac16b048ca6)
(the repository carries no tags or releases), with its JSON Schema vendored in
[`conformance/schema/`](conformance/schema/), and
[SEP-2640](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2640)
as merged Final at
[`1eb5bbe`](https://github.com/modelcontextprotocol/modelcontextprotocol/commit/1eb5bbe8).
Skills served here are Agent Skills directories; any frontmatter field the
author wrote passes through `frontmatter` unchanged.

`skills/get` also answers for a skill that never appears in a listing, and it
is the refresh path after a digest mismatch. Reading a file is plain
`resources/read`; reading a `SKILL.md` does not activate anything — activation,
approval, and origin-tagging are host concerns, and the SEP's security section
makes them explicit.

See the [architecture walkthrough](../docs/skill-server-architecture.md) for
how the store boundary, transports, and build pipeline fit together, and
[SECURITY.md](../SECURITY.md) to report a vulnerability.

### Protocol revisions

One endpoint serves two protocol eras. A request whose `params._meta`
carries `io.modelcontextprotocol/protocolVersion` is a 2026-07-28 request;
anything else is 2025-era (`initialize`, `2025-11-25` and earlier).

- **2026-07-28.** No `initialize` and no session: `server/discover` reports
  the supported revision and capabilities, and every request carries its own
  envelope. Over HTTP the SDK's modern handler answers. It requires the
  `MCP-Protocol-Version` and `Mcp-Method` headers to match the body (plus
  `Mcp-Name` on `resources/read`): a missing or mismatched header is `400`
  with `-32020`, a malformed envelope `400` with `-32602`, an unsupported
  revision `400` with `-32022`, and an unknown method `404` with `-32601`.
  Every result carries `resultType: "complete"`, the server's identity in
  `_meta["io.modelcontextprotocol/serverInfo"]`, and the cache fields below.
- **2025-era.** Answered as before the 2026 revision existed: one JSON-RPC
  message per POST through a fresh server on a one-shot transport, no cache
  fields, and `Accept: application/json` alone is enough.

Both eras pass the same gates first: an `Origin` outside the allow-list is
`403`, a non-POST is `405`, a body over 64 KiB is `413`, a non-JSON
`Content-Type` is `415`, and an `Accept` without `application/json` is `406`.
These rejections echo the request's JSON-RPC `id` when the body parses.
Over stdio, the SDK's `serveStdio` pins one era per connection from its
opening message, so a 2025 client's `initialize` still works.

Cache fields (`ttlMs`, `cacheScope`, SEP-2549) on 2026-07-28 results:

| Binding | `ttlMs` | `cacheScope` | Why |
| --- | --- | --- | --- |
| Hosted snapshot (Worker, `cli.ts serve`) | `300000` | `public` | A snapshot is immutable per deployment and the same for every client |
| stdio (live directory) | `0` | `private` | Files can change between calls |

### Supported methods and limitations

| Method | Capability flag | Transports | Pagination | Per-skill limits | Notes |
| --- | --- | --- | --- | --- | --- |
| `skills/list` | `io.modelcontextprotocol/skills` (required) | stdio, stateless HTTP | Cursor (base64url index), 50/page; an entry is never split across a page | 512 resources, 16 MiB total | `resultType: "complete"`; cache fields on 2026-07-28; portability in each entry's `_meta` |
| `skills/get` | `io.modelcontextprotocol/skills` (required) | stdio, stateless HTTP | None | Same | stdio rescans the one skill on every call; the HTTP snapshot's refresh is identity (a deploy is the refresh point); `-32602` for an unknown URI; cache fields on 2026-07-28 |
| `resources/directory/read` | `directoryRead: true` (optional) | stdio, stateless HTTP | Cursor, 200 children/page | Manifest-derived only, no live `readdir` | `-32602` for an unknown or non-directory URI; cache fields on 2026-07-28 |
| `resources/list` | base `resources` capability | stdio, stateless HTTP | Cursor, 200 entries/page | Same per-skill limits | Flattened across every served skill; a `SKILL.md` is named for its skill |
| `resources/read` | base `resources` capability | stdio, stateless HTTP | None | 16 MiB per skill (scan time) | Text/blob split by extension; `-32602` for an unknown resource (requested URI in `error.data.uri`) or a directory read attempted here |
| `server/discover` | none (2026-07-28 only) | stdio, stateless HTTP | None | None | Answered by the SDK from the declared capabilities |

Every method over the stateless HTTP binding shares one 64 KiB cap on the
streamed POST body; oversized requests receive 413 before dispatch.

Not implemented: `subscriptions/listen` and resource change notifications
(the server declares a bare `resources: {}` capability; a deploy or restart
is the change point), `resources/templates/list`, `resources: "dynamic"`
skills (the wire type is defined but no store here produces one), nested
skills as separate `skills/list` entries (a nested `SKILL.md` is served as an
ordinary supporting file of its enclosing skill), `_meta` on individual
skill resources, and any URI scheme other than `skill://`. The stateless HTTP
binding also has no SSE stream, no sessions, and no authentication: a
non-`POST` request to `/mcp` gets a plain `405` with `Allow: POST`.

**Upstream conformance.** The
[MCP conformance suite](https://github.com/modelcontextprotocol/conformance)
(checked at `96a6f947`) runs against `cli.ts serve` with
`--spec-version 2026-07-28`; the Skills scenarios are opt-in and need
`--force`. `sep-2640-skills-enumeration`, `-manifest` and `-directory` pass
with no warnings, as do `sep-2164-resource-not-found`, `resources-list` and
`dns-rebinding-protection`. The checks that fail in `server-stateless`,
`caching`, `resources-read-text` and `http-header-validation` call the
suite's fixture tools and resources (`test_*` tools, `test://` resources,
`tools/list`, `prompts/list`, `resources/templates/list`), which a
resources-only skills server does not serve.

**MCPJam.** Against the same local snapshot, the
[MCPJam CLI](https://www.npmjs.com/package/@mcpjam/cli) 6.4.4 negotiates
2026-07-28, `server doctor` reports `ready`, and `skills get` verifies all 46
skills against their manifests. Its OpenAI readiness profile
(`readiness check openai --submission-mode mcp-imported-skills`) grades the
whole catalog as one submission: it accepts the extension declaration and the
paginated listing, and reports the importer's caps (at most 5 skills, at most
10 supporting files per skill) as unmet for this 46-skill corpus. Those caps
describe what one ChatGPT plugin may import, not the protocol.

### Source layout

- `core/manifest.ts` — scan a skills directory into entries: frontmatter
  (name must equal the directory name), SHA-256 digests, SEP limits;
  malformed or oversize skills become diagnostics, not malformed entries.
- `core/server.ts` — the SDK server: the three methods plus
  `resources/list`/`resources/read`, pagination, `-32602` semantics, and the
  2026-07-28 cache fields.
- `worker/handler.ts` — the HTTP binding: shared gates, then the SDK's
  modern handler for 2026-07-28 requests and the one-shot path for 2025-era
  ones.
- `stdio.ts` — local binding over the live skills directory; see [Run](#run).
- `conformance/` — the suite doubles as an executable reading of the SEP:
  entry completeness, digest/frontmatter identity, pagination atomicity,
  directory semantics, error codes, end-to-end stdio, both protocol eras
  (`modern.test.ts`), and the beta JSON Schema (`schema.test.ts`).

## Usage metrics

Every request the worker serves writes one datapoint to the
`skills_mcp_usage` Analytics Engine dataset: method, skill, outcome,
client label, user agent, country, colo, latency, and response bytes — no
raw IPs. `bun metrics.ts` renders a summary (needs
`CLOUDFLARE_ACCOUNT_ID` and a `CLOUDFLARE_API_TOKEN` with Account
Analytics read; the script header has details). Worker-level request and
error metrics also appear in the Cloudflare dashboard under the
`dotclaude-skills` worker, and `./node_modules/.bin/wrangler tail -c worker/wrangler.toml`
streams live invocations.

## Verified materialization example

From `mcp/`, fetch a local server's manifest-listed files into a new directory:

```sh
bun materialize.ts --root ./conformance/fixtures --out ./reviewed-skills
```

The output must not exist. Its parent must already exist, contain no symlink
ancestors, and be owned by the operator with no concurrent writers. On macOS,
use a physical path such as `/private/tmp` rather than the `/tmp` symlink.
Replacement and merging are deliberately unsupported. A failed read or verification
removes the staging directory and leaves the requested output absent.

The example validates skill namespaces and portable relative paths before fetching.
It rejects traversal, encoded paths, duplicate or colliding files, Windows device
names, dynamic manifests, and manifests missing `SKILL.md`. It checks response URIs,
byte lengths, and SHA-256 digests before writing each file into private staging.
Only the complete batch becomes the output directory. Files have mode `0600` and
directories `0700`; reviewing and enabling executable scripts is a separate action.

Limits are 256 catalog pages, 256 skills total, the per-skill limits in the
[supported-methods table](#supported-methods-and-limitations) above (512
files, 16 MiB), and 256 MiB per selected batch. These checks bound accepted
content, not the SDK's allocation of an incoming stdio message. The example
starts a local server and is not a general-purpose transport for hostile
remote servers.

Digest verification proves that bytes match a manifest, not that either is safe.
Inspect files for prompt injection, credential access, telemetry, unexpected
outbound data, and destructive commands before allowing an agent to use them.
Scanning, downloading, and writing files never executes their scripts.
