import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { parseJsonOrThrow } from "../helpers/assert.ts";
import { runBunScript } from "../helpers/cli.ts";
import { createIsolatedTestEnv, type IsolatedTestEnv } from "../helpers/temp-env.ts";

describe("recall CLI", () => {
  let testEnv: IsolatedTestEnv;

  beforeEach(() => {
    testEnv = createIsolatedTestEnv("persona-memory-cli-recall-");
  });

  afterEach(() => {
    testEnv.cleanup();
  });

  test("returns JSON envelope in json format", () => {
    const remember = runBunScript(
      "remember.ts",
      [
        "--memory-home",
        testEnv.memoryHome,
        "--type",
        "thread",
        "--content",
        "Investigate oauth rotation bug",
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
        "oauth rotation",
        "--format",
        "json",
      ],
      { env: testEnv.env },
    );

    expect(recall.exitCode).toBe(0);
    const payload = parseJsonOrThrow<{ ok: boolean; code: string; details: { result: { snippets: unknown[] } } }>(
      recall.stdout,
    );
    expect(payload.ok).toBe(true);
    expect(payload.code).toBe("RECALL_OK");
    expect(payload.details.result.snippets.length).toBeGreaterThan(0);
  });

  test("prompt format returns text output", () => {
    const recall = runBunScript(
      "recall.ts",
      ["--memory-home", testEnv.memoryHome, "--cwd", "/tmp/project-a", "--format", "prompt"],
      { env: testEnv.env },
    );

    expect(recall.exitCode).toBe(0);
    expect(recall.stdout).toContain("Memory Context");
  });
});
