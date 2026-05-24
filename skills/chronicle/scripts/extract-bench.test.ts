import { describe, test, expect } from "bun:test";
import { classify, isFallbackSummary, FALLBACK_PATTERNS } from "./extract-bench.ts";
import { fallbackEntry, type SessionContext } from "./extract-lib.ts";
import type { ChronicleBlock } from "./types.ts";

const baseBlock: ChronicleBlock = {
  timestamp: "2026-05-24T00:00:00Z",
  sessionId: "test",
  project: "p",
  branch: null,
  summary: "",
  accomplished: [],
  pending: [],
};

const baseCtx: SessionContext = {
  projectName: "workspaces",
  worktreeName: null,
  gitBranch: null,
  messageCount: 0,
  userMessages: [],
  assistantActions: [],
  filesModified: [],
  toolsUsed: new Set(),
};

describe("isFallbackSummary", () => {
  // The strong contract: every summary the live fallbackEntry() can emit
  // must be recognized. If extract-lib.ts changes its templates, this fails
  // until FALLBACK_PATTERNS is updated to match.
  test("recognizes the 'modified files' branch of fallbackEntry()", () => {
    const entry = fallbackEntry({
      ...baseCtx,
      filesModified: ["a.ts", "b.ts", "c.ts", "d.ts"],
    });
    expect(isFallbackSummary(entry.summary)).toBe(true);
  });

  test("recognizes the 'N actions' branch of fallbackEntry()", () => {
    const entry = fallbackEntry({
      ...baseCtx,
      assistantActions: ["ran: ls", "ran: pwd", "ran: cd /tmp"],
    });
    expect(isFallbackSummary(entry.summary)).toBe(true);
  });

  test("recognizes the 'N messages' branch of fallbackEntry()", () => {
    const entry = fallbackEntry({
      ...baseCtx,
      messageCount: 12,
    });
    expect(isFallbackSummary(entry.summary)).toBe(true);
  });

  test("rejects narrative summaries", () => {
    expect(isFallbackSummary("Designed the chronicle MVP and shipped the curator agent.")).toBe(false);
    expect(isFallbackSummary("Fixed auth bug in login flow.")).toBe(false);
  });

  test("FALLBACK_PATTERNS has one regex per fallbackEntry() branch", () => {
    expect(FALLBACK_PATTERNS).toHaveLength(3);
  });
});

describe("classify", () => {
  test("fallback summary wins regardless of other fields", () => {
    const b = { ...baseBlock, summary: "Worked on p: modified x.ts and 2 more" };
    expect(classify(b)).toBe("fallback");
  });

  test("curator: 5+ accomplished + challenges + 2+ nextSteps", () => {
    const b: ChronicleBlock = {
      ...baseBlock,
      summary: "Built the chronicle MVP.",
      accomplished: ["a", "b", "c", "d", "e"],
      challenges: ["x"],
      nextSteps: ["y", "z"],
    };
    expect(classify(b)).toBe("curator");
  });

  test("curator: notes field alone qualifies (curator-only field)", () => {
    const b: ChronicleBlock = {
      ...baseBlock,
      summary: "Built the chronicle MVP.",
      notes: "Updated across sessions.",
    };
    expect(classify(b)).toBe("curator");
  });

  test("narrative: has challenges or nextSteps but below curator bar", () => {
    const b: ChronicleBlock = {
      ...baseBlock,
      summary: "Investigated the test failure.",
      accomplished: ["a"],
      nextSteps: ["follow up tomorrow"],
    };
    expect(classify(b)).toBe("narrative");
  });

  test("thin-other: not fallback, no challenges/nextSteps/notes", () => {
    const b: ChronicleBlock = {
      ...baseBlock,
      summary: "Ran some commands.",
      accomplished: ["did a thing"],
    };
    expect(classify(b)).toBe("thin-other");
  });
});
