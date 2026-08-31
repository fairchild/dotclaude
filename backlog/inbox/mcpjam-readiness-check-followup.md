---
priority: 3
timeout: 3d
---

# Run the MCPJam OpenAI-readiness profile against skills.cloudcompute.com/mcp

MCPJam's inspector ships the only executable form of a production importer's
skills constraints: an "OpenAI-readiness profile" encoding what ChatGPT's
plugin submission flow requires of a skills-over-MCP server (capability
declared, `skills/list` + `skills/get`, hex SHA-256 per resource, 256 KiB
SKILL.md / 5 MiB per-skill caps, ≤5 skills per submission). Running our
hosted endpoint through it is independent third-party verification and a
strong line for the SEP-2640 working-group thread.

## Scope

1. Install/run the MCPJam inspector (https://github.com/MCPJam/inspector) and
   point it at `https://skills.cloudcompute.com/mcp` (Streamable HTTP,
   stateless, no auth). Exercise its skills surface and server-doctor.
2. Run the OpenAI-readiness profile
   (`sdk/src/openai-readiness/profile.ts` in their repo) against the endpoint.
3. Expected friction to investigate, not paper over: the profile caps at 5
   skills per submission and our server lists 35. Determine whether the check
   is per-selected-subset (likely, since it models a plugin submission) or a
   hard server-wide fail, and record what a 35-skill catalog means for
   OpenAI-style importers.
4. Record results in `mcp/README.md` (a short "verified against" line) if
   clean, or file findings as fixes if not. Any real defect found gets a
   regression test in `mcp/conformance/`.

## Verification

- Inspector connects, lists skills, digest checks pass through their client.
- Readiness profile output captured verbatim in the PR body.
- `mise run mcp:test` still green if server changes were needed.

Outcome: merge-ready PR (README line and/or fixes + tests), with the
inspector output as evidence.

---
