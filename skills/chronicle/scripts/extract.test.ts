import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadEnvAssignments, parseEnvAssignment } from "./extract.ts";

const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
const originalExtractModel = process.env.CHRONICLE_EXTRACT_MODEL;

afterEach(() => {
  if (originalAnthropicKey === undefined) {
    delete process.env.ANTHROPIC_API_KEY;
  } else {
    process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
  }

  if (originalExtractModel === undefined) {
    delete process.env.CHRONICLE_EXTRACT_MODEL;
  } else {
    process.env.CHRONICLE_EXTRACT_MODEL = originalExtractModel;
  }
});

describe("parseEnvAssignment", () => {
  test("parses shell-style exported assignments", () => {
    expect(parseEnvAssignment("export ANTHROPIC_API_KEY='test-key'")).toEqual(["ANTHROPIC_API_KEY", "test-key"]);
  });

  test("ignores comments and non-assignments", () => {
    expect(parseEnvAssignment("# ANTHROPIC_API_KEY=ignored")).toBeNull();
    expect(parseEnvAssignment("if [[ -n $HOME ]]; then")).toBeNull();
  });
});

describe("loadEnvAssignments", () => {
  test("loads ANTHROPIC_API_KEY from ~/.env when ~/.claude/.env is absent", () => {
    const home = mkdtempSync(join(tmpdir(), "chronicle-env-"));
    try {
      delete process.env.ANTHROPIC_API_KEY;
      writeFileSync(join(home, ".env"), "export ANTHROPIC_API_KEY='from-home-env'\n");

      loadEnvAssignments(home);

      expect(process.env.ANTHROPIC_API_KEY).toBe("from-home-env");
    } finally {
      if (existsSync(home)) rmSync(home, { recursive: true, force: true });
    }
  });

  test("does not overwrite an existing process env value", () => {
    const home = mkdtempSync(join(tmpdir(), "chronicle-env-"));
    try {
      mkdirSync(join(home, ".claude"), { recursive: true });
      process.env.ANTHROPIC_API_KEY = "from-process";
      writeFileSync(join(home, ".claude", ".env"), "ANTHROPIC_API_KEY=from-file\n");

      loadEnvAssignments(home);

      expect(process.env.ANTHROPIC_API_KEY).toBe("from-process");
    } finally {
      if (existsSync(home)) rmSync(home, { recursive: true, force: true });
    }
  });

  test("loads only ANTHROPIC_API_KEY from ~/.zprofile", () => {
    const home = mkdtempSync(join(tmpdir(), "chronicle-env-"));
    try {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.CHRONICLE_EXTRACT_MODEL;
      writeFileSync(
        join(home, ".zprofile"),
        "export ANTHROPIC_API_KEY=from-profile\nexport CHRONICLE_EXTRACT_MODEL=ignored-from-profile\n"
      );

      loadEnvAssignments(home);

      expect(process.env.ANTHROPIC_API_KEY).toBe("from-profile");
      expect(process.env.CHRONICLE_EXTRACT_MODEL).toBeUndefined();
    } finally {
      if (existsSync(home)) rmSync(home, { recursive: true, force: true });
    }
  });
});
