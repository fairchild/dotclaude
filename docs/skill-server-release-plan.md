# skill-server release plan

Status: proposed, not authorized for publication. Reviewed 2026-09-05 against merged PR #270, commit `81f4189e63edc4d34ac4d463889808782694a3a6`. This plan changes documentation only.

Publish a small server people can run against their own skills directory, embed in an MCP application, and study as a reference. Keep the connection to [ext-skills](https://github.com/modelcontextprotocol/ext-skills) prominent. Describe it as an independent implementation of the experimental Skills Over MCP extension, with an exact specification revision and a table of supported methods and limitations. The upstream repository explicitly says its exploratory work is not an official MCP specification or recommendation.

My recommendation is one npm package, `skill-server`, containing an importable core, a Node-compatible CLI, and HTTP snapshot support. Keep the existing `mcp/` directory for the first release and make the hosted site consume the same public exports. A new repository, plugin framework, or collection of packages would add work without improving the first user's experience.

## Current readiness

The existing store boundary already separates protocol handlers from filesystem and snapshot storage. Conformance checks exercise stdio, the Worker, representation negotiation, resource digests, and archives. These are good foundations for a reference implementation. Passing those checks does not yet demonstrate safety with hostile filesystem contents or malformed protocol envelopes.

The current package is private, has no version, executable mapping, or published exports, and requires Bun. The builder assumes this repository's layout and system `tar`; rendering uses `Bun.markdown`. Generated prompts point to `skills.cloudcompute.com`. The Worker includes deployment-specific metrics and optional PostHog emission. These choices need explicit package boundaries before third parties can reuse it safely.

On 2026-09-05, `GET https://registry.npmjs.org/skill-server` returned 404. Name ownership, permission to publish, and registry acceptance remain unverified. Recheck at release time. If the name cannot be acquired, select a scope owned by the maintainer before changing the documented install command.

## Proposed user contract

These commands describe the target interface; they do not work yet:

```sh
npx skill-server@0.1.0 stdio --root ./skills
npx skill-server@0.1.0 build --root ./skills --out ./dist/skills --base-url https://skills.example.com
npx skill-server@0.1.0 serve --snapshot ./dist/skills --host 127.0.0.1 --port 3000
```

Require an explicit skills root. Importing the package must not read a home directory, start a listener, or emit telemetry. Stdio logs go to stderr. `--help`, `--version`, invalid arguments, missing roots, and shutdown have predictable behavior. Bind HTTP to loopback by default; document the authentication and proxy requirements for intentional network exposure.

Publish compiled ESM and type declarations. Keep Bun for repository development, but make the distributed runtime work without Bun, TypeScript, a repository checkout, or system `tar`. Recommend a Node 22.14+ baseline, checked on Node 22 and 24 at release qualification. Supporting Node adds renderer/archive dependency work; it makes ordinary npm installation useful to a much wider audience.

Keep public exports small: server creation and store types at the root, filesystem storage under `/fs`, and snapshot build/HTTP functions under `/http`. Cloudflare gets a thin example adapter. Avoid exporting internal parsers and templates until a consumer needs them. Derive reported server version from package metadata.

## Delivery sequence

### 1. Fix the trust boundaries

Address the accompanying [quality review](skill-server-quality-review.md) first. Validate JSON-RPC envelopes, bound incoming bytes while streaming, constrain filesystem reads and traversal, and make build output safe and internally consistent. Prefer the SDK's supported stateless HTTP transport if it removes custom protocol behavior; document any adapter retained for Workers.

Each fix needs a focused regression using the failing input. Keep intended support for explicitly selected top-level skill symlinks separate from nested paths escaping a selected skill. Define that policy before implementation. Treat directories as untrusted inputs even when the operator chooses them. Do not execute skill scripts during scanning, rendering, packaging, or installation review.

Exit: reproduced release-blocking failures are closed, malformed input produces bounded protocol responses, and no served or archived resource escapes the selected skill root.

### 2. Extract the reusable application

Turn the builder into an explicit function accepting root, output, and site configuration. Use a fresh staging directory, verify the staged bytes against the manifest, and promote only complete output. Reject dangerous root/output overlap and accidental replacement of unrelated directories. Build manifests, pages, and archives from the same staged snapshot.

Inject the site's base URL and identity throughout pages, prompts, JSON discovery, and client configuration. Preserve the root-once/relative-supporting-path prompt convention. Keep the installation inspection guidance, including no telemetry or unexpected outbound data, and explain that digest verification establishes integrity rather than safe behavior.

Remove telemetry implementations from the reusable default server. If the hosted deployment still needs metrics, attach them in its adapter with explicit configuration and documentation. A fresh package installation must make no unsolicited outbound requests. It must never send skill contents or credentials to analytics.

Generate archives with stable path ordering and normalized ownership/timestamps while preserving documented executable permissions. Verify compressed-byte digests and reproducibility across fresh builds. State separately that retaining old digest URLs is the deployment operator's responsibility; a digest filename alone does not promise historical storage.

Exit: a neutral fixture site contains no original-host install destinations, and the existing hosted application uses the same exported implementation without duplicating handlers.

### 3. Prepare the npm artifact

Add `name`, prerelease version, description, `bin`, explicit `exports` and declarations, `engines`, repository/directory, homepage, bugs, license, and public registry configuration. Move TypeScript to development dependencies. Use a `files` allowlist for compiled modules, required templates, documentation, and license. The repository has an Apache-2.0 license; verify copied components and notices before packaging.

Ship no private skills, fixture secrets, generated production catalog, credentials, `.env`, metrics exports, or provider account configuration. Include a minimal licensed example skill. Use no consumer install lifecycle scripts. Build and pack in the release job, then inspect the actual tarball, since source-tree tests cannot detect omitted templates or broken export paths. These fields and inclusion rules follow npm's [package.json documentation](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/).

Exit: `npm pack --dry-run --json` has an explainable inventory, and installing the resulting tarball into an empty directory runs every documented public entrypoint without the source checkout.

### 4. Qualify the reference implementation

Extend the existing conformance suite rather than create another test framework. Add an installed-tarball consumer job because the current suite runs against source. Run runtime/CLI coverage on Linux, macOS, and Windows; exercise the Worker adapter in its own supported runtime. Run a real SDK client through initialize, extension discovery, listing, reading, refresh, errors, and shutdown over each supported transport.

Cover hostile paths, symlink swaps, cycles, resource budgets, Unicode byte counts, build/source mutation, output overlap, HTML injection, negotiation, HEAD, validators, binary bytes, archive membership, and reproducibility. Intercept outbound calls to prove the default package emits none. Keep package-code tests distinct from Skill Evals of bundled skill behavior.

Write a quickstart, an architecture walkthrough, the pinned protocol compatibility matrix, and a security policy with reporting instructions. Document stateless behavior, supported authentication/deployment patterns, client limitations, and digest retention. Have a second reviewer follow only the packed README using a fresh directory. Their success is the acceptance criterion for the tutorial.

Exit: the packed artifact passes supported-platform checks, all release-blocking review findings are closed, and examples produce the documented results.

### 5. Publish a candidate, then promote

The maintainer confirms npm ownership, package name, license/attribution, and the reviewed release artifact before any publication. Start with `0.1.0-rc.1` on the `next` tag. Bootstrap the first real candidate using the maintainer's authenticated account if npm requires an existing package for trusted-publisher setup; do not publish a placeholder to reserve the name.

Configure a package-specific GitHub Actions trusted publisher and a protected release environment. Use a GitHub-hosted runner with `id-token: write` and only the other permissions required by the job. npm currently requires npm CLI 11.5.1+ and Node 22.14+ for [trusted publishing](https://docs.npmjs.com/trusted-publishers/). Subsequent releases should use short-lived OIDC credentials. Verify provenance against the public source repository following npm's [provenance guidance](https://docs.npmjs.com/generating-provenance-statements/).

Release jobs validate tag/version/source agreement, build once, pack once, test that tarball, and publish the same tarball with an explicit registry and dist-tag. Inspect the registry's version, integrity, file contents, provenance, and dist-tags after publication. Install the published candidate in a fresh environment and repeat the quickstart and transport checks.

After candidate acceptance, publish `0.1.0` from the reviewed source and verify its packed artifact before moving users to `latest`. A version change creates a new artifact and needs its own pack check. Describe compatibility changes in release notes; reserve 1.0 for a deliberate API stability commitment. If a release is defective, correct the dist-tag, deprecate the affected version when appropriate, and ship a new version. Do not plan to overwrite a published version.

## Release decision

Publication is ready when the review blockers, package isolation, clean-install checks, documentation walkthrough, ownership, and release workflow are all complete with evidence for the candidate commit. No npm publication, production deployment, or runtime refactor is part of this planning change.

Start with the trust-boundary fixes. They protect today's hosted server as well as the future package and establish the behavior others should copy.
