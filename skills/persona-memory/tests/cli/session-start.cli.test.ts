import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { join } from "path";
import { parseJsonOrThrow } from "../helpers/assert.ts";
import { runBunScript } from "../helpers/cli.ts";
import { createIsolatedTestEnv, type IsolatedTestEnv } from "../helpers/temp-env.ts";

describe("session-start CLI", () => {
  let testEnv: IsolatedTestEnv;

  beforeEach(() => {
    testEnv = createIsolatedTestEnv("persona-memory-cli-session-start-");
  });

  afterEach(() => {
    testEnv.cleanup();
  });

  test("writes snapshot and returns non-blocking hook payload", () => {
    const hookInput = JSON.stringify({ session_id: "session-123", cwd: "/tmp/project-a" });
    const run = runBunScript("session-start.ts", ["--memory-home", testEnv.memoryHome], {
      env: testEnv.env,
      stdin: hookInput,
    });

    expect(run.exitCode).toBe(0);
    const payload = parseJsonOrThrow<{
      continue: boolean;
      ok: boolean;
      code: string;
      details: { snapshot_path: string };
    }>(run.stdout);

    expect(payload.continue).toBe(true);
    expect(payload.ok).toBe(true);
    expect(payload.code).toBe("SESSION_START_OK");
    expect(existsSync(payload.details.snapshot_path)).toBe(true);

    const expectedPath = join(testEnv.memoryHome, "runtime", "session-start", "session-123.md");
    expect(payload.details.snapshot_path).toBe(expectedPath);
  });
});
