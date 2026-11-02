#!/usr/bin/env bun

/**
 * Fetch PR status: metadata, unresolved review comments, CI status.
 * Usage: bun pr-status.ts [PR_NUMBER]   (run from the PR's repository)
 * If no PR number provided, auto-detects from current branch.
 */

import { $ } from "bun";

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
      databaseId: number;
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
  bucket: string;
  link: string;
}

function repoFromUrl(url: string): { owner: string; repo: string } {
  const [, owner, repo] = new URL(url).pathname.split("/");
  return { owner, repo };
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
            pageInfo { hasNextPage }
            nodes {
              id
              isResolved
              path
              line
              comments(first: 10) {
                nodes {
                  databaseId
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
  const threads = data.data.repository.pullRequest.reviewThreads;
  if (threads.pageInfo.hasNextPage) console.error("Warning: more than 100 review threads; only the first 100 are shown.");
  return threads.nodes;
}

async function getCIChecks(prNumber: number): Promise<CICheck[] | string> {
  const result = await $`gh pr checks ${prNumber} --json name,state,bucket,link`.quiet().nothrow();
  const out = result.stdout.toString().trim();
  if (out.startsWith("[")) return JSON.parse(out);
  return result.stderr.toString().trim() || "gh pr checks failed";
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

function generateMarkdown(
  pr: PRMetadata,
  threads: ReviewThread[],
  checks: CICheck[] | string
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
  if (typeof checks === "string") {
    md += `CI: unknown (${checks})\n\n`;
  } else if (checks.length === 0) {
    md += `No CI checks found.\n\n`;
  } else {
    md += `| Check | Status | Details |\n`;
    md += `|-------|--------|--------|\n`;
    for (const check of checks) {
      const link = check.link ? `[link](${check.link})` : "-";
      md += `| ${check.name} | ${check.bucket || check.state} | ${link} |\n`;
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
      md += `Thread ID: \`${thread.id}\` | Reply to comment ID: \`${firstComment.databaseId}\`\n`;
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
  if (args[0] === "--help" || args[0] === "-h") {
    console.log("Usage: bun pr-status.ts [PR_NUMBER]\nRun from the PR's repository. Prints metadata, CI checks and unresolved threads.");
    process.exit(0);
  }
  if (args[0] && !/^[1-9]\d*$/.test(args[0])) {
    console.error(`Not a PR number: ${args[0]}. Usage: bun pr-status.ts [PR_NUMBER]`);
    process.exit(2);
  }
  const providedPR = args[0] ? Number(args[0]) : undefined;

  try {
    // Get PR number (auto-detect or provided)
    let prNumber: number;
    try {
      prNumber = await getPRNumber(providedPR);
    } catch {
      console.error("No PR found for current branch. Create a PR first.");
      process.exit(1);
    }

    const [prMetadata, checks] = await Promise.all([
      getPRMetadata(prNumber),
      getCIChecks(prNumber),
    ]);
    const repoInfo = repoFromUrl(prMetadata.url);

    const threads = await getReviewThreads(
      repoInfo.owner,
      repoInfo.repo,
      prNumber
    );

    console.log(generateMarkdown(prMetadata, threads, checks));
  } catch (error) {
    console.error("Error fetching PR status:", error);
    process.exit(1);
  }
}

main();
