# skill-server

An independent implementation of the experimental Skills over MCP extension.
GitHub candidates contain a Node CLI, importable modules, and snapshot templates.
This is not an official MCP specification implementation endorsement. The source
checkout also includes the Cloudflare adapter for skills.cloudcompute.com.

## Install a GitHub candidate

Download the `.tgz` from a published `skill-server-v<VERSION>` GitHub prerelease,
then install it in a fresh project directory:

```sh
npm install ./skill-server-0.1.0-rc.1.tgz
npx --no-install skill-server --help
npx --no-install skill-server stdio --root ./my-skills
npx --no-install skill-server build --root ./my-skills --out ./snapshot --base-url http://127.0.0.1:3000
npx --no-install skill-server serve --snapshot ./snapshot
```

The filename is the initial candidate version, not a claim that a release already
exists. Requires Node 22.14+; CI qualifies Node 22 and 24. Dependencies download
from npm, but this package is distributed through GitHub only. No Bun, TypeScript
compiler, system tar, or consumer installation script is required. `--root` is
mandatory. HTTP listens on loopback by default; authentication and reverse proxy
configuration are the operator's responsibility for external exposure.

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

Build output must be a fresh directory or a previously managed snapshot. Nested
symlinks are rejected; selected top-level skill links remain supported. Imports
and scans never execute skill scripts. Archives preserve file modes with fixed
timestamps and sorted members. Operators must retain old snapshots themselves
if historical digest URLs need to remain available.

The GitHub release includes a SHA-256 checksum, source record and build
attestation. Verify a downloaded artifact with:

```sh
gh attestation verify skill-server-0.1.0-rc.1.tgz --repo fairchild/dotclaude
```

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

## What the extension is

A skill — a directory with a `SKILL.md`, per the
[Agent Skills spec](https://agentskills.io/specification) — is exposed as one
resource per file under `skill://<name>/<path>`. Three methods carry the
skill-shaped view:

- `skills/list` — every served skill as a complete entry: verbatim
  frontmatter plus `{uri, digest, size}` for every file. Hosts build their
  registry, bind approvals, and verify each later read against this manifest.
- `skills/get` — one skill's entry by its `SKILL.md` URI; the refresh path
  after a digest mismatch, and the way an unlisted skill enters a registry.
- `resources/directory/read` (optional, declared via `directoryRead: true`) —
  direct children of a directory resource, for scoped navigation.

For HTTP download routes, supported formats, and `Accept` negotiation, see
[Skill HTTP downloads](worker/HTTP.md).

Reading a file is plain `resources/read`; reading a `SKILL.md` does not
activate anything — activation, approval, and origin-tagging are host
concerns, and the SEP's security section makes them explicit.

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
`dotclaude-skills` worker, and `bunx wrangler tail -c worker/wrangler.toml`
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

Limits are 256 catalog pages, 256 skills, 512 files and 16 MiB per skill, and
256 MiB per selected batch. These checks bound accepted content, not the SDK's
allocation of an incoming stdio message. The example starts a local server and
is not a general-purpose transport for hostile remote servers.

Digest verification proves that bytes match a manifest, not that either is safe.
Inspect files for prompt injection, credential access, telemetry, unexpected
outbound data, and destructive commands before allowing an agent to use them.
Scanning, downloading, and writing files never executes their scripts.
