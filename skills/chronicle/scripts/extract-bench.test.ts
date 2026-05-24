import { describe, test, expect } from "bun:test";
import { classify, isFallbackSummary, FALLBACK_PATTERNS } from "./extract-bench.ts";
import type { ChronicleBlock } from "./types.ts";

const base: ChronicleBlock = {
  timestamp: "2026-05-24T00:00:00Z",
  sessionId: "test",
  project: "p",
  branch: null,
  summary: "",
  accomplished: [],
  pending: [],
};

describe("isFallbackSummary", () => {
  test("matches all three fallbackEntry templates", () => {
    expect(isFallbackSummary("Worked on workspaces: modified a.ts, b.ts and 3 more")).toBe(true);
    expect(isFallbackSummary("workspaces session with 3 actions")).toBe(true);
    expect(isFallbackSummary("workspaces session (12 messages)")).toBe(true);
  });

  test("rejects narrative summaries", () => {
    expect(isFallbackSummary("Designed the chronicle MVP and shipped the curator agent.")).toBe(false);
    expect(isFallbackSummary("Fixed auth bug in login flow.")).toBe(false);
  });

  test("FALLBACK_PATTERNS stays in sync with extract-lib.fallbackEntry()", () => {
    expect(FALLBACK_PATTERNS).toHaveLength(3);
  });
});

describe("classify", () => {
  test("fallback summary wins regardless of other fields", () => {
    const b = { ...base, summary: "Worked on p: modified x.ts and 2 more" };
    expect(classify(b)).toBe("fallback");
  });

  test("curator: 5+ accomplished + challenges + 2+ nextSteps", () => {
    const b: ChronicleBlock = {
      ...base,
      summary: "Built the chronicle MVP.",
      accomplished: ["a", "b", "c", "d", "e"],
      challenges: ["x"],
      nextSteps: ["y", "z"],
    };
    expect(classify(b)).toBe("curator");
  });

  test("curator: notes field alone qualifies", () => {
    const b: ChronicleBlock = {
      ...base,
      summary: "Built the chronicle MVP.",
      notes: "Updated across sessions.",
    };
    expect(classify(b)).toBe("curator");
  });

  test("narrative: has challenges or nextSteps but below curator bar", () => {
    const b: ChronicleBlock = {
      ...base,
      summary: "Investigated the test failure.",
      accomplished: ["a"],
      nextSteps: ["follow up tomorrow"],
    };
    expect(classify(b)).toBe("narrative");
  });

  test("thin-other: not fallback, no challenges/nextSteps/notes", () => {
    const b: ChronicleBlock = {
      ...base,
      summary: "Ran some commands.",
      accomplished: ["did a thing"],
    };
    expect(classify(b)).toBe("thin-other");
  });
});
