import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";

// Test fixtures
const TEST_DIR = "/tmp/session-title-tests";
const SAMPLE_TRANSCRIPT = `
{"type":"file-history-snapshot","messageId":"abc"}
{"message":{"role":"user","content":"Help me fix the login bug"},"type":"user"}
{"message":{"role":"assistant","content":[{"type":"text","text":"I'll help you fix that."}]},"type":"assistant"}
{"message":{"role":"user","content":"<command-name>/status</command-name>"},"type":"user"}
{"message":{"role":"user","content":"Actually, let's refactor the auth module instead"},"type":"user"}
`.trim();

const SAMPLE_TRANSCRIPT_ARRAY_CONTENT = `
{"message":{"role":"user","content":[{"type":"text","text":"Review the API endpoints"}]},"type":"user"}
{"message":{"role":"assistant","content":[{"type":"text","text":"Looking at endpoints..."}]},"type":"assistant"}
`.trim();

// Helper to create test transcript
function createTranscript(content: string): string {
  const path = join(TEST_DIR, "transcript.jsonl");
  writeFileSync(path, content);
  return path;
}

// --- Unit Tests for getBookendMessages ---

describe("getBookendMessages", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  test("extracts first and last user messages", async () => {
    const path = createTranscript(SAMPLE_TRANSCRIPT);

    // Import fresh to avoid caching issues
    const { getBookendMessages } = await import("./generate-session-title-testable.ts");

    const result = getBookendMessages(path);

    expect(result.first).toBe("Help me fix the login bug");
    expect(result.last).toBe("Actually, let's refactor the auth module instead");
  });

  test("skips command messages", async () => {
    const path = createTranscript(SAMPLE_TRANSCRIPT);
    const { getBookendMessages } = await import("./generate-session-title-testable.ts");

    const result = getBookendMessages(path);

    // Should not include the /status command
    expect(result.first).not.toContain("command");
    expect(result.last).not.toContain("command");
  });

  test("handles array content format", async () => {
    const path = createTranscript(SAMPLE_TRANSCRIPT_ARRAY_CONTENT);
    const { getBookendMessages } = await import("./generate-session-title-testable.ts");

    const result = getBookendMessages(path);

    expect(result.first).toBe("Review the API endpoints");
    expect(result.last).toBe("Review the API endpoints"); // Same message, first === last
  });

  test("returns nulls for missing file", async () => {
    const { getBookendMessages } = await import("./generate-session-title-testable.ts");

    const result = getBookendMessages("/nonexistent/path.jsonl");

    expect(result.first).toBeNull();
    expect(result.last).toBeNull();
  });

  test("returns nulls for empty transcript", async () => {
    const path = createTranscript("");
    const { getBookendMessages } = await import("./generate-session-title-testable.ts");

    const result = getBookendMessages(path);

    expect(result.first).toBeNull();
    expect(result.last).toBeNull();
  });

  test("truncates long messages to 100 chars", async () => {
    const longMessage = "A".repeat(200);
    const transcript = `{"message":{"role":"user","content":"${longMessage}"},"type":"user"}`;
    const path = createTranscript(transcript);
    const { getBookendMessages } = await import("./generate-session-title-testable.ts");

    const result = getBookendMessages(path);

    expect(result.first?.length).toBeLessThanOrEqual(100);
  });

  test("handles sentence boundaries correctly", async () => {
    const transcript = `{"message":{"role":"user","content":"Check the ~/.claude directory. Then fix it."},"type":"user"}`;
    const path = createTranscript(transcript);
    const { getBookendMessages } = await import("./generate-session-title-testable.ts");

    const result = getBookendMessages(path);

    // Should get first sentence, not break on ~/.
    expect(result.first).toBe("Check the ~/.claude directory.");
  });
});

// --- Unit Tests for getProjectName ---

describe("getProjectName", () => {
  test("extracts name from git remote URL", async () => {
    const { getProjectName } = await import("./generate-session-title-testable.ts");

    // This will use the actual git repo we're in
    const name = getProjectName(process.env.HOME + "/.claude");

    expect(name).toBe("dotclaude");
  });

  test("falls back to basename for non-git directory", async () => {
    const { getProjectName } = await import("./generate-session-title-testable.ts");

    const name = getProjectName("/tmp");

    expect(name).toBe("tmp");
  });
});

// --- Unit Tests for evolveTitle ---

describe("evolveTitle", () => {
  test("returns project session fallback when no messages", async () => {
    const { evolveTitle } = await import("./generate-session-title-testable.ts");

    const title = await evolveTitle(null, null, null);

    // Legacy wrapper uses "unknown" as project name
    expect(title).toBe("unknown session");
  });

  test("seeds with first message when no current title", async () => {
    const { evolveTitle } = await import("./generate-session-title-testable.ts");

    const title = await evolveTitle(null, "Fix the login bug", "Fix the login bug");

    // Without API, should return the seed message truncated
    expect(title).toBe("Fix the login bug");
  });

  test("seeds with first message when current title is timestamp", async () => {
    const { evolveTitle } = await import("./generate-session-title-testable.ts");

    const title = await evolveTitle("Session 10:30 AM", "Fix the login bug", "Now refactoring");

    // Should re-seed since current is just a timestamp
    expect(title).toBe("Fix the login bug");
  });

  test("keeps current title without API when messages differ", async () => {
    const { evolveTitle } = await import("./generate-session-title-testable.ts");

    const title = await evolveTitle(
      "Fixing login bugs",
      "Fix the login bug",
      "Now add rate limiting" // Different message
    );

    // Without API, falls back to keeping current title
    expect(title).toBe("Fixing login bugs");
  });
});

// --- Unit Tests for extractSessionContext ---

describe("extractSessionContext", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  test("extracts git branch from user message metadata", async () => {
    const transcript = `
{"type":"user","message":{"role":"user","content":"Fix the auth bug"},"gitBranch":"feat/add-oauth"}
`.trim();
    const path = createTranscript(transcript);
    const { extractSessionContext } = await import("./generate-session-title-testable.ts");

    const ctx = extractSessionContext(path, "test-project");

    expect(ctx.gitBranch).toBe("feat/add-oauth");
    expect(ctx.firstMessage).toBe("Fix the auth bug");
  });

  test("extracts explicit summary from transcript", async () => {
    const transcript = `
{"type":"summary","summary":"PR #95 Phase 1 Refactoring: Structural Decomposition"}
{"type":"user","message":{"role":"user","content":"Continue the refactor"},"gitBranch":"main"}
`.trim();
    const path = createTranscript(transcript);
    const { extractSessionContext } = await import("./generate-session-title-testable.ts");

    const ctx = extractSessionContext(path, "test-project");

    expect(ctx.explicitSummary).toBe("PR #95 Phase 1 Refactoring: Structural Decomposition");
  });

  test("extracts modified files from tool calls", async () => {
    const transcript = `
{"type":"user","message":{"role":"user","content":"Update the auth module"}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/src/auth.ts"}},{"type":"tool_use","name":"Write","input":{"file_path":"/src/utils.ts"}}]}}
`.trim();
    const path = createTranscript(transcript);
    const { extractSessionContext } = await import("./generate-session-title-testable.ts");

    const ctx = extractSessionContext(path, "test-project");

    expect(ctx.modifiedFiles).toContain("auth.ts");
    expect(ctx.modifiedFiles).toContain("utils.ts");
  });

  test("counts user messages", async () => {
    const path = createTranscript(SAMPLE_TRANSCRIPT);
    const { extractSessionContext } = await import("./generate-session-title-testable.ts");

    const ctx = extractSessionContext(path, "test-project");

    expect(ctx.messageCount).toBe(2); // Two valid user messages
  });

  test("returns empty context for missing file", async () => {
    const { extractSessionContext } = await import("./generate-session-title-testable.ts");

    const ctx = extractSessionContext("/nonexistent/path.jsonl", "test-project");

    expect(ctx.firstMessage).toBeNull();
    expect(ctx.gitBranch).toBeNull();
    expect(ctx.modifiedFiles).toEqual([]);
  });
});

// --- Unit Tests for formatTitleWithShift ---

describe("formatTitleWithShift", () => {
  test("returns plain title when shiftCount is 0", async () => {
    const { formatTitleWithShift } = await import("./generate-session-title-testable.ts");

    expect(formatTitleWithShift("Fix auth bug", 0)).toBe("Fix auth bug");
  });

  test("adds numeric prefix when shiftCount > 0", async () => {
    const { formatTitleWithShift } = await import("./generate-session-title-testable.ts");

    expect(formatTitleWithShift("Debug CI tests", 1)).toBe("(1) Debug CI tests");
    expect(formatTitleWithShift("Refactor auth", 3)).toBe("(3) Refactor auth");
  });

  test("handles negative shiftCount", async () => {
    const { formatTitleWithShift } = await import("./generate-session-title-testable.ts");

    expect(formatTitleWithShift("Some title", -1)).toBe("Some title");
  });
});

// --- Unit Tests for fallback behavior ---

describe("fallback chain", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  test("uses branch name as fallback when available", async () => {
    const transcript = `
{"type":"user","message":{"role":"user","content":"short"},"gitBranch":"feat/add-oauth-flow"}
`.trim();
    const path = createTranscript(transcript);
    const { extractSessionContext, evolveTitleWithContext } = await import("./generate-session-title-testable.ts");

    const ctx = extractSessionContext(path, "test-project");
    // "short" is < 10 chars so it's skipped, branch is used
    const result = await evolveTitleWithContext(null, ctx, null);

    expect(result.title).toBe("add oauth flow");
  });

  test("uses first message when branch is main", async () => {
    const transcript = `
{"type":"user","message":{"role":"user","content":"Help me fix the login bug"},"gitBranch":"main"}
`.trim();
    const path = createTranscript(transcript);
    const { extractSessionContext, evolveTitleWithContext } = await import("./generate-session-title-testable.ts");

    const ctx = extractSessionContext(path, "test-project");
    const result = await evolveTitleWithContext(null, ctx, null);

    expect(result.title).toBe("Help me fix the login bug");
  });

  test("uses project name session when no other context", async () => {
    const { extractSessionContext, evolveTitleWithContext } = await import("./generate-session-title-testable.ts");

    const ctx = extractSessionContext(undefined, "my-project");
    const result = await evolveTitleWithContext(null, ctx, null);

    expect(result.title).toBe("my-project session");
  });

  test("prefers explicit summary over other fallbacks", async () => {
    const transcript = `
{"type":"summary","summary":"Important feature work"}
{"type":"user","message":{"role":"user","content":"short"},"gitBranch":"feat/something"}
`.trim();
    const path = createTranscript(transcript);
    const { extractSessionContext, evolveTitleWithContext } = await import("./generate-session-title-testable.ts");

    const ctx = extractSessionContext(path, "test-project");
    const result = await evolveTitleWithContext(null, ctx, null);

    expect(result.title).toBe("Important feature work");
  });
});

// --- Integration Tests ---

describe("integration", () => {
  const SESSION_ID = "test-session-123";
  const PROJECT_DIR = join(TEST_DIR, "session-titles", "test-project");
  let savedApiKey: string | undefined;

  beforeEach(() => {
    mkdirSync(PROJECT_DIR, { recursive: true });
    // Disable API key to test fallback behavior
    savedApiKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    // Restore API key
    if (savedApiKey) process.env.ANTHROPIC_API_KEY = savedApiKey;
  });

  test("creates title and metadata files", async () => {
    const transcriptPath = createTranscript(SAMPLE_TRANSCRIPT);
    const titleFile = join(PROJECT_DIR, `${SESSION_ID}.txt`);
    const metaFile = join(PROJECT_DIR, `${SESSION_ID}.meta`);

    const { writeTitle } = await import("./generate-session-title-testable.ts");
    await writeTitle(PROJECT_DIR, SESSION_ID, null, transcriptPath, "test-project");

    expect(existsSync(titleFile)).toBe(true);
    expect(existsSync(metaFile)).toBe(true);

    const content = readFileSync(titleFile, "utf-8");
    expect(content).toBe("Help me fix the login bug");

    const meta = JSON.parse(readFileSync(metaFile, "utf-8"));
    expect(meta.title).toBe("Help me fix the login bug");
    expect(meta.shiftCount).toBe(0);
  });

  test("creates log file on title change", async () => {
    const transcriptPath = createTranscript(SAMPLE_TRANSCRIPT);
    const logFile = join(PROJECT_DIR, `${SESSION_ID}.log`);

    const { writeTitle } = await import("./generate-session-title-testable.ts");
    await writeTitle(PROJECT_DIR, SESSION_ID, null, transcriptPath, "test-project");

    expect(existsSync(logFile)).toBe(true);
    const content = readFileSync(logFile, "utf-8");
    expect(content).toContain("Help me fix the login bug");
    expect(content).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO timestamp
  });

  test("does not append to log when context unchanged", async () => {
    const transcriptPath = createTranscript(SAMPLE_TRANSCRIPT);
    const titleFile = join(PROJECT_DIR, `${SESSION_ID}.txt`);
    const metaFile = join(PROJECT_DIR, `${SESSION_ID}.meta`);
    const logFile = join(PROJECT_DIR, `${SESSION_ID}.log`);

    // Pre-set the title and metadata to match what would be generated
    writeFileSync(titleFile, "Help me fix the login bug");
    const lastMessage = "Actually, let's refactor the auth module instead";
    // Compute hash the same way as the module
    let hash = 0;
    for (let i = 0; i < lastMessage.length; i++) {
      hash = ((hash << 5) - hash) + lastMessage.charCodeAt(i);
      hash |= 0;
    }
    writeFileSync(metaFile, JSON.stringify({
      title: "Help me fix the login bug",
      shiftCount: 0,
      lastMessageHash: hash.toString(36),
      lastMessage: lastMessage
    }));

    const { writeTitle } = await import("./generate-session-title-testable.ts");
    await writeTitle(PROJECT_DIR, SESSION_ID, "Help me fix the login bug", transcriptPath, "test-project");

    // Log should not exist since context didn't change
    expect(existsSync(logFile)).toBe(false);
  });

  test("tracks shift count in metadata", async () => {
    const metaFile = join(PROJECT_DIR, `${SESSION_ID}.meta`);

    // Set up initial metadata with shift count
    writeFileSync(metaFile, JSON.stringify({
      title: "Initial task",
      shiftCount: 2,
      lastMessageHash: "old-hash",
      lastMessage: "old message"
    }));

    const transcriptPath = createTranscript(SAMPLE_TRANSCRIPT);
    const { writeTitle } = await import("./generate-session-title-testable.ts");

    // This should update since message changed, but without API it keeps current title
    await writeTitle(PROJECT_DIR, SESSION_ID, "Initial task", transcriptPath, "test-project");

    const meta = JSON.parse(readFileSync(metaFile, "utf-8"));
    // Without API, should keep existing shift count
    expect(meta.shiftCount).toBe(2);
  });
});
