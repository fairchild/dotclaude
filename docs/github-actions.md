# GitHub Actions and releases

`ci.yml` owns deterministic checks, the two site deployments and the
skill-server release that follows a deploy. `verify-skill-server.yml` builds and
verifies the package candidate. PRs test Linux and macOS on Node 22/24; main and
manual CI also test Windows. One Linux consumer checks the minimum Node 22.14.0
version on every package run. It replaces the duplicated package jobs, with
read-only permissions and no inherited secrets.
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
| skill-server tarball | Node compilation; clean consumer installs, with Windows after merge and before release | Actions artifact, 14-day retention |
| skills Worker | Install that tarball; build snapshot; bundle adapter; real Wrangler HTTP checks; Chromium run of the library's keyboard flow | skills-production, skills.cloudcompute.com |
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

Windows failures are discovered after merge, but still block deployment and
package publication. The previous production version remains serving. Path
filtering applies before the matrix, so unrelated merges do not run these checks.

## CI cost and caching

Actionlint runs in the configuration job alongside other verification, not in the
changes job that every lane waits for. The aggregate `CI` check still requires it
whenever configuration verification runs, including all workflow changes.

Package jobs use setup-node's npm download cache, keyed by the runner OS,
architecture and `mcp/bun.lock` hash. This key groups reusable downloads; it does
not lock the fresh consumer install, which still resolves the package's declared
dependency ranges. We never cache `node_modules`, installed candidates or build
outputs. Candidate installation and consumer checks report separate timings in
logs and job summaries. Compare warm runs with cold runs before attributing a
speedup to caching. Bun already caches its executable; dependency installs are
currently cheap enough that Bun/uv dependency and browser caches are not enabled.

## GitHub settings

### Current repository configuration

Verified 2026-09-05: `skills-production` and `webui-production` exist with main-only
deployment policies and no reviewer or wait-timer requirement. The active
`pr-required` ruleset requires the `CI` check from the GitHub Actions integration,
requires PRs, and prevents branch deletion and force-push. It does not require
branches to be updated to the latest main before merging. Individual conditional
jobs and advisory AI review are not required checks.

The historical `claude-review.yml` registration is disabled;
`claude-code-review.yml` is its active replacement. These are repository settings,
not settings automatically applied by checking out the workflow files.

### Setup for a fork or new repository

Create `skills-production` and `webui-production`, allowing only the main branch,
with no required reviewers or wait timer. Configure a `CLOUDFLARE_API_TOKEN`
repository secret and `CLOUDFLARE_ACCOUNT_ID` variable for your own account, and
update Worker names and routes before enabling deployment. The upstream repository
uses these same setting names.
Environment-specific values can override them; moving the token requires its
original value because GitHub cannot return an existing encrypted secret.
Do not infer Worker authorization solely from the presence of a token name.

After the new workflow is on main and its CI job has succeeded, add the `CI`
check from the GitHub Actions integration to a branch ruleset such as
`pr-required`. Keep the rules requiring PRs and
preventing deletion/force-push. Do not make individual conditional jobs or the
advisory AI review required. If a historical `claude-review.yml` registration
exists, disable it after confirming `claude-code-review.yml` is the active replacement.

No npm credential or registry publishing job is configured. The manifest stays
private to prevent accidental npm publication; npm pack and tarball installs work.

## Releases follow deploys

The published release is the code the hosted service runs. The packed tarball is
byte-reproducible and the Worker is built from it, so its SHA-256 identifies the
deployed code; skill content in the snapshot is not part of it.

1. `release-check` compares the run's tarball with the GitHub release for its
   package version. A match needs nothing. A different digest under a released
   version fails the PR: bump `mcp/package.json` and add the version's
   `CHANGELOG.md` section. An unreleased version must already have that section.
2. On `main`, after `deploy-skills` succeeds, `release-skills` calls
   `release-skill-server.yml` for an unreleased version. It attests the same
   tarball that passed the consumer matrix and was deployed, then creates the
   `skill-server-v<version>` release (a prerelease for a `-rc.N` version) with
   the tarball, SHA256SUMS, source.json, and notes carrying the changelog section.
3. Released assets are never overwritten; a correction is a new version.

PR artifacts are not promoted by a privileged workflow_run handler. The release
job runs in the `main` push run and downloads only artifacts from that run. A
tag pushed by hand publishes nothing.

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
node scripts/prepare-worker.mjs out/skill-server-0.1.0-rc.2.tgz
node scripts/check-worker.mjs
cd e2e && bun install --frozen-lockfile && bun run test
```

The `browser` job in `verify-skill-server.yml` runs that last suite: the library
page's focus, filtering and clipboard behaviour, which request-level tests cannot
see. It builds its own snapshot, starts `wrangler dev` against it, and uploads
each run's video as `skill-library-keyboard-video-<sha>`.

The installed-consumer harness and existing HTTP suite replace source-only release
confidence. There is no additional package test framework. Actions linting and
path-routing regression checks are new because neither was covered previously.
The workflow regression protects pending-main concurrency. Matrix values and
artifact names are not duplicated in tests; actionlint and real CI exercise that
wiring.
