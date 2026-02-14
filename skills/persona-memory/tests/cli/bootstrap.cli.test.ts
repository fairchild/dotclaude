import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { join } from "path";
import { parseJsonOrThrow } from "../helpers/assert.ts";
import { runBunScript } from "../helpers/cli.ts";
import { createIsolatedTestEnv, type IsolatedTestEnv } from "../helpers/temp-env.ts";

describe("bootstrap CLI", () => {
  let testEnv: IsolatedTestEnv;

  beforeEach(() => {
    testEnv = createIsolatedTestEnv("persona-memory-cli-bootstrap-");
  });

  afterEach(() => {
    testEnv.cleanup();
  });

  test("creates memory home and returns envelope", () => {
    const run = runBunScript(
      "bootstrap.ts",
      ["--memory-home", testEnv.memoryHome, "--now", "2026-02-13T00:00:00.000Z", "--json"],
      { env: testEnv.env },
    );

    expect(run.exitCode).toBe(0);
    const payload = parseJsonOrThrow<{ ok: boolean; code: string; details: { personality_path: string } }>(run.stdout);
    expect(payload.ok).toBe(true);
    expect(payload.code).toBe("BOOTSTRAP_OK");
    expect(existsSync(payload.details.personality_path)).toBe(true);
    expect(existsSync(join(testEnv.memoryHome, "events", "memory-events.jsonl"))).toBe(true);
  });
});
