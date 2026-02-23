import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { parseJsonOrThrow } from "../helpers/assert.ts";
import { runBunScript } from "../helpers/cli.ts";
import { createIsolatedTestEnv, type IsolatedTestEnv } from "../helpers/temp-env.ts";

describe("consolidate CLI", () => {
  let testEnv: IsolatedTestEnv;

  beforeEach(() => {
    testEnv = createIsolatedTestEnv("persona-memory-cli-consolidate-");
  });

  afterEach(() => {
    testEnv.cleanup();
  });

  test("promotes confirmed entries", () => {
    const remember = runBunScript(
      "remember.ts",
      [
        "--memory-home",
        testEnv.memoryHome,
        "--type",
        "decision",
        "--content",
        "Use deterministic suite for PR gate",
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
    const payload = parseJsonOrThrow<{
      ok: boolean;
      code: string;
      details: { result: { processed: number; promoted: number } };
    }>(consolidate.stdout);
    expect(payload.ok).toBe(true);
    expect(payload.code).toBe("CONSOLIDATE_OK");
    expect(payload.details.result.processed).toBe(1);
    expect(payload.details.result.promoted).toBe(1);
  });

  test("skips inferred entries", () => {
    const remember = runBunScript(
      "remember.ts",
      [
        "--memory-home",
        testEnv.memoryHome,
        "--type",
        "decision",
        "--content",
        "Potentially switch providers",
        "--confidence",
        "inferred",
      ],
      { env: testEnv.env },
    );
    expect(remember.exitCode).toBe(0);

    const consolidate = runBunScript("consolidate.ts", ["--memory-home", testEnv.memoryHome, "--json"], {
      env: testEnv.env,
    });

    const payload = parseJsonOrThrow<{ details: { result: { skipped: number } } }>(consolidate.stdout);
    expect(payload.details.result.skipped).toBe(1);
  });
});
