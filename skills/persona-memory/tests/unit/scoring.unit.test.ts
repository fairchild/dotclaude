import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  ensureMemoryHome,
  getMemoryPaths,
  getRecallResult,
} from "../../scripts/memory-lib.ts";
import { totalSnippetChars } from "../helpers/assert.ts";
import { createIsolatedTestEnv, type IsolatedTestEnv } from "../helpers/temp-env.ts";

describe("recall scoring", () => {
  let testEnv: IsolatedTestEnv;

  beforeEach(() => {
    testEnv = createIsolatedTestEnv("persona-memory-scoring-");
    process.env.HOME = testEnv.home;
    process.env.AI_MEMORY_HOME = testEnv.memoryHome;
    process.env.AI_MEMORY_PROFILE = "default";
    process.env.AI_MEMORY_NOW = "2026-02-13T00:00:00.000Z";
    ensureMemoryHome("default");

    const paths = getMemoryPaths();
    writeFileSync(
      join(paths.blocks, "active-threads.md"),
      "# Active Threads\n\n## Entries\n\n- OAuth refresh token issue in API gateway\n",
      "utf-8",
    );
    writeFileSync(
      join(paths.blocks, "preferences.md"),
      "# Preferences\n\n## Entries\n\n- Prefer concise review checklists\n",
      "utf-8",
    );

    const projectBlock = join(paths.projects, "project-a.md");
    writeFileSync(
      projectBlock,
      "# Project: project-a\n\n## Entries\n\n- OAuth refresh token issue in API gateway needs rotation fix\n",
      "utf-8",
    );
  });

  afterEach(() => {
    testEnv.cleanup();
  });

  test("project block is preferred over generic blocks", () => {
    const result = getRecallResult({
      cwd: "/tmp/project-a",
      query: "oauth refresh token",
      maxChars: 1200,
      profile: "default",
    });

    expect(result.snippets.length).toBeGreaterThan(0);
    expect(result.snippets[0]?.source).toBe("project:project-a");
  });

  test("maxChars budget is respected", () => {
    const result = getRecallResult({
      cwd: "/tmp/project-a",
      query: "oauth",
      maxChars: 100,
      profile: "default",
    });

    expect(totalSnippetChars(result.snippets)).toBeLessThanOrEqual(100);
  });

  test("query filtering excludes non-matching snippets", () => {
    const result = getRecallResult({
      cwd: "/tmp/project-a",
      query: "rotation",
      maxChars: 1200,
      profile: "default",
    });

    const rendered = result.snippets.map((snippet) => snippet.text.toLowerCase()).join("\n");
    expect(rendered).toContain("rotation");
    expect(rendered).not.toContain("concise review checklists");
  });

  test("no query still returns top snippets", () => {
    const result = getRecallResult({
      cwd: "/tmp/project-a",
      query: "",
      maxChars: 300,
      profile: "default",
    });

    expect(result.snippets.length).toBeGreaterThan(0);
    const paths = getMemoryPaths();
    const projectText = readFileSync(join(paths.projects, "project-a.md"), "utf-8");
    expect(projectText).toContain("OAuth refresh token issue");
  });
});
