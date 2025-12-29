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
  test("returns timestamp when no messages", async () => {
    const { evolveTitle } = await import("./generate-session-title-testable.ts");

    const title = await evolveTitle(null, null, null);

    expect(title).toMatch(/^Session \d{2}:\d{2} [AP]M$/);
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

// --- Integration Tests ---

describe("integration", () => {
  const SESSION_ID = "test-session-123";
  const PROJECT_DIR = join(TEST_DIR, "session-titles", "test-project");

  beforeEach(() => {
    mkdirSync(PROJECT_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  test("creates title file", async () => {
    const transcriptPath = createTranscript(SAMPLE_TRANSCRIPT);
    const titleFile = join(PROJECT_DIR, `${SESSION_ID}.txt`);

    const { writeTitle } = await import("./generate-session-title-testable.ts");
    await writeTitle(PROJECT_DIR, SESSION_ID, null, transcriptPath);

    expect(existsSync(titleFile)).toBe(true);
    const content = readFileSync(titleFile, "utf-8");
    expect(content).toBe("Help me fix the login bug");
  });

  test("creates log file on title change", async () => {
    const transcriptPath = createTranscript(SAMPLE_TRANSCRIPT);
    const logFile = join(PROJECT_DIR, `${SESSION_ID}.log`);

    const { writeTitle } = await import("./generate-session-title-testable.ts");
    await writeTitle(PROJECT_DIR, SESSION_ID, null, transcriptPath);

    expect(existsSync(logFile)).toBe(true);
    const content = readFileSync(logFile, "utf-8");
    expect(content).toContain("Help me fix the login bug");
    expect(content).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO timestamp
  });

  test("does not append to log when title unchanged", async () => {
    const transcriptPath = createTranscript(SAMPLE_TRANSCRIPT);
    const titleFile = join(PROJECT_DIR, `${SESSION_ID}.txt`);
    const logFile = join(PROJECT_DIR, `${SESSION_ID}.log`);

    // Pre-set the title to match what would be generated
    writeFileSync(titleFile, "Help me fix the login bug");

    const { writeTitle } = await import("./generate-session-title-testable.ts");
    await writeTitle(PROJECT_DIR, SESSION_ID, "Help me fix the login bug", transcriptPath);

    // Log should not exist since title didn't change
    expect(existsSync(logFile)).toBe(false);
  });
});
