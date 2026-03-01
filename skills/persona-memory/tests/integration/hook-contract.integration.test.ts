import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { parseJsonOrThrow } from "../helpers/assert.ts";
import { runBunScript } from "../helpers/cli.ts";
import { createIsolatedTestEnv, type IsolatedTestEnv } from "../helpers/temp-env.ts";

describe("hook contract integration", () => {
  let testEnv: IsolatedTestEnv;

  beforeEach(() => {
    testEnv = createIsolatedTestEnv("persona-memory-hook-contract-");
  });

  afterEach(() => {
    testEnv.cleanup();
  });

  test("session-start stays fail-open on malformed stdin", () => {
    const run = runBunScript("session-start.ts", ["--memory-home", testEnv.memoryHome], {
      env: testEnv.env,
      stdin: "not-json",
    });

    expect(run.exitCode).toBe(0);
    const payload = parseJsonOrThrow<{ continue: boolean; ok: boolean; code: string }>(run.stdout);
    expect(payload.continue).toBe(true);
    expect(payload.ok).toBe(true);
    expect(payload.code).toBe("SESSION_START_OK");
  });

  test("session-end stays fail-open on malformed stdin", () => {
    const run = runBunScript("session-end.ts", ["--memory-home", testEnv.memoryHome], {
      env: testEnv.env,
      stdin: "not-json",
    });

    expect(run.exitCode).toBe(0);
    const payload = parseJsonOrThrow<{ continue: boolean; ok: boolean; code: string }>(run.stdout);
    expect(payload.continue).toBe(true);
    expect(payload.ok).toBe(true);
    expect(payload.code).toBe("SESSION_END_OK");
  });
});
