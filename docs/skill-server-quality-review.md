# Skill server quality review

Reviewed 2026-09-05 against PR #270, merged as `81f4189e63edc4d34ac4d463889808782694a3a6`. An independent subagent reviewed the implementation read-only. The primary agent inspected the reported code and independently reproduced the external symlink, null request, oversized UTF-8 request, and unsupported protocol-version cases.

Recommendation: fix the release blockers before publishing this code as a reference package. The store/handler separation is worth keeping. Most required work belongs at the filesystem, HTTP, build, and deployment boundaries.

## Release blockers

| Priority | Finding and evidence | Required outcome |
| --- | --- | --- |
| P1 | Nested symlinks escape a selected skill. [manifest.ts](../mcp/core/manifest.ts#L51) follows links recursively, [fs-store.ts](../mcp/core/fs-store.ts#L30) follows them on reads, and [build.ts](../mcp/worker/build.ts#L53) copies their targets. A synthetic external file appeared in the manifest; the subagent also read its contents through the store. | Resolve explicitly selected top-level skill links, constrain nested resources to that resolved root, detect cycles, and recheck live reads. Test symlink replacement as well as initial scanning. |
| P1 | Parsed JSON is cast to a message without envelope validation in [worker.ts](../mcp/worker/worker.ts#L119). `null` throws at `"method" in message`; the subagent also reproduced primitives throwing, invalid envelopes timing out, and `{}` returning 202. | Validate before dispatch, distinguish requests/notifications/responses, produce bounded errors, and clear timeout handles on every exit. |
| P1 | The custom HTTP transport does not validate Origin or protocol-version headers. A request carrying `MCP-Protocol-Version: bogus` and an unrelated Origin returned 200 in independent probes. | Declare allowed origins and supported protocol versions, enforce their response contracts, and test the complete transport boundary. Prefer a supported SDK transport where practical. |
| P1 | [worker.ts](../mcp/worker/worker.ts#L109) reads an entire body before checking string length. A 69,060-byte UTF-8 ping returned 200 despite the 65,536-byte limit. [manifest.ts](../mcp/core/manifest.ts#L101) checks resource count after traversal and total bytes after reading. | Bound actual bytes during streaming and enforce scanner budgets before traversal/allocation exceeds them. Include initial SKILL.md, cycles, oversized files, and filesystem failures. |
| P1 | [build.ts](../mcp/worker/build.ts#L33) deletes `--out` before validating input relationships. It then hashes source files, copies them, and rereads SKILL.md at separate times. Overlapping output can remove input; concurrent edits can produce a manifest that disagrees with published bytes. These are code-evidenced hazards, not destructive probes against user files. | Reject dangerous output paths; stage and validate one snapshot; derive every representation from it; replace only managed output after success. |
| P1 | [skill-page.ts](../mcp/worker/skill-page.ts#L13) and [build.ts](../mcp/worker/build.ts#L96) embed the original service origin. A third-party instance's generated instructions therefore point at another publisher. | Pass one explicit public origin through generation and verify a second-origin fixture, including prompts, source links, JSON discovery, and MCP configuration. |

The [2025-11-25 MCP transport specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) requires Origin validation and a 403 response for invalid origins, and requires 400 for invalid or unsupported protocol versions. It permits 405 for GET when the server does not offer an SSE stream. Keep that valid stateless behavior. The broader Content-Type/Accept and lifecycle audit should target the exact protocol revision claimed by the package.

## Conditional blocker and follow-up work

[materialize.ts](../mcp/materialize.ts#L81) joins resource-derived paths into the destination and writes through ordinary filesystem operations. Before exposing it as a supported installer, validate namespace and path containment, reject destination symlinks, and use a fresh staging destination with explicit replacement semantics. Its present example launches this repository's own local server, so this is not a demonstrated remote-server exploit. Keep it outside the first public CLI unless hardened.

The package still needs compiled exports, a CLI mapping, a version, an explicit file allowlist, license/attribution, and clean-install tests. Remove original-site analytics from reusable defaults. Existing PostHog emission is conditional on configuration; it is not unconditional telemetry. Normalize archive metadata before promising reproducible archive hashes. Move shared skill-name validation into the scanner so stdio and hosted builds enforce the same domain rules.

## Evidence and limits

The subagent ran typecheck successfully and reported 90 passing tests, three live-Worker tests skipped, and no failures. The primary agent independently ran the focused probes above and inspected all blocking code paths. Earlier PR validation covered the live HTTP suite; this review did not rerun it and does not claim a fresh production assessment. No implementation files were changed by the review.

Existing protections include handler-level manifest membership checks, digest and size metadata, portable-tier filtering, explicit HTTP path rejection, content negotiation, escaped page rendering, byte-preservation checks, and install guidance that distinguishes integrity from safety. Preserve these while closing the boundary gaps.

The [release plan](skill-server-release-plan.md) turns these findings into ordered implementation and publication gates. Start with the trust-boundary fixes.
