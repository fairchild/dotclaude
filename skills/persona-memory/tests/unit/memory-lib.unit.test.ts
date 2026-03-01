import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appendFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  appendMemoryEvent,
  consolidateMemory,
  ensureMemoryHome,
  getMemoryPaths,
  readMemoryEvents,
} from "../../scripts/memory-lib.ts";
import { createIsolatedTestEnv, type IsolatedTestEnv } from "../helpers/temp-env.ts";

describe("memory-lib", () => {
  let testEnv: IsolatedTestEnv;

  beforeEach(() => {
    testEnv = createIsolatedTestEnv("persona-memory-unit-");
    process.env.HOME = testEnv.home;
    process.env.AI_MEMORY_HOME = testEnv.memoryHome;
    process.env.AI_MEMORY_PROFILE = "default";
    process.env.AI_MEMORY_NOW = "2026-02-13T00:00:00.000Z";
  });

  afterEach(() => {
    testEnv.cleanup();
  });

  test("ensureMemoryHome creates required files", () => {
    ensureMemoryHome("default");
    const paths = getMemoryPaths();

    expect(existsSync(paths.eventLog)).toBe(true);
    expect(existsSync(paths.indexFile)).toBe(true);
    expect(existsSync(join(paths.blocks, "user-profile.md"))).toBe(true);
    expect(existsSync(join(paths.blocks, "preferences.md"))).toBe(true);
    expect(existsSync(join(paths.blocks, "decisions.md"))).toBe(true);
    expect(existsSync(join(paths.blocks, "active-threads.md"))).toBe(true);
    expect(existsSync(join(paths.blocks, "relationships.md"))).toBe(true);
    expect(existsSync(join(paths.profiles, "default", "personality.md"))).toBe(true);
  });

  test("readMemoryEvents skips corrupt lines", () => {
    ensureMemoryHome("default");
    const paths = getMemoryPaths();

    appendFileSync(paths.eventLog, "{not-json}\n", "utf-8");
    appendFileSync(paths.eventLog, JSON.stringify({ id: "x", bad: true }) + "\n", "utf-8");

    const events = readMemoryEvents();
    expect(events.length).toBe(1);
  });

  test("consolidate promotes confirmed and skips inferred", () => {
    ensureMemoryHome("default");

    appendMemoryEvent({
      type: "decision",
      content: "Use launcher plus hooks",
      confidence: "confirmed",
      source: "test",
      projectKey: "dotclaude",
    });

    appendMemoryEvent({
      type: "decision",
      content: "Maybe switch providers",
      confidence: "inferred",
      source: "test",
      projectKey: "dotclaude",
    });

    const first = consolidateMemory();
    expect(first.processed).toBe(2);
    expect(first.promoted).toBe(1);
    expect(first.skipped).toBe(1);

    const second = consolidateMemory();
    expect(second.processed).toBe(0);

    const paths = getMemoryPaths();
    const decisions = readFileSync(join(paths.blocks, "decisions.md"), "utf-8");
    expect(decisions).toContain("Use launcher plus hooks");
    expect(decisions).not.toContain("Maybe switch providers");
  });

  test("dedupe prevents duplicate promoted entries", () => {
    ensureMemoryHome("default");

    appendMemoryEvent({
      type: "thread",
      content: "Finish deterministic harness",
      confidence: "confirmed",
      source: "test",
      projectKey: "dotclaude",
    });

    appendMemoryEvent({
      type: "thread",
      content: "Finish deterministic harness",
      confidence: "confirmed",
      source: "test",
      projectKey: "dotclaude",
    });

    const result = consolidateMemory();
    expect(result.processed).toBe(2);
    expect(result.promoted).toBe(1);
    expect(result.duplicates).toBe(1);
  });
});
