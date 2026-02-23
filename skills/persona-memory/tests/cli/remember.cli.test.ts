import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { parseJsonOrThrow } from "../helpers/assert.ts";
import { runBunScript } from "../helpers/cli.ts";
import { createIsolatedTestEnv, type IsolatedTestEnv } from "../helpers/temp-env.ts";

describe("remember CLI", () => {
  let testEnv: IsolatedTestEnv;

  beforeEach(() => {
    testEnv = createIsolatedTestEnv("persona-memory-cli-remember-");
  });

  afterEach(() => {
    testEnv.cleanup();
  });

  test("rejects missing content", () => {
    const run = runBunScript("remember.ts", ["--memory-home", testEnv.memoryHome], { env: testEnv.env });

    expect(run.exitCode).toBe(1);
    const payload = parseJsonOrThrow<{ ok: boolean; code: string }>(run.stdout);
    expect(payload.ok).toBe(false);
    expect(payload.code).toBe("REMEMBER_MISSING_CONTENT");
  });

  test("persists valid event", () => {
    const run = runBunScript(
      "remember.ts",
      [
        "--memory-home",
        testEnv.memoryHome,
        "--now",
        "2026-02-13T00:00:00.000Z",
        "--type",
        "decision",
        "--content",
        "Use deterministic harness as gate",
        "--confidence",
        "confirmed",
      ],
      { env: testEnv.env },
    );

    expect(run.exitCode).toBe(0);
    const payload = parseJsonOrThrow<{ ok: boolean; code: string; details: { event: { type: string; confidence: string } } }>(
      run.stdout,
    );
    expect(payload.ok).toBe(true);
    expect(payload.code).toBe("REMEMBER_SAVED");
    expect(payload.details.event.type).toBe("decision");
    expect(payload.details.event.confidence).toBe("confirmed");
  });
});
