# GitHub Actions and releases

`ci.yml` owns deterministic checks and the two site deployments.
`verify-skill-server.yml` builds and verifies package candidates for both CI and
tagged releases, including the six-platform consumer matrix. It replaces the
duplicated package jobs, with read-only permissions and no inherited secrets.
The `CI` job is the stable merge check. The always-running changes
job uses `.github/scripts/paths.mjs`; add inputs there when a builder starts
reading another file. Workflow changes run all lanes. Documentation-only changes
finish without unrelated builds. Renames include both old and new paths.

This replaces PR Validation, Analyze Usage Tests, Team Memory Tests, Persona
Memory's deterministic job, and Deploy WebUI. Check results live in named jobs
instead of a separately maintained PR validation comment. `persona-memory-live.yml`
keeps scheduled provider calls outside the merge gate. The two Claude workflows
remain separate because their triggers and credentials differ from deterministic CI.

## Candidate and deployment ownership

| Output | Build and verification | Destination |
| --- | --- | --- |
| skill-server tarball | Node compilation; clean consumer install on Node 22/24, Linux/macOS/Windows | Actions artifact, 14-day retention |
| skills Worker | Install that tarball; build snapshot; bundle adapter; real Wrangler HTTP checks | skills-production, skills.cloudcompute.com |
| WebUI | Generate data; allowlist static files; browser-test packaged files | webui-production, claude.cloudcompute.com |
| selected package candidate | Tag/version/main ancestry checks; same package and Worker checks; consumer matrix | GitHub prerelease |

Each site deploys the tested artifact from its workflow run. Deployments use
separate concurrency groups, run only from main, and reject older inputs when
newer main commits change that service. Unrelated later commits do not block a
valid deployment. Only PR runs share a workflow concurrency group; main runs have
unique groups so a docs-only push cannot replace a pending deployment-producing
run. Site locks still serialize deployments. A manual CI run on main rebuilds
both sites for recovery.

The final deployment step checks the public commit marker and application
responses. GitHub's environment deployment status therefore includes these checks.
Skills additionally exposes the installed package version and digest in
`/version.json`. The tarball includes compiled code and templates, not the hosted
catalog, telemetry adapter, or account configuration. Its runtime dependencies
still download from npm.

## GitHub settings

Create `skills-production` and `webui-production`, allowing only the main branch,
with no required reviewers or wait timer. The existing `CLOUDFLARE_API_TOKEN`
repository secret and `CLOUDFLARE_ACCOUNT_ID` variable are used initially.
Environment-specific values can override them; moving the token requires its
original value because GitHub cannot return an existing encrypted secret.
Do not infer Worker authorization solely from the presence of a token name.

After the new workflow is on main and its CI job has succeeded, add the `CI`
check to the existing `pr-required` ruleset. Keep the rules requiring PRs and
preventing deletion/force-push. Do not make individual conditional jobs or the
advisory AI review required. Disable the historical `claude-review.yml` registration
after confirming `claude-code-review.yml` is the active replacement.

No npm credential or registry publishing job is configured. The manifest stays
private to prevent accidental npm publication; npm pack and tarball installs work.

## Selecting a prerelease

1. Merge a reviewed version change with a unique `X.Y.Z-rc.N` package version.
2. Wait for the package consumer matrix and hosted build checks on that commit.
3. Create and push `skill-server-vX.Y.Z-rc.N` at that commit. This is the explicit
   publication action. A tag cannot point outside main's ancestry or disagree
   with the package version.
4. `release-skill-server.yml` builds and packs once, tests the same tarball on all
   supported platforms and in the Worker, attests it, then creates a GitHub
   prerelease containing the tarball, SHA256SUMS and source.json.
5. Follow its installation instructions in an empty directory. Do not overwrite
   an existing release asset; increment the candidate version for corrections.

PR artifacts are not promoted by a privileged workflow_run handler. The release
workflow checks out the selected main-ancestry tag and creates its own candidate.
The publishing job downloads only artifacts from that same run. The tarball that
passes its consumer matrix is the tarball uploaded to the release.

## Recovery

If public verification fails, inspect the failed deployment and Cloudflare version
before retrying. A successful upload followed by a failed check can mean the new
version is already serving. The workflow does not claim automatic rollback.
Restore the previous Cloudflare version with Wrangler's rollback command, record
its version and source commit, then rerun the public checks for that source.
Use a new main commit or manual CI run to redeploy a corrected build. Keep package
prerelease selection independent of site rollback.

## Local verification

```sh
actionlint .github/workflows/*.yml
node --test .github/scripts/paths.test.mjs
uv run --script .github/scripts/test-workflows.py
cd mcp
bun install --frozen-lockfile
bun run typecheck
bun test conformance
bun run build:package
PACKAGE_OUTPUT_DIR=out bun run test:package
node scripts/prepare-worker.mjs out/skill-server-0.1.0-rc.1.tgz
node scripts/check-worker.mjs
```

The installed-consumer harness and existing HTTP suite replace source-only release
confidence. There is no additional package test framework. Actions linting and
path-routing regression checks are new because neither was covered previously.
Workflow-contract tests cover concurrency, shared qualification and artifact
wiring, replacing manual inspection of those relationships.
