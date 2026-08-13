#!/usr/bin/env bun
/**
 * Analyze repository for release readiness.
 * Read-only - safe to run anytime.
 *
 * Usage: bun analyze.ts [--json]
 */

import { $ } from "bun";

interface Commit {
  hash: string;
  type: string;
  scope?: string;
  description: string;
  breaking: boolean;
}

/** "none" means no gating run exists - which is not the same as passing. */
export type CiStatus = "success" | "failure" | "pending" | "none";

export interface WorkflowRun {
  name: string;
  event: string;
  status: string;
  conclusion: string | null;
  createdAt: string;
}

/**
 * "publish" - the repo already builds, tags or publishes its own releases.
 * "commit"  - the repo refuses direct pushes to the target branch.
 */
export type SignalScope = "publish" | "commit";

export interface OwnershipSignal {
  scope: SignalScope;
  detail: string;
}

interface AnalysisResult {
  context: {
    worktree: boolean;
    branch: string;
    target: string;
    repo: string;
    headSha: string;
  };
  lastTag: string | null;
  commits: Commit[];
  /** null when the repo owns its own versioning - see ownership. */
  suggestedVersion: string | null;
  changelog: string;
  ciStatus: CiStatus;
  ownership: OwnershipSignal[];
  errors: string[];
}

async function exec(cmd: string): Promise<string> {
  try {
    const result = await $`sh -c ${cmd}`.quiet().text();
    return result.trim();
  } catch {
    return "";
  }
}

async function execJson<T>(cmd: string): Promise<T | null> {
  try {
    const result = await $`sh -c ${cmd}`.quiet().json();
    return result as T;
  } catch {
    return null;
  }
}

function parseConventionalCommit(message: string): Commit | null {
  // Match: type(scope)!: description or type!: description or type: description
  const match = message.match(
    /^(\w+)(?:\(([^)]+)\))?(!)?\s*:\s*(.+?)(?:\n|$)/
  );
  if (!match) {
    // Non-conventional commit - treat as misc
    return {
      hash: "",
      type: "misc",
      description: message.split("\n")[0],
      breaking: false,
    };
  }

  const [, type, scope, bang, description] = match;
  const breaking =
    !!bang || message.toLowerCase().includes("breaking change");

  return {
    hash: "",
    type: type.toLowerCase(),
    scope: scope || undefined,
    description: description.trim(),
    breaking,
  };
}

function bumpVersion(
  current: string | null,
  commits: Commit[]
): { version: string; bump: "major" | "minor" | "patch" } {
  // Parse current version or start at 0.0.0
  let [major, minor, patch] = (current?.replace(/^v/, "") || "0.0.0")
    .split(".")
    .map(Number);

  const hasBreaking = commits.some((c) => c.breaking);
  const hasFeatures = commits.some((c) => c.type === "feat");

  let bump: "major" | "minor" | "patch";

  if (hasBreaking) {
    if (major === 0) {
      // Pre-1.0: breaking changes bump minor
      minor++;
      patch = 0;
      bump = "minor";
    } else {
      major++;
      minor = 0;
      patch = 0;
      bump = "major";
    }
  } else if (hasFeatures) {
    minor++;
    patch = 0;
    bump = "minor";
  } else {
    patch++;
    bump = "patch";
  }

  return { version: `v${major}.${minor}.${patch}`, bump };
}

function generateChangelog(commits: Commit[]): string {
  const sections: Record<string, string[]> = {
    Added: [],
    Changed: [],
    Fixed: [],
    Removed: [],
    Other: [],
  };

  for (const commit of commits) {
    const entry = commit.scope
      ? `${commit.scope}: ${commit.description}`
      : commit.description;

    switch (commit.type) {
      case "feat":
        sections.Added.push(entry);
        break;
      case "fix":
        sections.Fixed.push(entry);
        break;
      case "refactor":
      case "perf":
        sections.Changed.push(entry);
        break;
      case "revert":
        sections.Removed.push(entry);
        break;
      case "docs":
      case "style":
      case "test":
      case "chore":
      case "ci":
      case "build":
        // Skip non-user-facing changes
        break;
      default:
        sections.Other.push(entry);
    }
  }

  // Build changelog text
  const lines: string[] = [];
  for (const [section, items] of Object.entries(sections)) {
    if (items.length > 0) {
      lines.push(`### ${section}`);
      for (const item of items) {
        lines.push(`- ${item}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n").trim() || "No notable changes.";
}

/** Conclusions that mean a workflow did not object to the commit. */
const BENIGN = new Set(["success", "skipped", "neutral"]);

/**
 * The verdict of the workflows that gate a commit.
 *
 * Only `push` runs answer "is this commit good?". Scheduled jobs, bot replies
 * to comments, `workflow_run` chains and check_suite automation are reactions
 * to other events and are green or red for reasons of their own.
 */
export function ciVerdict(runs: WorkflowRun[]): CiStatus {
  const latest = new Map<string, WorkflowRun>();
  for (const run of runs.filter((r) => r.event === "push")) {
    const seen = latest.get(run.name);
    if (!seen || run.createdAt > seen.createdAt) latest.set(run.name, run);
  }

  const gating = [...latest.values()];
  const failed = gating.some(
    (r) => r.status === "completed" && !BENIGN.has(r.conclusion ?? "")
  );
  if (failed) return "failure";
  if (gating.some((r) => r.status !== "completed")) return "pending";
  return gating.some((r) => r.conclusion === "success") ? "success" : "none";
}

/** Does this workflow start when a tag is pushed? */
export function triggersOnTagPush(yaml: string): boolean {
  let inOn = false;
  let pushIndent = -1;

  for (const line of yaml.split("\n")) {
    const body = line.trimStart();
    if (!body || body.startsWith("#")) continue;
    const indent = line.length - body.length;

    if (indent === 0) {
      inOn = /^["']?on["']?\s*:/.test(body);
      pushIndent = -1;
      // Flow style: on: {push: {tags: [...]}}
      if (inOn && /push\s*:/.test(body) && /tags\s*:/.test(body)) return true;
      continue;
    }
    if (!inOn) continue;

    if (pushIndent >= 0 && indent <= pushIndent) pushIndent = -1;
    if (pushIndent < 0) {
      if (/^push\s*:/.test(body)) {
        pushIndent = indent;
        if (/tags\s*:/.test(body)) return true;
      }
      continue;
    }
    if (indent > pushIndent && /^tags\s*:/.test(body)) return true;
  }

  return false;
}

/**
 * Signals that a repo already owns some part of its release process.
 *
 * Detection is by convention only - no repo-specific layout is assumed. A
 * false positive costs a human one manual tag; a false negative costs a
 * broken release, so any signal is enough to defer.
 */
async function detectOwnership(target: string): Promise<OwnershipSignal[]> {
  const signals: OwnershipSignal[] = [];
  const tree = (await exec(`git ls-tree -r --name-only origin/${target}`))
    .split("\n")
    .filter(Boolean);

  const runbook = tree.find((p) => /^(docs\/)?RELEAS(E|ING)\.md$/i.test(p));
  if (runbook) {
    signals.push({ scope: "publish", detail: `${runbook} documents a release process` });
  }

  const helpers = tree.filter((p) =>
    /^scripts\/[^/]*release[^/]*\.(sh|py|ts|js)$/i.test(p)
  );
  if (helpers.length > 0) {
    const more = helpers.length > 1 ? ` (+${helpers.length - 1} more)` : "";
    signals.push({ scope: "publish", detail: `${helpers[0]}${more} prepares releases` });
  }

  // Only workflows mentioning tags at all are worth reading in full.
  const candidates = (
    await exec(`git grep -lF "tags:" "origin/${target}" -- .github/workflows`)
  )
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split(":").slice(1).join(":"));

  for (const workflow of candidates) {
    const body = await exec(`git show "origin/${target}:${workflow}"`);
    if (triggersOnTagPush(body)) {
      signals.push({
        scope: "publish",
        detail: `${workflow} runs on tag push - pushing a tag starts it`,
      });
      break;
    }
  }

  const rules = await execJson<Array<{ type: string }>>(
    `gh api "repos/{owner}/{repo}/rules/branches/${target}"`
  );
  if (rules?.some((r) => r.type === "pull_request")) {
    signals.push({
      scope: "commit",
      detail: `${target} requires a pull request - a direct push spends an admin bypass`,
    });
  }

  return signals;
}

async function analyze(): Promise<AnalysisResult> {
  const errors: string[] = [];

  // 1. Detect context
  const gitDir = await exec("git rev-parse --git-dir");
  const commonDir = await exec("git rev-parse --git-common-dir");
  const worktree = gitDir !== commonDir;
  const branch = await exec("git branch --show-current");

  // Get repo name from remote
  const remoteUrl = await exec("git remote get-url origin");
  const repoMatch = remoteUrl.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  const repo = repoMatch ? repoMatch[1] : "unknown";

  // 2. Get default branch from GitHub
  let target = "main";
  const ghData = await execJson<{ defaultBranchRef: { name: string } }>(
    "gh repo view --json defaultBranchRef"
  );
  if (ghData?.defaultBranchRef?.name) {
    target = ghData.defaultBranchRef.name;
  } else {
    errors.push("Could not detect default branch, assuming 'main'");
  }

  // 3. Fetch latest
  await exec(`git fetch origin ${target} --quiet`);

  // 4. Find last tag
  const lastTag = await exec("git tag --list 'v*' --sort=-version:refname | head -1");

  // 5. Get commits since last tag (on origin/target)
  const range = lastTag ? `${lastTag}..origin/${target}` : `origin/${target}`;
  const logOutput = await exec(
    `git log ${range} --format="%H|||%s" --no-merges`
  );

  const commits: Commit[] = [];
  if (logOutput) {
    for (const line of logOutput.split("\n")) {
      const [hash, ...msgParts] = line.split("|||");
      const message = msgParts.join("|||");
      if (hash && message) {
        const parsed = parseConventionalCommit(message);
        if (parsed) {
          parsed.hash = hash.slice(0, 7);
          commits.push(parsed);
        }
      }
    }
  }

  // 6. Detect whether the repo already owns part of its release process
  const ownership = await detectOwnership(target);
  const ownsPublish = ownership.some((s) => s.scope === "publish");

  // 7. Suggest version - unless the repo's own process owns versioning, in
  // which case any version we picked could contradict the app's metadata.
  const suggestedVersion = ownsPublish
    ? null
    : bumpVersion(lastTag, commits).version;

  // 8. Generate changelog
  const changelog = generateChangelog(commits);

  // 9. Check CI on the exact commit being released
  const headSha = await exec(`git rev-parse origin/${target}`);
  let ciStatus: CiStatus = "none";
  if (!/^[0-9a-f]{40}$/.test(headSha)) {
    // Without a SHA the query would match every recent run in the repo, which
    // is the unscoped lottery this gate exists to avoid.
    errors.push(`Could not resolve origin/${target} - CI status unverified`);
  } else {
    const runs = await execJson<{ workflow_runs: Array<Record<string, unknown>> }>(
      `gh api "repos/{owner}/{repo}/actions/runs?head_sha=${headSha}&per_page=100"`
    );
    if (runs) {
      ciStatus = ciVerdict(
        runs.workflow_runs.map((r) => ({
          name: String(r.name),
          event: String(r.event),
          status: String(r.status),
          conclusion: (r.conclusion as string | null) ?? null,
          createdAt: String(r.created_at),
        }))
      );
    } else {
      errors.push("Could not read workflow runs - CI status unverified");
    }
  }

  return {
    context: { worktree, branch, target, repo, headSha },
    lastTag: lastTag || null,
    commits,
    suggestedVersion,
    changelog,
    ciStatus,
    ownership,
    errors,
  };
}

const CI_LABEL: Record<CiStatus, string> = {
  success: "✅ passing",
  failure: "❌ failing",
  pending: "⏳ still running",
  none: "⚠️  no gating run found for this commit",
};

if (import.meta.main) {
  const jsonOutput = process.argv.includes("--json");
  const result = await analyze();

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`\n📦 Release Analysis for ${result.context.repo}\n`);
    console.log(`Context:`);
    console.log(`  Branch: ${result.context.branch}${result.context.worktree ? " (worktree)" : ""}`);
    console.log(`  Target: origin/${result.context.target} @ ${result.context.headSha.slice(0, 7)}`);
    console.log(`  Last tag: ${result.lastTag || "(none - first release)"}`);
    console.log(`  CI: ${CI_LABEL[result.ciStatus]}`);
    console.log();

    if (result.ownership.length > 0) {
      console.log("This repo owns part of its own release process:");
      for (const s of result.ownership) {
        console.log(`  • ${s.detail}`);
      }
      console.log();
    }

    if (result.commits.length === 0) {
      console.log("No commits since last release.\n");
    } else {
      console.log(`Commits (${result.commits.length}):`);
      for (const c of result.commits.slice(0, 10)) {
        const breaking = c.breaking ? " 💥" : "";
        console.log(`  ${c.hash} ${c.type}: ${c.description}${breaking}`);
      }
      if (result.commits.length > 10) {
        console.log(`  ... and ${result.commits.length - 10} more`);
      }
      console.log();

      if (result.suggestedVersion) {
        console.log(`Suggested version: ${result.suggestedVersion}\n`);
      } else {
        console.log("Suggested version: none - this repo's own release process picks it.\n");
      }
      console.log(`Changelog preview:`);
      console.log(result.changelog.split("\n").map(l => `  ${l}`).join("\n"));
      console.log();
    }

    if (result.errors.length > 0) {
      console.log("Warnings:");
      for (const e of result.errors) {
        console.log(`  ⚠️  ${e}`);
      }
    }
  }
}
