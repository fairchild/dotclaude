# Changelog

Changes to `skill-server`: the npm package and the hosted service at
`https://skills.cloudcompute.com`. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

A change to the package ships with a new version and its section here. When it
merges, CI deploys the tarball to the hosted service and publishes that same
tarball as the `skill-server-v<version>` GitHub release, so the newest
`skill-server-v*` release is what the hosted service runs.

## [Unreleased]

## [0.1.0-rc.2] - 2026-11-26

The server now implements MCP protocol revision 2026-07-28 and nothing
earlier.

### Changed

- **Breaking:** both bindings serve only protocol revision 2026-07-28. A
  2025-era request (`initialize`, or any request whose `params._meta` lacks
  `io.modelcontextprotocol/protocolVersion`) gets `400` with `-32022` and
  `error.data.supported: ["2026-07-28"]`. Over stdio, a 2025-era opening
  message is refused the same way. Clients on the TypeScript SDK v2 connect
  with `versionNegotiation: { mode: "auto" }` or
  `{ mode: { pin: "2026-07-28" } }`.
- The base protocol layer moved to the split SDK v2 packages
  (`@modelcontextprotocol/server` and `client`, pinned at 2.4.0). The
  Skills handlers, store boundary and HTTP gates are still this package's own.
- HTTP requests must carry the `MCP-Protocol-Version` and `Mcp-Method` headers,
  plus `Mcp-Name` on `resources/read`. A missing or mismatched header gets `400`
  with `-32020`, and an unknown method gets `404` with `-32601`.
- In `resources/list`, a skill's `SKILL.md` is named after the skill.
- The package description and site copy no longer call the extension
  experimental. `index.json` points at the beta specification.
- Releases follow deploys. CI publishes the tarball it deployed as the
  version's GitHub release, and fails a change to the package or the Worker
  adapter that keeps a released version. `source.json` gains `identity`, a hash
  of every packed file plus the Worker adapter and config. The release notes
  carry the version's changelog section.

### Added

- `server/discover` reports the supported revision, the capabilities with the
  Skills extension, and the server's identity.
- Every cacheable result carries `resultType: "complete"`, `ttlMs` and
  `cacheScope` (SEP-2549): `300000`/`public` from a hosted snapshot and
  `0`/`private` from stdio. `skills/get`, the refresh path, is always
  `0`/`private`.
- Each skill entry's `_meta["com.cloudcompute.skills/portability"]` says where
  the skill can run: `portable`, or `machine-bound` for a skill that needs a
  local machine.
- An unknown resource's `-32602` error carries the requested URI in
  `error.data.uri`.
- Conformance tests validate results against the ext-skills beta JSON Schema
  (vendored at ext-skills `c0705f9`).
- This changelog, served by every snapshot at `/changelog.md` and linked from
  `index.json` and `llms.txt`.

### Removed

- The 2025-era protocol: `initialize`, sessions without an envelope, and the
  one-message-per-POST transport that answered them.
- The `@modelcontextprotocol/sdk` v1 dependency.
- The keyboard shortcut line on skill and file pages. The catalog's line under
  the filter is down to Tab, Enter and Esc.
- The "dotclaude / skill library" row at the top of every page. The catalog's
  "For agents" link duplicated its Markdown catalog link; skill and file pages
  keep their way back.

### Deployed after 0.1.0-rc.1, first packaged here

The service deployed these from `main` before releases followed deploys:

- Skill-authored files are served sandboxed, and pages refuse framing.
- The site leads with what a visitor gets and links each build to its source.
  It self-hosts its fonts and has keyboard navigation through the library.
- `robots.txt` with content signals, a sitemap, and PostHog events that record
  no person.
- Installs land where Claude Code loads skills, and there is a shell install
  command.

## [0.1.0-rc.1] - 2026-09-05

This entry was written after the fact from the history up to the tag. It is the
first release candidate. It served MCP protocol revisions up to 2025-11-25.

### Added

- A Skills over MCP (SEP-2640) server: `skills/list`, `skills/get` and
  `resources/directory/read`, plus `resources/list` and `resources/read` over
  `skill://` URIs. Each entry is a complete manifest of verbatim frontmatter,
  plus a SHA-256 digest and size for every file.
- Bindings: stdio over a live skills directory, and stateless Streamable HTTP
  over a build-time snapshot. The HTTP binding runs as a Cloudflare Worker or
  through `skill-server serve`.
- A portability split. Skills marked `metadata.portability: machine-bound` stay
  off the hosted tier.
- The hosted service at `skills.cloudcompute.com`: skill pages, raw and text
  files, per-skill archives with a pinned manifest, `llms.txt`, a JSON homepage
  and per-request usage metrics.
- Host-side materialization that verifies every digest before it writes
  anything.
- A Node CLI and importable modules, built and released through GitHub with
  attested artifacts.

[Unreleased]: https://github.com/fairchild/dotclaude/compare/skill-server-v0.1.0-rc.2...HEAD
[0.1.0-rc.2]: https://github.com/fairchild/dotclaude/releases/tag/skill-server-v0.1.0-rc.2
[0.1.0-rc.1]: https://github.com/fairchild/dotclaude/releases/tag/skill-server-v0.1.0-rc.1
