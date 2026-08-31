# Skills over MCP

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

```bash
bun worker/build.ts                            # snapshot ../skills -> worker/dist/public
bunx wrangler deploy -c worker/wrangler.toml   # publish (POST /mcp)
```

## Connect

The hosted binding is live at `https://skills.cloudcompute.com/mcp`
(portable tier, public). The root of that domain is a landing page built
from the snapshot (`worker/index.html` + build.ts). Claude Code — or any MCP host — connects to either binding:

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
