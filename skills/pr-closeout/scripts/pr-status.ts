#!/usr/bin/env bun

/**
 * Fetch PR status: metadata, unresolved review comments, CI status.
 * Usage: bun scripts/pr-status.ts [PR_NUMBER]
 * If no PR number provided, auto-detects from current branch.
 */

import { $ } from "bun";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

interface PRMetadata {
  number: number;
  title: string;
  state: string;
  mergeable: string;
  reviewDecision: string;
  url: string;
  additions: number;
  deletions: number;
  changedFiles: number;
}

interface ReviewThread {
  id: string;
  isResolved: boolean;
  path: string;
  line: number | null;
  comments: {
    nodes: Array<{
      author: { login: string } | null;
      body: string;
      createdAt: string;
      url: string;
    }>;
  };
}

interface CICheck {
  name: string;
  state: string;
  conclusion: string;
  detailsUrl: string;
}

async function getRepoInfo(): Promise<{ owner: string; repo: string }> {
  const result = await $`gh repo view --json owner,name`.quiet();
  const data = JSON.parse(result.stdout.toString());
  return { owner: data.owner.login, repo: data.name };
}

async function getPRNumber(providedNumber?: number): Promise<number> {
  if (providedNumber) return providedNumber;

  const result = await $`gh pr view --json number`.quiet();
  const data = JSON.parse(result.stdout.toString());
  return data.number;
}

async function getPRMetadata(prNumber: number): Promise<PRMetadata> {
  const result =
    await $`gh pr view ${prNumber} --json number,title,state,mergeable,reviewDecision,url,additions,deletions,changedFiles`.quiet();
  return JSON.parse(result.stdout.toString());
}

async function getReviewThreads(
  owner: string,
  repo: string,
  prNumber: number
): Promise<ReviewThread[]> {
  const query = `
    query($owner: String!, $repo: String!, $pr: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $pr) {
          reviewThreads(first: 100) {
            nodes {
              id
              isResolved
              path
              line
              comments(first: 10) {
                nodes {
                  author { login }
                  body
                  createdAt
                  url
                }
              }
            }
          }
        }
      }
    }
  `;

  const result =
    await $`gh api graphql -f query=${query} -f owner=${owner} -f repo=${repo} -F pr=${prNumber}`.quiet();
  const data = JSON.parse(result.stdout.toString());
  return data.data.repository.pullRequest.reviewThreads.nodes;
}

async function getCIChecks(prNumber: number): Promise<CICheck[]> {
  try {
    const result =
      await $`gh pr checks ${prNumber} --json name,state,conclusion,detailsUrl`.quiet();
    return JSON.parse(result.stdout.toString());
  } catch {
    return [];
  }
}

function formatStatus(conclusion: string, state: string): string {
  if (conclusion === "success") return "pass";
  if (conclusion === "failure") return "fail";
  if (state === "pending") return "pending";
  return conclusion || state || "unknown";
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

function generateMarkdown(
  pr: PRMetadata,
  threads: ReviewThread[],
  checks: CICheck[]
): string {
  const unresolvedThreads = threads.filter((t) => !t.isResolved);
  const timestamp = new Date().toISOString();

  let md = `## PR Status: #${pr.number} - ${pr.title}\n\n`;
  md += `**State**: ${pr.state} | **Mergeable**: ${pr.mergeable || "unknown"}\n`;
  md += `**Review Decision**: ${pr.reviewDecision || "none"}\n`;
  md += `**Changes**: +${pr.additions} -${pr.deletions} in ${pr.changedFiles} files\n`;
  md += `**URL**: ${pr.url}\n\n`;

  // CI Status
  md += `### CI Status\n\n`;
  if (checks.length === 0) {
    md += `No CI checks found.\n\n`;
  } else {
    md += `| Check | Status | Details |\n`;
    md += `|-------|--------|--------|\n`;
    for (const check of checks) {
      const status = formatStatus(check.conclusion, check.state);
      const link = check.detailsUrl ? `[link](${check.detailsUrl})` : "-";
      md += `| ${check.name} | ${status} | ${link} |\n`;
    }
    md += `\n`;
  }

  // Unresolved Comments
  md += `### Unresolved Review Comments (${unresolvedThreads.length})\n\n`;
  if (unresolvedThreads.length === 0) {
    md += `No unresolved review comments.\n\n`;
  } else {
    for (const thread of unresolvedThreads) {
      const firstComment = thread.comments.nodes[0];
      if (!firstComment) continue;

      const author = firstComment.author?.login || "unknown";
      const location = thread.line
        ? `\`${thread.path}:${thread.line}\``
        : `\`${thread.path}\``;

      md += `#### ${location} - @${author}\n`;
      md += `Thread ID: \`${thread.id}\`\n`;
      md += `> ${truncate(firstComment.body.replace(/\n/g, " "), 200)}\n\n`;
      md += `[View thread](${firstComment.url})\n\n`;
    }
  }

  md += `---\n\n`;
  md += `*Generated: ${timestamp}*\n`;

  return md;
}

async function main() {
  const args = process.argv.slice(2);
  const providedPR = args[0] ? parseInt(args[0], 10) : undefined;

  try {
    // Get PR number (auto-detect or provided)
    let prNumber: number;
    try {
      prNumber = await getPRNumber(providedPR);
    } catch {
      console.error("No PR found for current branch. Create a PR first.");
      process.exit(1);
    }

    // Fetch all data in parallel
    const [repoInfo, prMetadata, checks] = await Promise.all([
      getRepoInfo(),
      getPRMetadata(prNumber),
      getCIChecks(prNumber),
    ]);

    const threads = await getReviewThreads(
      repoInfo.owner,
      repoInfo.repo,
      prNumber
    );

    // Generate markdown
    const markdown = generateMarkdown(prMetadata, threads, checks);

    // Save to .context/
    const contextDir = join(process.cwd(), ".context");
    mkdirSync(contextDir, { recursive: true });
    const artifactPath = join(contextDir, `pr-status-${prNumber}.md`);
    writeFileSync(artifactPath, markdown);

    // Output to stdout
    console.log(markdown);
    console.log(`\n*Saved to: ${artifactPath}*`);
  } catch (error) {
    console.error("Error fetching PR status:", error);
    process.exit(1);
  }
}

main();
