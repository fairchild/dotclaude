import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { runCommand } from "../helpers/cli.ts";
import { createIsolatedTestEnv, type IsolatedTestEnv } from "../helpers/temp-env.ts";

function parseNulSeparatedArgs(path: string): string[] {
  const raw = readFileSync(path);
  const chunks = raw.toString("utf-8").split("\u0000");
  return chunks.filter((chunk) => chunk.length > 0);
}

function installClaudeStub(binDir: string, argsFile: string): string {
  const stubPath = join(binDir, "claude");
  writeFileSync(
    stubPath,
    `#!/usr/bin/env bash\nset -euo pipefail\nprintf '%s\\0' "$@" > "${argsFile}"\n`,
    "utf-8",
  );
  chmodSync(stubPath, 0o755);
  return stubPath;
}

describe("launch-claude integration", () => {
  let testEnv: IsolatedTestEnv;

  beforeEach(() => {
    testEnv = createIsolatedTestEnv("persona-memory-integration-launcher-");
  });

  afterEach(() => {
    testEnv.cleanup();
  });

  test("includes --add-dir and appended personality prompt", () => {
    const argsFile = join(testEnv.root, "claude-args.bin");
    installClaudeStub(testEnv.binDir, argsFile);

    const personalityDir = join(testEnv.memoryHome, "profiles", "default");
    mkdirSync(personalityDir, { recursive: true });
    writeFileSync(join(personalityDir, "personality.md"), "Name: Test Persona", "utf-8");

    const launchScript = join(import.meta.dir, "..", "..", "scripts", "launch-claude.sh");
    const env = {
      ...testEnv.env,
      PATH: `${testEnv.binDir}:${process.env.PATH || ""}`,
      CLAUDE_BIN: "claude",
    };

    const run = runCommand(
      [
        "bash",
        launchScript,
        "--memory-home",
        testEnv.memoryHome,
        "--now",
        "2026-02-13T00:00:00.000Z",
        "--print",
        "hello",
      ],
      { env },
    );

    expect(run.exitCode).toBe(0);
    expect(existsSync(argsFile)).toBe(true);

    const args = parseNulSeparatedArgs(argsFile);
    const addDirIndex = args.indexOf("--add-dir");
    expect(addDirIndex).toBeGreaterThanOrEqual(0);
    expect(args[addDirIndex + 1]).toBe(testEnv.memoryHome);

    const appendIndex = args.indexOf("--append-system-prompt");
    expect(appendIndex).toBeGreaterThanOrEqual(0);
    expect(args[appendIndex + 1]).toContain("Name: Test Persona");
  });

  test("degrades gracefully when personality file is missing", () => {
    const argsFile = join(testEnv.root, "claude-args-missing-persona.bin");
    installClaudeStub(testEnv.binDir, argsFile);

    const launchScript = join(import.meta.dir, "..", "..", "scripts", "launch-claude.sh");
    const env = {
      ...testEnv.env,
      PATH: `${testEnv.binDir}:${process.env.PATH || ""}`,
      CLAUDE_BIN: "claude",
    };

    const run = runCommand(["bash", launchScript, "--memory-home", testEnv.memoryHome, "--print", "ping"], {
      env,
    });

    expect(run.exitCode).toBe(0);
    expect(run.stderr).toContain("personality file missing");
    expect(existsSync(argsFile)).toBe(true);
  });

  test("degrades gracefully when bun is unavailable", () => {
    const argsFile = join(testEnv.root, "claude-args-no-bun.bin");
    installClaudeStub(testEnv.binDir, argsFile);

    const personalityDir = join(testEnv.memoryHome, "profiles", "default");
    mkdirSync(personalityDir, { recursive: true });
    writeFileSync(join(personalityDir, "personality.md"), "Name: Persona Without Bun", "utf-8");

    const launchScript = join(import.meta.dir, "..", "..", "scripts", "launch-claude.sh");

    const barePath = `${testEnv.binDir}:/bin:/usr/bin`;
    const env = {
      ...testEnv.env,
      PATH: barePath,
      CLAUDE_BIN: "claude",
    };

    const run = runCommand(["bash", launchScript, "--memory-home", testEnv.memoryHome, "--print", "pong"], {
      env,
    });

    expect(run.exitCode).toBe(0);
    expect(run.stderr).toContain("bun not found");

    const args = parseNulSeparatedArgs(argsFile);
    const appendIndex = args.indexOf("--append-system-prompt");
    expect(appendIndex).toBeGreaterThanOrEqual(0);
    expect(args[appendIndex + 1]).toContain("Persona Without Bun");
  });
});
