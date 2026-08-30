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
bun test                      # conformance + corpus integration
```

Claude Code (or any MCP host) connects via:

```json
{ "mcpServers": { "dotclaude-skills": { "command": "bun", "args": ["<repo>/mcp/stdio.ts"] } } }
```
