# skill-server release plan

Status, 2026-09-05: the GitHub-only candidate pipeline and package-backed site
deployment are implemented. The package version is `0.1.0-rc.1`, but no
`skill-server-v*` GitHub release has been published. npm publication remains
unconfigured and requires separate maintainer approval. The repository's older
`v0.1.0` release is not a skill-server package release.

The goal is one small package people can run against their own skills directory,
embed in an MCP application, and study as an independent implementation of the
experimental [Skills Over MCP extension](https://github.com/modelcontextprotocol/ext-skills).
It is not an official MCP reference implementation. Keep the package in `mcp/`;
no additional repository, plugin framework or package collection is needed.

## Implemented

`mcp/package.json` defines the package name, version, Node engine, executable,
typed ESM exports, license and file allowlist. The root export provides server
creation and store types, `/fs` provides filesystem storage, and `/http` provides
snapshot building and HTTP handling. The package stays `private: true` to prevent
accidental npm publication; packing and installing a tarball still work.

The distributed runtime requires Node 22.14 or newer, not Bun, TypeScript or a
system tar executable. The builder takes explicit root, output and base URL
arguments, uses the `tar` package for archives and `markdown-it` for rendering,
and produces reproducible archive bytes. Imports do not scan a home directory,
start a listener or emit telemetry. The hosted Worker uses the same package
implementation with a separate, deployment-specific telemetry adapter.

Hardening checks cover malformed HTTP/JSON-RPC input, streamed request limits,
filesystem budgets, nested symlinks, output overlap including linked skill roots,
staged-build preservation, safe rendering, negotiation, resource digests and
archives. These checks establish specific tested behavior, not a general safety
guarantee for untrusted skill contents.

CI tests source conformance, installs the packed artifact into a fresh directory,
exercises SDK clients over stdio and HTTP, and checks the packaged Worker in the
real local Cloudflare runtime. PRs run Linux/macOS consumers on Node 22/24 plus
Linux on Node 22.14.0. Main, tags and manual CI also run Windows on Node 22/24.
The same read-only verification workflow serves CI and tagged releases.

Relevant main changes automatically deploy the tested site artifacts after the
CI gate. A `skill-server-vX.Y.Z-rc.N` tag instead selects a GitHub prerelease after
tag/version/main-ancestry checks, package verification and artifact attestation.
It does not publish to npm. See [GitHub Actions and releases](github-actions.md)
for the operational procedure, environment settings, caching and recovery.

## Current user contract

Use a locally built or downloaded candidate tarball. The example filename is the
current package version, not a claim that a public release exists. Build one with
the [package verification commands](../mcp/README.md#developing-in-this-repository), or
obtain it from a successful package CI run. In a fresh consumer directory:

```sh
npm install ./skill-server-0.1.0-rc.1.tgz
npx --no-install skill-server --help
npx --no-install skill-server stdio --root ./skills
```

`stdio` keeps running until stopped. To build and serve a snapshot instead:

```sh
npx --no-install skill-server build --root ./skills --out ./dist/skills --base-url http://127.0.0.1:3000
npx --no-install skill-server serve --snapshot ./dist/skills --host 127.0.0.1 --port 3000
```

Provide your own `./skills` directory. `stdio` and `build` require `--root`;
`serve` requires `--snapshot`. Stdio diagnostics go to stderr. HTTP defaults to
loopback; intentional network exposure requires operator-managed authentication
and proxy configuration. Runtime dependencies still download from npm.

Digest verification establishes byte identity, not safe behavior. Old hosted
digest URLs are not retained automatically. The materialization example remains
source-only and outside the public CLI: its parent directory must be trusted and
free of concurrent external writers, and it is not an OS sandbox. See the
[materialization limitations](../mcp/README.md#verified-materialization-example).

## Remaining release gates

1. Select a GitHub candidate explicitly. Verify the chosen commit's full matrix,
   create its matching RC tag, inspect the resulting release assets and
   attestation, and install that exact release tarball in a fresh directory.
   The workflow exists; this first publication has not been exercised yet.
2. Complete broader reference-implementation qualification. Pin an exact upstream
   specification revision, publish the supported-method/limitations matrix and
   architecture walkthrough, and add security reporting instructions. Audit
   transport coverage, including refresh, errors and shutdown, against that
   matrix. Have a second reviewer follow only the packed README. Preserve the
   [quality review](skill-server-quality-review.md) as historical evidence and
   explicitly disposition any remaining findings against the candidate commit.
3. Before npm publication, confirm package-name ownership, publishing access,
   license/attribution and candidate acceptance. Complete registry-facing metadata
   such as homepage, issue reporting and publish configuration. Only remove
   `private: true` as part of that approved npm-release change. Do not publish a
   placeholder to reserve a name.
4. Add npm-specific release automation after approval. Recheck current
   [trusted-publisher requirements](https://docs.npmjs.com/trusted-publishers/),
   configure the publisher and release protections, and prefer short-lived OIDC
   credentials. Bootstrap with the maintainer's account only if required. Start
   with an approved RC on `next`; verify registry integrity, files, provenance,
   dist-tags and a fresh install before considering stable promotion.

A stable version is a new artifact and needs its own qualification. Reserve 1.0
for an explicit interface-stability commitment. Correct defective publications
with a new version and, where appropriate, deprecation or dist-tag changes;
never overwrite released assets. Site rollback and package-release selection
remain separate operations.

## Historical decisions and evidence

- The initial review covered PR #270. At that point the package lacked version,
  executable and export metadata; building depended on Bun-specific rendering and
  system tar. Those observations are superseded by the implemented state above.
- PR #272 added the first HTTP/filesystem/build hardening slice. PR #274 added
  output-overlap checks for canonical linked skill roots. PR #275 hardened the
  source-only materialization example, staging verified private, non-executable
  files and refusing existing output or symlink ancestors.
- PR #284 introduced the Node package, GitHub candidate pipeline and hosted
  autodeploy. PR #288 consolidated verification and fixed pending-main scheduling.
  PR #289 reduced PR platform coverage, added minimum-Node qualification and npm
  download caching, and moved actionlint off the serial startup path.
- Earlier registry probes recorded `skill-server` returning 404, the distinct
  `skills-server` name already occupied, and a local npm identity check returning
  401. These are historical observations, not current availability or ownership
  claims. Recheck exact names and credentials at release time.
