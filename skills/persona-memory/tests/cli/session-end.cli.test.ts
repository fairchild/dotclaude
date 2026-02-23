import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { parseJsonOrThrow } from "../helpers/assert.ts";
import { runBunScript } from "../helpers/cli.ts";
import { createIsolatedTestEnv, type IsolatedTestEnv } from "../helpers/temp-env.ts";

describe("session-end CLI", () => {
  let testEnv: IsolatedTestEnv;

  beforeEach(() => {
    testEnv = createIsolatedTestEnv("persona-memory-cli-session-end-");
  });

  afterEach(() => {
    testEnv.cleanup();
  });

  test("consolidates and returns non-blocking hook payload", () => {
    const remember = runBunScript(
      "remember.ts",
      [
        "--memory-home",
        testEnv.memoryHome,
        "--type",
        "thread",
        "--content",
        "Finalize ci workflow",
        "--confidence",
        "confirmed",
      ],
      { env: testEnv.env },
    );
    expect(remember.exitCode).toBe(0);

    const run = runBunScript("session-end.ts", ["--memory-home", testEnv.memoryHome], {
      env: testEnv.env,
      stdin: JSON.stringify({ session_id: "session-abc", cwd: "/tmp/project-a" }),
    });

    expect(run.exitCode).toBe(0);
    const payload = parseJsonOrThrow<{
      continue: boolean;
      ok: boolean;
      code: string;
      details: { result: { processed: number } };
    }>(run.stdout);

    expect(payload.continue).toBe(true);
    expect(payload.ok).toBe(true);
    expect(payload.code).toBe("SESSION_END_OK");
    expect(payload.details.result.processed).toBe(1);
  });
});
