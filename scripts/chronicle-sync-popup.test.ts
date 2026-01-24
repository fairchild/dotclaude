/**
 * Unit tests for Chronicle Sync Popup utilities.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";

// Test in isolation - create temp directories
const TEST_HOME = "/tmp/chronicle-sync-test";
const TEST_CHRONICLE_DIR = `${TEST_HOME}/.claude/chronicle/blocks`;

describe("chronicle-sync-lib", () => {
  beforeEach(() => {
    // Setup test directories
    mkdirSync(TEST_CHRONICLE_DIR, { recursive: true });

    // Set HOME for tests
    process.env.HOME = TEST_HOME;
  });

  afterEach(() => {
    // Cleanup
    if (existsSync(TEST_HOME)) {
      rmSync(TEST_HOME, { recursive: true, force: true });
    }
  });

  describe("formatSyncPopupMessage", () => {
    test("formats message with pending threads and sessions", async () => {
      const { formatSyncPopupMessage } = await import("./chronicle-sync-lib");

      const preview = {
        sessionCount: 3,
        projectCount: 2,
        filesChanged: new Set(["file1.ts", "file2.ts"]),
        pendingThreads: [
          {
            text: "Fix authentication bug",
            project: "webapp",
            branch: "main",
            firstSeen: "2026-01-20T10:00:00Z",
            lastSeen: "2026-01-24T10:00:00Z",
            occurrences: 3,
            daysActive: 4,
          },
          {
            text: "Add unit tests",
            project: "api",
            branch: "feature",
            firstSeen: "2026-01-23T10:00:00Z",
            lastSeen: "2026-01-24T10:00:00Z",
            occurrences: 1,
            daysActive: 1,
          },
        ],
        recentSessions: [
          {
            timestamp: "2026-01-24T10:00:00Z",
            sessionId: "sess-1",
            project: "webapp",
            branch: "main",
            summary: "Fixed login flow and added error handling",
            accomplished: ["Fixed login"],
            pending: ["Add tests"],
          },
        ],
        lastSyncTime: new Date("2026-01-22T10:00:00Z"),
        newBlocksSinceSync: 3,
      };

      const message = formatSyncPopupMessage(preview);

      expect(message).toContain("3 sessions ready to sync");
      expect(message).toContain("PENDING THREADS");
      expect(message).toContain("webapp: Fix authentication bug");
      expect(message).toContain("(4d)"); // Days stale indicator
      expect(message).toContain("RECENT SESSIONS");
      expect(message).toContain("Fixed login flow");
      expect(message).toContain("Last sync:");
    });

    test("formats message with no pending threads", async () => {
      const { formatSyncPopupMessage } = await import("./chronicle-sync-lib");

      const preview = {
        sessionCount: 1,
        projectCount: 1,
        filesChanged: new Set(["file.ts"]),
        pendingThreads: [],
        recentSessions: [
          {
            timestamp: "2026-01-24T10:00:00Z",
            sessionId: "sess-1",
            project: "webapp",
            branch: "main",
            summary: "Code review",
            accomplished: ["Reviewed PR"],
            pending: [],
          },
        ],
        lastSyncTime: null,
        newBlocksSinceSync: 1,
      };

      const message = formatSyncPopupMessage(preview);

      expect(message).toContain("1 session ready to sync");
      expect(message).not.toContain("PENDING THREADS");
      expect(message).toContain("First sync");
    });

    test("truncates long summaries", async () => {
      const { formatSyncPopupMessage } = await import("./chronicle-sync-lib");

      const preview = {
        sessionCount: 1,
        projectCount: 1,
        filesChanged: new Set([]),
        pendingThreads: [],
        recentSessions: [
          {
            timestamp: "2026-01-24T10:00:00Z",
            sessionId: "sess-1",
            project: "webapp",
            branch: "main",
            summary: "This is a very long summary that should be truncated because it exceeds the maximum length",
            accomplished: [],
            pending: [],
          },
        ],
        lastSyncTime: new Date(),
        newBlocksSinceSync: 1,
      };

      const message = formatSyncPopupMessage(preview);

      expect(message).toContain("...");
      expect(message.length).toBeLessThan(500);
    });
  });

  describe("formatTimeAgo", () => {
    test("formats minutes ago", async () => {
      const { formatTimeAgo } = await import("./chronicle-sync-lib");

      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      expect(formatTimeAgo(tenMinutesAgo)).toBe("10 minutes ago");
    });

    test("formats hours ago", async () => {
      const { formatTimeAgo } = await import("./chronicle-sync-lib");

      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      expect(formatTimeAgo(twoHoursAgo)).toBe("2 hours ago");
    });

    test("formats days ago", async () => {
      const { formatTimeAgo } = await import("./chronicle-sync-lib");

      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      expect(formatTimeAgo(threeDaysAgo)).toBe("3 days ago");
    });

    test("formats just now", async () => {
      const { formatTimeAgo } = await import("./chronicle-sync-lib");

      const justNow = new Date();
      expect(formatTimeAgo(justNow)).toBe("just now");
    });
  });

  describe("aggregatePendingThreads", () => {
    test("groups similar pending items across sessions", async () => {
      const { aggregatePendingThreads } = await import("./chronicle-sync-lib");

      const blocks = [
        {
          timestamp: "2026-01-20T10:00:00Z",
          sessionId: "sess-1",
          project: "webapp",
          branch: "main",
          summary: "Session 1",
          accomplished: [],
          pending: ["Fix auth bug"],
        },
        {
          timestamp: "2026-01-22T10:00:00Z",
          sessionId: "sess-2",
          project: "webapp",
          branch: "main",
          summary: "Session 2",
          accomplished: [],
          pending: ["fix auth bug"], // Same pending, different case
        },
        {
          timestamp: "2026-01-24T10:00:00Z",
          sessionId: "sess-3",
          project: "api",
          branch: "main",
          summary: "Session 3",
          accomplished: [],
          pending: ["Add tests"],
        },
      ];

      const threads = aggregatePendingThreads(blocks);

      expect(threads).toHaveLength(2);

      const authThread = threads.find(t => t.text.toLowerCase().includes("auth"));
      expect(authThread).toBeDefined();
      expect(authThread!.occurrences).toBe(2);
      expect(authThread!.project).toBe("webapp");
    });

    test("calculates days active correctly", async () => {
      const { aggregatePendingThreads } = await import("./chronicle-sync-lib");

      const fiveDaysAgo = new Date();
      fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

      const blocks = [
        {
          timestamp: fiveDaysAgo.toISOString(),
          sessionId: "sess-1",
          project: "webapp",
          branch: "main",
          summary: "Old session",
          accomplished: [],
          pending: ["Old pending item"],
        },
      ];

      const threads = aggregatePendingThreads(blocks);

      expect(threads).toHaveLength(1);
      expect(threads[0].daysActive).toBeGreaterThanOrEqual(5);
    });
  });

  describe("generateSuggestions", () => {
    test("prioritizes stalled threads", async () => {
      const { generateSuggestions } = await import("./chronicle-sync-lib");

      const preview = {
        sessionCount: 2,
        projectCount: 2,
        filesChanged: new Set<string>(),
        pendingThreads: [
          {
            text: "Stalled work",
            project: "stalled-project",
            branch: "main",
            firstSeen: "2026-01-10T10:00:00Z",
            lastSeen: "2026-01-20T10:00:00Z",
            occurrences: 5,
            daysActive: 14, // Very stale
          },
          {
            text: "Recent work",
            project: "active-project",
            branch: "main",
            firstSeen: "2026-01-23T10:00:00Z",
            lastSeen: "2026-01-24T10:00:00Z",
            occurrences: 2,
            daysActive: 1,
          },
        ],
        recentSessions: [],
        lastSyncTime: new Date(),
        newBlocksSinceSync: 2,
      };

      const [sug1, sug2] = generateSuggestions(preview);

      // First suggestion should be the stalled thread
      expect(sug1.type).toBe("address_stale");
      expect(sug1.project).toBe("stalled-project");
    });

    test("returns fallback suggestions when no pending", async () => {
      const { generateSuggestions } = await import("./chronicle-sync-lib");

      const preview = {
        sessionCount: 0,
        projectCount: 0,
        filesChanged: new Set<string>(),
        pendingThreads: [],
        recentSessions: [],
        lastSyncTime: new Date(),
        newBlocksSinceSync: 0,
      };

      const [sug1, sug2] = generateSuggestions(preview);

      expect(sug1).toBeDefined();
      expect(sug2).toBeDefined();
      expect(sug1.type).toBe("explore_connection");
    });

    test("always returns exactly two suggestions", async () => {
      const { generateSuggestions } = await import("./chronicle-sync-lib");

      // Test with many pending threads
      const manyThreads = Array.from({ length: 10 }, (_, i) => ({
        text: `Thread ${i}`,
        project: `project-${i}`,
        branch: "main",
        firstSeen: "2026-01-20T10:00:00Z",
        lastSeen: "2026-01-24T10:00:00Z",
        occurrences: 1,
        daysActive: i,
      }));

      const preview = {
        sessionCount: 10,
        projectCount: 10,
        filesChanged: new Set<string>(),
        pendingThreads: manyThreads,
        recentSessions: [],
        lastSyncTime: new Date(),
        newBlocksSinceSync: 10,
      };

      const suggestions = generateSuggestions(preview);

      expect(suggestions).toHaveLength(2);
    });
  });

  describe("loadAllBlocks", () => {
    test("loads blocks from disk", async () => {
      // Write test blocks
      writeFileSync(
        `${TEST_CHRONICLE_DIR}/2026-01-24-test.json`,
        JSON.stringify({
          timestamp: "2026-01-24T10:00:00Z",
          sessionId: "test-1",
          project: "test-project",
          branch: "main",
          summary: "Test session",
          accomplished: ["Did something"],
          pending: ["Do more"],
        })
      );

      const { loadAllBlocks } = await import("./chronicle-sync-lib");
      const blocks = loadAllBlocks();

      expect(blocks).toHaveLength(1);
      expect(blocks[0].project).toBe("test-project");
    });

    test("skips malformed files", async () => {
      writeFileSync(`${TEST_CHRONICLE_DIR}/valid.json`, JSON.stringify({
        timestamp: "2026-01-24T10:00:00Z",
        sessionId: "valid",
        project: "valid",
        branch: "main",
        summary: "Valid",
        accomplished: [],
        pending: [],
      }));
      writeFileSync(`${TEST_CHRONICLE_DIR}/invalid.json`, "not valid json");

      const { loadAllBlocks } = await import("./chronicle-sync-lib");
      const blocks = loadAllBlocks();

      expect(blocks).toHaveLength(1);
      expect(blocks[0].sessionId).toBe("valid");
    });

    test("returns empty array when directory missing", async () => {
      rmSync(TEST_CHRONICLE_DIR, { recursive: true, force: true });

      const { loadAllBlocks } = await import("./chronicle-sync-lib");
      const blocks = loadAllBlocks();

      expect(blocks).toEqual([]);
    });
  });

  describe("getLastSyncTime", () => {
    test("returns null when no sync file", async () => {
      const { getLastSyncTime } = await import("./chronicle-sync-lib");
      const time = getLastSyncTime();

      expect(time).toBeNull();
    });

    test("reads timestamp from file", async () => {
      const timestamp = Math.floor(Date.now() / 1000);
      writeFileSync(`${TEST_HOME}/.claude/.chronicle-last-sync`, timestamp.toString());

      const { getLastSyncTime } = await import("./chronicle-sync-lib");
      const time = getLastSyncTime();

      expect(time).toBeInstanceOf(Date);
      expect(Math.floor(time!.getTime() / 1000)).toBe(timestamp);
    });
  });

});
