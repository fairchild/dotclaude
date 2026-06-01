import { describe, expect, it } from "vitest";
import { githubTools } from "../runtime/tools/github.ts";

const byName = (name: string) => githubTools.find((t) => t.name === name)!;

describe("github tools", () => {
  it("registers pr_diff, pr_files, pr_post_review", () => {
    expect(byName("pr_diff")).toBeDefined();
    expect(byName("pr_files")).toBeDefined();
    expect(byName("pr_post_review")).toBeDefined();
  });

  it("pr_diff requires owner, repo, positive pull_number", () => {
    const tool = byName("pr_diff");
    expect(() => tool.schema.parse({ owner: "fairchild", repo: "dotclaude", pull_number: 12 })).not.toThrow();
    expect(() => tool.schema.parse({ owner: "", repo: "dotclaude", pull_number: 12 })).toThrow();
    expect(() => tool.schema.parse({ owner: "fairchild", repo: "dotclaude", pull_number: -1 })).toThrow();
    expect(() => tool.schema.parse({ owner: "fairchild", repo: "dotclaude", pull_number: 0 })).toThrow();
  });

  it("pr_post_review constrains event to the three GitHub values", () => {
    const tool = byName("pr_post_review");
    const base = { owner: "fairchild", repo: "dotclaude", pull_number: 12, body: "lgtm" };
    expect(() => tool.schema.parse({ ...base, event: "APPROVE" })).not.toThrow();
    expect(() => tool.schema.parse({ ...base, event: "REQUEST_CHANGES" })).not.toThrow();
    expect(() => tool.schema.parse({ ...base, event: "COMMENT" })).not.toThrow();
    expect(() => tool.schema.parse({ ...base, event: "MERGE" })).toThrow();
  });

  it("pr_post_review accepts inline comments with path/line/body", () => {
    const tool = byName("pr_post_review");
    const parsed = tool.schema.parse({
      owner: "fairchild",
      repo: "dotclaude",
      pull_number: 12,
      event: "COMMENT",
      body: "see inline",
      comments: [{ path: "managed-agents/README.md", line: 3, body: "typo" }],
    });
    expect((parsed as { comments: { length: number }[] }).comments).toHaveLength(1);
  });

  it("pr_post_review rejects empty body", () => {
    const tool = byName("pr_post_review");
    expect(() => tool.schema.parse({
      owner: "fairchild", repo: "dotclaude", pull_number: 12, event: "APPROVE", body: "",
    })).toThrow();
  });
});
