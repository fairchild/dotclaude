/**
 * GitHub tools for the pr-review agent. Each tool hits api.github.com via
 * ctx.fetch, so the egress layer can inject the GitHub token by reference
 * name - the agent never sees the credential value.
 *
 * Required egress policy:
 *   { host: "api.github.com",
 *     action: { type: "inject_header", header: "authorization",
 *               value_template: "Bearer ${ref:GITHUB_PR_TOKEN}" } }
 *
 * These tools replace what an agent in a microVM would do via `gh pr diff` /
 * `gh pr review`. Calling the API directly keeps us in the isolate sandbox
 * model without needing a real shell.
 */
import { z } from "zod";
import { defineTool, type ToolDefinition } from "./tool-registry.ts";

const repoSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  pull_number: z.number().int().positive(),
});

const ghHeaders = {
  accept: "application/vnd.github+json",
  "x-github-api-version": "2022-11-28",
  "user-agent": "managed-agents-cloudflare/pr-review",
};

const prDiff = defineTool({
  name: "pr_diff",
  description: "Return the unified diff of a pull request as text.",
  schema: repoSchema,
  handler: async ({ owner, repo, pull_number }, ctx) => {
    const res = await ctx.fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${pull_number}`,
      { headers: { ...ghHeaders, accept: "application/vnd.github.diff" } },
    );
    if (!res.ok) throw new Error(`pr_diff failed: ${res.status} ${await res.text()}`);
    return { diff: await res.text() };
  },
});

const prFiles = defineTool({
  name: "pr_files",
  description:
    "List files changed in a pull request with per-file additions, deletions, status, and patch. Returns up to 100 files; PRs larger than that need pagination support not present in V1.",
  schema: repoSchema,
  handler: async ({ owner, repo, pull_number }, ctx) => {
    const res = await ctx.fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${pull_number}/files?per_page=100`,
      { headers: ghHeaders },
    );
    if (!res.ok) throw new Error(`pr_files failed: ${res.status} ${await res.text()}`);
    const files = (await res.json()) as Array<{
      filename: string;
      status: string;
      additions: number;
      deletions: number;
      changes: number;
      patch?: string;
    }>;
    return { files };
  },
});

const reviewCommentSchema = z.object({
  path: z.string(),
  /** Line number in the diff hunk, per GitHub's review-comment API. */
  line: z.number().int().positive(),
  body: z.string().min(1),
});

const prPostReview = defineTool({
  name: "pr_post_review",
  description:
    "Post a pull request review. `event` chooses the verdict: APPROVE, REQUEST_CHANGES, or COMMENT. `body` is the top-level summary; `comments` are optional inline file/line comments.",
  schema: repoSchema.extend({
    event: z.enum(["APPROVE", "REQUEST_CHANGES", "COMMENT"]),
    body: z.string().min(1),
    comments: z.array(reviewCommentSchema).optional(),
  }),
  handler: async ({ owner, repo, pull_number, event, body, comments }, ctx) => {
    const res = await ctx.fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls/${pull_number}/reviews`,
      {
        method: "POST",
        headers: { ...ghHeaders, "content-type": "application/json" },
        body: JSON.stringify({ event, body, comments: comments ?? [] }),
      },
    );
    if (!res.ok) throw new Error(`pr_post_review failed: ${res.status} ${await res.text()}`);
    const result = (await res.json()) as { id: number; html_url: string; state: string };
    return { id: result.id, url: result.html_url, state: result.state };
  },
});

export const githubTools: ToolDefinition[] = [prDiff, prFiles, prPostReview];
