# skill-server

An independent implementation of the experimental Skills over MCP extension.
GitHub candidates contain a Node CLI, importable modules, and snapshot templates.
This is not an official MCP specification implementation endorsement. The source
checkout also includes the Cloudflare adapter for skills.cloudcompute.com.

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

## Developing in this repository

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

## Protocol and source layout

Reference server for the MCP Skills Extension
([SEP-2640](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2640),
extension id `io.modelcontextprotocol/skills`), serving this repo's skills as
the corpus. Built on the stock TypeScript SDK: the extension's three methods
are ordinary custom request handlers, and everything else rides the base
Resources primitive.

**Upstream pin** (recheck and bump at each release candidate): checked
against ext-skills commit
[`f1f8605`](https://github.com/modelcontextprotocol/ext-skills/commit/f1f8605b72274e8ab667b72194103fe8096e9552)
(2026-09-04, the commit that added `specification/stable/skills.mdx`; the
repository carries no tags or releases) and
[SEP-2640](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2640)
head
[`d6b31a0`](https://github.com/modelcontextprotocol/modelcontextprotocol/commit/d6b31a03504c15677d49b922b6b6ace0ef65728d)
(2026-09-03, PR still open). Extension id `io.modelcontextprotocol/skills`.

See the [architecture walkthrough](../docs/skill-server-architecture.md) for
how the store boundary, transports, and build pipeline fit together, and
[SECURITY.md](../SECURITY.md) to report a vulnerability.

## What the extension is

A skill — a directory with a `SKILL.md`, per the
[Agent Skills spec](https://agentskills.io/specification) — is exposed as one
resource per file under `skill://<name>/<path>`. `skills/get` also answers
for a skill that never appears in a listing, and it is the refresh path after
a digest mismatch. Reading a file is plain `resources/read`; reading a
`SKILL.md` does not activate anything — activation, approval, and
origin-tagging are host concerns, and the SEP's security section makes them
explicit.

### Supported methods and limitations

| Method | Capability flag | Transports | Pagination | Per-skill limits | Notes |
| --- | --- | --- | --- | --- | --- |
| `skills/list` | `io.modelcontextprotocol/skills` (required) | stdio, stateless HTTP | Cursor (base64url index), 50/page; an entry is never split across a page | 512 resources, 16 MiB total | `resultType: "complete"`; no `ttlMs`/`cacheScope` |
| `skills/get` | `io.modelcontextprotocol/skills` (required) | stdio, stateless HTTP | None | Same | stdio rescans the one skill on every call; the HTTP snapshot's refresh is identity (a deploy is the refresh point); `-32602` for an unknown URI |
| `resources/directory/read` | `directoryRead: true` (optional) | stdio, stateless HTTP | Cursor, 200 children/page | Manifest-derived only, no live `readdir` | `-32602` for an unknown or non-directory URI |
| `resources/list` | base `resources` capability | stdio, stateless HTTP | Cursor, 200 entries/page | Same per-skill limits | Flattened across every served skill |
| `resources/read` | base `resources` capability | stdio, stateless HTTP | None | 16 MiB per skill (scan time) | Text/blob split by extension; `-32602` for an unknown resource or a directory read attempted here |

Every method over the stateless HTTP binding shares one 64 KiB cap on the
streamed POST body; oversized requests receive 413 before dispatch.

Not implemented: resource subscriptions and `listChanged` (the server
declares a bare `resources: {}` capability), `resources/templates/list`, the
`ttlMs`/`cacheScope` list-caching hints, `resources: "dynamic"` skills (the
wire type is defined but no store here produces one), nested skills as
separate `skills/list` entries (a nested `SKILL.md` is served as an ordinary
supporting file of its enclosing skill), `_meta` provenance annotations on
skill resources, and any URI scheme other than `skill://`. The stateless HTTP
binding also has no SSE GET stream, no sessions, and no authentication: a
non-`POST` request to `/mcp` gets a plain `405` with `Allow: POST`, and every
`POST` runs one JSON-RPC message through a fresh server on a one-shot
transport.

For HTTP download routes, supported formats, and `Accept` negotiation, see
[Skill HTTP downloads](worker/HTTP.md).

## Layout

- `core/manifest.ts` — scan a skills directory into entries: frontmatter
  (name must equal the directory name), SHA-256 digests, SEP limits;
  malformed or oversize skills become diagnostics, not malformed entries.
- `core/server.ts` — the SDK server: the three methods plus
  `resources/list`/`resources/read`, pagination, `-32602` semantics.
- `stdio.ts` — local binding. Serves the live skills directory (default
  `~/.claude/skills`) — first-party, local, and ecosystem skills alike;
  `--portable-only` narrows to the portable tier.
- `conformance/` — the suite doubles as an executable reading of the SEP:
  entry completeness, digest/frontmatter identity, pagination atomicity,
  directory semantics, error codes, end-to-end stdio.

## Serving tiers

`scripts/portability.py` (repo root) gates what may be served where:
portable skills (the default tier, verified by lint) are meaningful on any
machine with their stated prerequisites; skills declaring
`metadata.portability: machine-bound` are served only by this local binding.
See `docs/skill-portability.md`.

## Run

```bash
bun stdio.ts                  # serve ~/.claude/skills
bun stdio.ts --root ../skills # serve the repo corpus
bun run test                  # conformance + corpus + worker integration
```

The hosted binding is a Cloudflare Worker serving a build-time snapshot of
the portable tier over stateless Streamable HTTP (each POST runs one
JSON-RPC message through a fresh server on a one-shot transport):

Production deploys automatically from main through CI, using the package-backed
Worker artifact that passed verification. For recovery, manually run CI on main;
see [GitHub Actions and releases](../docs/github-actions.md#recovery).
For a local source snapshot without deployment, run `bun worker/build.ts`.

## Connect

The hosted binding is live at `https://skills.cloudcompute.com/mcp`
(portable tier, public). The root of that domain is a landing page built
from the snapshot (`worker/index.html` + build.ts). The homepage links to canonical skill directories at `/skills/<name>/`, with file lists and a short copyable install prompt. `/llms.txt` supplies the Markdown catalog; Markdown directory pages retain navigation and install information. Raw files remain under `/skills/<name>/<path>`. The default prompt pins a complete archive and its manifest by the archive SHA-256. A separate full inline prompt carries SKILL.md for offline use. Archives preserve paths, bytes, and file permissions; historical package retention is not provided. Source development uses Bun 1.4 or newer; archive creation uses the installed `tar` package, not a system executable. Run `bun run typecheck`, `bun run build`, and `bun run test` to verify source changes, and the package verification commands above before deployment. Claude Code or any MCP host connects to either binding:

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
