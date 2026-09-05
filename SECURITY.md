# Security policy

## Supported versions

`skill-server` has no stable release, and no `skill-server-v*` prerelease has
been published yet. Once one exists, the supported artifacts are the
`0.1.0-rc.N` candidates published as `skill-server-v*` GitHub prereleases, and
only the most recent one. The repository's older `v0.1.0` release is not a
skill-server package release. There is no npm package. Fixes ship as a new
candidate; released assets are never overwritten.

The hosted deployment at `skills.cloudcompute.com` tracks `main` and redeploys
on merge, so it is supported at whatever commit it currently serves —
`/version.json` reports that commit and the installed package version.

## In scope

- The `skill-server` package in [`mcp/`](mcp/): the MCP server, the stdio and
  HTTP bindings, the snapshot builder, and the CLI.
- The hosted deployment at `skills.cloudcompute.com`, including its HTTP
  download routes and its `/mcp` endpoint.
- This repository's own skills, and the release and deployment workflows in
  `.github/workflows/`.

## Out of scope

- The behavior of third-party skill contents served through the software. A
  matching digest establishes byte identity, not safe behavior; skill text and
  bundled scripts are untrusted material for a consumer to inspect. Report a
  malicious skill to whoever publishes it.
- `@modelcontextprotocol/sdk` and other dependencies — report those upstream,
  and open an issue here if this repository needs to pin or work around a fix.
- Network exposure of an operator's own deployment. The HTTP binding adds no
  authentication and defaults to loopback; authentication, transport security
  and proxy configuration belong to the operator who exposes it.
- Findings that require an attacker who already has write access to the skills
  root, the build output's parent directory, or the machine running the server.

## Reporting

Report privately through GitHub Security Advisories:

**https://github.com/fairchild/dotclaude/security/advisories/new**

Include the affected version or commit, what an attacker gains, and the
smallest reproduction you have. Please do not open a public issue first.

Expect an acknowledgement within five business days. This is a personal
repository with no bounty program and no paid support. Disclosure is
coordinated: the report stays private until a fixed candidate is published, and
the advisory credits you unless you ask otherwise. If ninety days pass without
a fix, publish — an unfixed report should not stay buried.
