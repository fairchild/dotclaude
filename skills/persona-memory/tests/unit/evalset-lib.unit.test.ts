import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", "utf-8");
}

function writeJsonl(path: string, rows: unknown[]): void {
  const body = rows.map((row) => JSON.stringify(row)).join("\n");
  writeFileSync(path, body + (rows.length > 0 ? "\n" : ""), "utf-8");
}

let root = "";
let lib: Awaited<typeof import("../../scripts/evalset-lib.ts")>;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "persona-memory-evalset-"));
  process.env.AI_MEMORY_EVALSET_ROOT = root;

  writeJson(join(root, "config.json"), {
    dataset: { name: "evalset-test", sessions: 1, events: 2, queries: 2 },
    thresholds: {
      extraction_f1_min: 0.85,
      route_accuracy_min: 0.95,
      dedupe_precision_min: 0.95,
      recall_at_3_min: 0.8,
      runtime_ms_max: 45000,
      fail_open_required: true,
    },
  });

  writeJsonl(join(root, "events.jsonl"), [
    {
      type: "decision",
      content: "Use deterministic gate",
      confidence: "confirmed",
      source: "test",
      project_key: "dotclaude",
      expected_status: "promoted",
      expected_block: "decisions",
    },
    {
      type: "thread",
      content: "Fix sync bug",
      confidence: "confirmed",
      source: "test",
      project_key: "dotclaude",
      expected_status: "promoted",
      expected_block: "active-threads",
    },
  ]);

  writeJsonl(join(root, "queries.jsonl"), [
    { id: "q01", cwd: "/tmp/a", query: "deterministic", expected_contains: ["deterministic gate"] },
    { id: "q02", cwd: "/tmp/a", query: "sync bug", expected_contains: ["Fix sync bug"] },
  ]);

  writeJsonl(join(root, "gold-events.jsonl"), [
    { type: "decision", content: "Use deterministic gate" },
    { type: "thread", content: "Fix sync bug" },
  ]);

  writeJson(join(root, "gold-blocks.json"), {
    "decisions.md": ["Use deterministic gate"],
    "active-threads.md": ["Fix sync bug"],
  });

  lib = await import(`../../scripts/evalset-lib.ts?test=${Date.now()}`);
});

afterAll(() => {
  delete process.env.AI_MEMORY_EVALSET_ROOT;
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("evalset-lib", () => {
  test("initializes base/compiled/annotations from legacy fixtures", () => {
    const layout = lib.ensureEvalsetInitialized();
    expect(layout.baseDir.endsWith("/base")).toBeTrue();

    const baseEvents = readFileSync(join(root, "base", "events.jsonl"), "utf-8");
    expect(baseEvents).toContain('"id":"ev-001"');
    expect(baseEvents).toContain('"quality":"synthetic_seed"');

    const baseQueries = readFileSync(join(root, "base", "queries.jsonl"), "utf-8");
    expect(baseQueries).toContain('"id":"q01"');
    expect(baseQueries).toContain('"quality":"synthetic_seed"');
  });

  test("rejects bad query label without correction", () => {
    expect(() =>
      lib.appendLabel({
        row_kind: "query",
        row_id: "q01",
        verdict: "bad",
        rationale: "missing correction",
      }),
    ).toThrow();
  });

  test("applies good label as high quality without changing content", () => {
    lib.appendLabel({
      row_kind: "event",
      row_id: "ev-001",
      verdict: "good",
      rationale: "good row",
    });

    const summary = lib.compileEvalset();
    expect(summary.high_quality.events).toBeGreaterThanOrEqual(1);

    const compiled = lib.getEvalsetRows("compiled", "events").rows;
    const row = compiled.find((item) => item.id === "ev-001");
    expect(row?.quality).toBe("hand_labeled_high");
    expect(row?.content).toBe("Use deterministic gate");
  });

  test("latest label wins and bad replacement applies correction", () => {
    lib.appendLabel({
      row_kind: "query",
      row_id: "q01",
      verdict: "good",
      rationale: "good first",
    });

    lib.appendLabel({
      row_kind: "query",
      row_id: "q01",
      verdict: "bad",
      rationale: "needs correction",
      correction: {
        query: "deterministic gate required",
        expected_contains: ["deterministic gate required"],
      },
    });

    const before = readFileSync(join(root, "compiled", "queries.jsonl"), "utf-8");
    lib.compileEvalset();
    const after = readFileSync(join(root, "compiled", "queries.jsonl"), "utf-8");
    lib.compileEvalset();
    const after2 = readFileSync(join(root, "compiled", "queries.jsonl"), "utf-8");

    expect(after).toContain('"id":"q01"');
    expect(after).toContain('"query":"deterministic gate required"');
    expect(after).toContain('"quality":"hand_labeled_high"');
    expect(after).toBe(after2);
    expect(before).not.toBe(after);

    const baseRows = lib.getEvalsetRows("base", "queries").rows;
    const baseRow = baseRows.find((item) => item.id === "q01");
    expect(baseRow?.curation_status).toBe("bad_replaced");

    const stats = lib.getEvalsetStats();
    expect(stats.labeled_bad.queries).toBeGreaterThanOrEqual(1);
    expect(stats.compiled_high_quality.queries).toBeGreaterThanOrEqual(1);
  });

  test("stores optional label score and surfaces scored stats", () => {
    lib.appendLabel({
      row_kind: "event",
      row_id: "ev-002",
      verdict: "good",
      rationale: "solid row",
      score: 5,
    });
    lib.compileEvalset();

    const rows = lib.getEvalsetRows("base", "events").rows;
    const row = rows.find((item) => item.id === "ev-002");
    expect(row?.latest_label?.score).toBe(5);

    const stats = lib.getEvalsetStats();
    expect(stats.scored.events).toBeGreaterThanOrEqual(1);
    expect(typeof stats.score_avg.total === "number" || stats.score_avg.total === null).toBeTrue();
  });

  test("edits base query row and persists updated fields", () => {
    const updated = lib.updateBaseRow({
      row_kind: "query",
      row_id: "q02",
      patch: {
        query: "sync bug follow up",
        expected_contains: ["sync bug follow up"],
      },
    });

    expect(updated.id).toBe("q02");
    expect(updated.query).toBe("sync bug follow up");
    expect(updated.expected_contains).toEqual(["sync bug follow up"]);

    const baseRows = lib.getEvalsetRows("base", "queries").rows;
    const row = baseRows.find((item) => item.id === "q02");
    expect(row?.query).toBe("sync bug follow up");
  });
});
