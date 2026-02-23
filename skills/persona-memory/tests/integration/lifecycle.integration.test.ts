import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { parseJsonOrThrow } from "../helpers/assert.ts";
import { runBunScript } from "../helpers/cli.ts";
import { createIsolatedTestEnv, type IsolatedTestEnv } from "../helpers/temp-env.ts";

describe("deterministic lifecycle integration", () => {
  let testEnv: IsolatedTestEnv;

  beforeEach(() => {
    testEnv = createIsolatedTestEnv("persona-memory-integration-lifecycle-");
  });

  afterEach(() => {
    testEnv.cleanup();
  });

  test("bootstrap -> remember -> consolidate -> recall -> session-start -> session-end", () => {
    const bootstrap = runBunScript("bootstrap.ts", ["--memory-home", testEnv.memoryHome, "--json"], {
      env: testEnv.env,
    });
    expect(bootstrap.exitCode).toBe(0);

    const remember = runBunScript(
      "remember.ts",
      [
        "--memory-home",
        testEnv.memoryHome,
        "--type",
        "decision",
        "--content",
        "Adopt deterministic gate for PR checks",
        "--confidence",
        "confirmed",
      ],
      { env: testEnv.env },
    );
    expect(remember.exitCode).toBe(0);

    const consolidate = runBunScript("consolidate.ts", ["--memory-home", testEnv.memoryHome, "--json"], {
      env: testEnv.env,
    });
    expect(consolidate.exitCode).toBe(0);

    const recall = runBunScript(
      "recall.ts",
      [
        "--memory-home",
        testEnv.memoryHome,
        "--cwd",
        "/tmp/project-a",
        "--query",
        "deterministic gate",
        "--format",
        "json",
      ],
      { env: testEnv.env },
    );
    expect(recall.exitCode).toBe(0);
    const recallPayload = parseJsonOrThrow<{ details: { result: { snippets: unknown[] } } }>(recall.stdout);
    expect(recallPayload.details.result.snippets.length).toBeGreaterThan(0);

    const sessionStart = runBunScript("session-start.ts", ["--memory-home", testEnv.memoryHome], {
      env: testEnv.env,
      stdin: JSON.stringify({ session_id: "s-flow", cwd: "/tmp/project-a" }),
    });
    expect(sessionStart.exitCode).toBe(0);

    const sessionEnd = runBunScript("session-end.ts", ["--memory-home", testEnv.memoryHome], {
      env: testEnv.env,
      stdin: JSON.stringify({ session_id: "s-flow", cwd: "/tmp/project-a" }),
    });
    expect(sessionEnd.exitCode).toBe(0);

    const decisionsPath = join(testEnv.memoryHome, "blocks", "decisions.md");
    expect(existsSync(decisionsPath)).toBe(true);
    const decisions = readFileSync(decisionsPath, "utf-8");
    expect(decisions).toContain("Adopt deterministic gate for PR checks");

    const eventsPath = join(testEnv.memoryHome, "events", "memory-events.jsonl");
    const eventsText = readFileSync(eventsPath, "utf-8");
    expect(eventsText).toContain('"status":"promoted"');

    const snapshotPath = join(testEnv.memoryHome, "runtime", "session-start", "s-flow.md");
    expect(existsSync(snapshotPath)).toBe(true);
  });
});
