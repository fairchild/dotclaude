#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { createIsolatedTestEnv } from "./helpers/temp-env.ts";
import { runBunScript } from "./helpers/cli.ts";

interface EvalEvent {
  id?: string;
  type: "fact" | "preference" | "decision" | "thread" | "relationship";
  content: string;
  confidence: "confirmed" | "observed" | "inferred";
  source: string;
  project_key: string;
  expected_status: "promoted" | "duplicate" | "skipped";
  expected_block: string;
  quality?: "synthetic_seed" | "hand_labeled_high";
  label_source?: string;
}

interface GoldEvent {
  type: string;
  content: string;
}

interface EvalQuery {
  id: string;
  cwd: string;
  query: string;
  expected_contains: string[];
}

interface EventOutcome {
  index: number;
  row_id: string;
  type: EvalEvent["type"];
  project_key: string;
  confidence: EvalEvent["confidence"];
  content: string;
  expected_status: EvalEvent["expected_status"];
  actual_status: string;
  status_match: boolean;
  expected_block: string;
  resolved_block: string;
  appears_in_expected_block: boolean;
}

interface QueryOutcome {
  id: string;
  cwd: string;
  query: string;
  expected_contains: string[];
  top_snippets: string[];
  matched: boolean;
  recall_code: string;
  error: string | null;
}

interface EvalConfig {
  dataset: {
    name: string;
    sessions: number;
    events: number;
    queries: number;
  };
  thresholds: {
    extraction_f1_min: number;
    route_accuracy_min: number;
    dedupe_precision_min: number;
    recall_at_3_min: number;
    runtime_ms_max: number;
    fail_open_required: boolean;
  };
}

interface EvalReport {
  suite: "synthetic-eval";
  dataset: string;
  status: "passed" | "failed";
  duration_ms: number;
  memory_home: string;
  metrics: {
    extraction_f1: number;
    route_accuracy: number;
    dedupe_precision: number;
    recall_at_3: number;
    fail_open_passed: boolean;
    runtime_ms: number;
  };
  thresholds: EvalConfig["thresholds"];
  counts: {
    events_total: number;
    promoted_predicted: number;
    promoted_gold: number;
    true_positive_promoted: number;
    recall_queries: number;
    recall_hits: number;
  };
  checks: Array<{ name: string; pass: boolean; observed: number | boolean; expected: string }>;
  notes: string[];
  event_outcomes: EventOutcome[];
  query_outcomes: QueryOutcome[];
}

function getArg(name: string): string | null {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= process.argv.length) return null;
  return process.argv[idx + 1];
}

function parseReportFormat(): "text" | "json" {
  const raw = getArg("report") || "text";
  return raw === "json" ? "json" : "text";
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function readJsonl<T>(path: string): T[] {
  const raw = readFileSync(path, "utf-8").trim();
  if (!raw) return [];
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}

function normalize(input: string): string {
  return input.toLowerCase().replace(/\s+/g, " ").trim();
}

function parseHookPayload(raw: string): Record<string, unknown> {
  return JSON.parse(raw) as Record<string, unknown>;
}

function matchesExpected(snippetTexts: string[], expected: string[]): boolean {
  const top3 = snippetTexts.slice(0, 3).map((text) => normalize(text));
  return expected.some((fragment) => top3.some((snippet) => snippet.includes(normalize(fragment))));
}

function safeDivide(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return numerator / denominator;
}

function toFixed4(value: number): number {
  return Number(value.toFixed(4));
}

function main() {
  const reportFormat = parseReportFormat();
  const datasetDir = getArg("dataset-dir") || join(import.meta.dir, "fixtures", "eval", "compiled");
  const reportFile =
    getArg("report-file") || join(import.meta.dir, ".artifacts", "eval-report.json");

  const config = readJson<EvalConfig>(join(datasetDir, "config.json"));
  const events = readJsonl<EvalEvent>(join(datasetDir, "events.jsonl"));
  const goldEvents = readJsonl<GoldEvent>(join(datasetDir, "gold-events.jsonl"));
  const queries = readJsonl<EvalQuery>(join(datasetDir, "queries.jsonl"));
  const goldBlocks = readJson<Record<string, string[]>>(join(datasetDir, "gold-blocks.json"));

  const started = Date.now();
  const testEnv = createIsolatedTestEnv("persona-memory-eval-");

  process.env.HOME = testEnv.home;
  process.env.AI_MEMORY_HOME = testEnv.memoryHome;
  process.env.AI_MEMORY_PROFILE = "default";
  process.env.AI_MEMORY_NOW = "2026-02-13T00:00:00.000Z";

  const notes: string[] = [];

  const bootstrap = runBunScript(
    "bootstrap.ts",
    ["--memory-home", testEnv.memoryHome, "--now", "2026-02-13T00:00:00.000Z", "--json"],
    { env: testEnv.env },
  );
  if (bootstrap.exitCode !== 0) {
    throw new Error(`Bootstrap failed during eval: ${bootstrap.stdout || bootstrap.stderr}`);
  }

  for (const event of events) {
    const run = runBunScript(
      "remember.ts",
      [
        "--memory-home",
        testEnv.memoryHome,
        "--now",
        "2026-02-13T00:00:00.000Z",
        "--type",
        event.type,
        "--content",
        event.content,
        "--confidence",
        event.confidence,
        "--source",
        event.source,
        "--project-key",
        event.project_key,
      ],
      { env: testEnv.env },
    );
    if (run.exitCode !== 0) {
      throw new Error(`remember.ts failed for event '${event.content}': ${run.stdout || run.stderr}`);
    }
  }

  const consolidate = runBunScript(
    "consolidate.ts",
    ["--memory-home", testEnv.memoryHome, "--now", "2026-02-13T00:00:00.000Z", "--json"],
    { env: testEnv.env },
  );
  if (consolidate.exitCode !== 0) {
    throw new Error(`consolidate.ts failed during eval: ${consolidate.stdout || consolidate.stderr}`);
  }

  const eventLogPath = join(testEnv.memoryHome, "events", "memory-events.jsonl");
  const actualEvents = readJsonl<Array<EvalEvent & { status: string }>[number]>(eventLogPath);
  if (actualEvents.length !== events.length) {
    notes.push(`Event count mismatch: expected ${events.length}, observed ${actualEvents.length}`);
  }

  let statusMatches = 0;
  let duplicatePredicted = 0;
  let duplicateTruePositives = 0;
  const eventOutcomes: EventOutcome[] = [];

  const blockTexts = new Map<string, string>();
  for (const blockName of Object.keys(goldBlocks)) {
    const blockPath = join(testEnv.memoryHome, "blocks", blockName);
    const blockText = existsSync(blockPath) ? readFileSync(blockPath, "utf-8") : "";
    blockTexts.set(blockName, blockText);
  }

  for (let idx = 0; idx < events.length; idx += 1) {
    const expected = events[idx];
    const actual = actualEvents[idx];
    if (!actual) continue;

    const statusMatch = actual.status === expected.expected_status;
    if (statusMatch) statusMatches += 1;
    if (actual.status === "duplicate") duplicatePredicted += 1;
    if (actual.status === "duplicate" && expected.expected_status === "duplicate") {
      duplicateTruePositives += 1;
    }

    const resolvedBlock = blockTexts.has(expected.expected_block)
      ? expected.expected_block
      : `${expected.expected_block}.md`;
    const expectedBlockText = blockTexts.get(resolvedBlock) || "";
    const appearsInExpectedBlock = normalize(expectedBlockText).includes(normalize(expected.content));
    eventOutcomes.push({
      index: idx + 1,
      row_id: expected.id || `row-${idx + 1}`,
      type: expected.type,
      project_key: expected.project_key,
      confidence: expected.confidence,
      content: expected.content,
      expected_status: expected.expected_status,
      actual_status: actual.status,
      status_match: statusMatch,
      expected_block: expected.expected_block,
      resolved_block: resolvedBlock,
      appears_in_expected_block: appearsInExpectedBlock,
    });
  }

  const promotedPredicted = actualEvents
    .filter((event) => event.status === "promoted")
    .map((event) => normalize(event.content));
  const promotedGold = goldEvents.map((event) => normalize(event.content));
  const promotedPredictedSet = new Set(promotedPredicted);
  const promotedGoldSet = new Set(promotedGold);

  let truePositivePromoted = 0;
  for (const item of promotedPredictedSet) {
    if (promotedGoldSet.has(item)) truePositivePromoted += 1;
  }

  const precision = safeDivide(truePositivePromoted, promotedPredictedSet.size);
  const recall = safeDivide(truePositivePromoted, promotedGoldSet.size);
  const extractionF1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  let expectedRouteChecks = 0;
  let expectedRouteHits = 0;
  for (const [blockName, expectedEntries] of Object.entries(goldBlocks)) {
    const blockText = blockTexts.get(blockName) || "";

    for (const expectedEntry of expectedEntries) {
      expectedRouteChecks += 1;
      if (normalize(blockText).includes(normalize(expectedEntry))) {
        expectedRouteHits += 1;
      }
    }
  }

  let recallHits = 0;
  const queryOutcomes: QueryOutcome[] = [];
  for (const query of queries) {
    const recallRun = runBunScript(
      "recall.ts",
      [
        "--memory-home",
        testEnv.memoryHome,
        "--now",
        "2026-02-13T00:00:00.000Z",
        "--cwd",
        query.cwd,
        "--query",
        query.query,
        "--format",
        "json",
      ],
      { env: testEnv.env },
    );

    if (recallRun.exitCode !== 0) {
      notes.push(`recall.ts failed for query ${query.id}: ${recallRun.stdout || recallRun.stderr}`);
      queryOutcomes.push({
        id: query.id,
        cwd: query.cwd,
        query: query.query,
        expected_contains: query.expected_contains,
        top_snippets: [],
        matched: false,
        recall_code: "RUN_FAILED",
        error: recallRun.stdout || recallRun.stderr || "recall.ts failed",
      });
      continue;
    }

    const payload = JSON.parse(recallRun.stdout) as {
      ok: boolean;
      code: string;
      details: { result: { snippets: Array<{ text: string }> } };
    };

    const snippets = payload.details.result.snippets.map((snippet) => snippet.text);
    const topSnippets = snippets.slice(0, 3);
    const matched = matchesExpected(snippets, query.expected_contains);
    if (matched) recallHits += 1;
    queryOutcomes.push({
      id: query.id,
      cwd: query.cwd,
      query: query.query,
      expected_contains: query.expected_contains,
      top_snippets: topSnippets,
      matched,
      recall_code: payload.code || "SUCCESS",
      error: null,
    });
  }

  const corruptLine = "{broken-json-line}";
  writeFileSync(eventLogPath, readFileSync(eventLogPath, "utf-8") + corruptLine + "\n", "utf-8");

  const postCorruptConsolidate = runBunScript(
    "consolidate.ts",
    ["--memory-home", testEnv.memoryHome, "--now", "2026-02-13T00:00:00.000Z", "--json"],
    { env: testEnv.env },
  );

  const sessionStartMalformed = runBunScript(
    "session-start.ts",
    ["--memory-home", testEnv.memoryHome, "--now", "2026-02-13T00:00:00.000Z"],
    { env: testEnv.env, stdin: "not-json" },
  );

  const sessionEndMalformed = runBunScript(
    "session-end.ts",
    ["--memory-home", testEnv.memoryHome, "--now", "2026-02-13T00:00:00.000Z"],
    { env: testEnv.env, stdin: "not-json" },
  );

  let failOpenPassed = false;
  try {
    const startPayload = parseHookPayload(sessionStartMalformed.stdout);
    const endPayload = parseHookPayload(sessionEndMalformed.stdout);
    failOpenPassed =
      postCorruptConsolidate.exitCode === 0 &&
      sessionStartMalformed.exitCode === 0 &&
      sessionEndMalformed.exitCode === 0 &&
      startPayload.continue === true &&
      endPayload.continue === true;
  } catch {
    failOpenPassed = false;
  }

  const routeAccuracy = safeDivide(expectedRouteHits, expectedRouteChecks);
  const dedupePrecision = safeDivide(duplicateTruePositives, duplicatePredicted);
  const recallAt3 = safeDivide(recallHits, queries.length);
  const runtimeMs = Date.now() - started;

  const checks: EvalReport["checks"] = [
    {
      name: "extraction_f1",
      pass: extractionF1 >= config.thresholds.extraction_f1_min,
      observed: toFixed4(extractionF1),
      expected: `>= ${config.thresholds.extraction_f1_min}`,
    },
    {
      name: "route_accuracy",
      pass: routeAccuracy >= config.thresholds.route_accuracy_min,
      observed: toFixed4(routeAccuracy),
      expected: `>= ${config.thresholds.route_accuracy_min}`,
    },
    {
      name: "dedupe_precision",
      pass: dedupePrecision >= config.thresholds.dedupe_precision_min,
      observed: toFixed4(dedupePrecision),
      expected: `>= ${config.thresholds.dedupe_precision_min}`,
    },
    {
      name: "recall_at_3",
      pass: recallAt3 >= config.thresholds.recall_at_3_min,
      observed: toFixed4(recallAt3),
      expected: `>= ${config.thresholds.recall_at_3_min}`,
    },
    {
      name: "fail_open",
      pass: config.thresholds.fail_open_required ? failOpenPassed : true,
      observed: failOpenPassed,
      expected: config.thresholds.fail_open_required ? "true" : "optional",
    },
    {
      name: "runtime_ms",
      pass: runtimeMs <= config.thresholds.runtime_ms_max,
      observed: runtimeMs,
      expected: `<= ${config.thresholds.runtime_ms_max}`,
    },
  ];

  const status = checks.every((check) => check.pass) ? "passed" : "failed";

  const report: EvalReport = {
    suite: "synthetic-eval",
    dataset: config.dataset.name,
    status,
    duration_ms: runtimeMs,
    memory_home: testEnv.memoryHome,
    metrics: {
      extraction_f1: toFixed4(extractionF1),
      route_accuracy: toFixed4(routeAccuracy),
      dedupe_precision: toFixed4(dedupePrecision),
      recall_at_3: toFixed4(recallAt3),
      fail_open_passed: failOpenPassed,
      runtime_ms: runtimeMs,
    },
    thresholds: config.thresholds,
    counts: {
      events_total: events.length,
      promoted_predicted: promotedPredictedSet.size,
      promoted_gold: promotedGoldSet.size,
      true_positive_promoted: truePositivePromoted,
      recall_queries: queries.length,
      recall_hits: recallHits,
    },
    checks,
    notes,
    event_outcomes: eventOutcomes,
    query_outcomes: queryOutcomes,
  };

  const reportDir = join(reportFile, "..");
  if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });
  writeFileSync(reportFile, JSON.stringify(report, null, 2) + "\n", "utf-8");

  if (reportFormat === "json") {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`[eval] dataset=${report.dataset} status=${report.status} duration_ms=${report.duration_ms}`);
    for (const check of checks) {
      console.log(
        `[eval] ${check.name}: ${check.pass ? "PASS" : "FAIL"} observed=${String(check.observed)} expected=${check.expected}`,
      );
    }
  }

  testEnv.cleanup();

  process.exit(status === "passed" ? 0 : 1);
}

main();
