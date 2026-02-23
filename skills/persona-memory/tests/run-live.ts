#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

type ReportFormat = "text" | "json";

interface LiveMetric {
  test: string;
  model: string;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  timestamp: string;
}

interface LiveReport {
  suite: "live";
  status: "passed" | "failed" | "skipped";
  provider: string;
  duration_ms: number;
  exit_code: number;
  reason: string | null;
  metrics: {
    run_count: number;
    latency_ms_total: number;
    latency_ms_avg: number;
    estimated_cost_usd_total: number;
    input_tokens_total: number;
    output_tokens_total: number;
  };
}

function getArg(name: string): string | null {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= process.argv.length) return null;
  return process.argv[idx + 1];
}

function parseReportFormat(): ReportFormat {
  const raw = getArg("report") || "text";
  return raw === "json" ? "json" : "text";
}

function readMetrics(path: string): LiveMetric[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf-8").trim();
  if (!raw) return [];

  const out: LiveMetric[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as LiveMetric);
    } catch {}
  }
  return out;
}

function summarizeMetrics(metrics: LiveMetric[]) {
  const latencyTotal = metrics.reduce((acc, metric) => acc + metric.latency_ms, 0);
  const costTotal = metrics.reduce((acc, metric) => acc + metric.estimated_cost_usd, 0);
  const inputTokensTotal = metrics.reduce((acc, metric) => acc + metric.input_tokens, 0);
  const outputTokensTotal = metrics.reduce((acc, metric) => acc + metric.output_tokens, 0);

  return {
    run_count: metrics.length,
    latency_ms_total: latencyTotal,
    latency_ms_avg: metrics.length > 0 ? Math.round(latencyTotal / metrics.length) : 0,
    estimated_cost_usd_total: Number(costTotal.toFixed(8)),
    input_tokens_total: inputTokensTotal,
    output_tokens_total: outputTokensTotal,
  };
}

function printTextReport(report: LiveReport): void {
  console.log(`[live] ${report.status} (${report.provider}) in ${report.duration_ms}ms`);
  if (report.reason) {
    console.log(`reason: ${report.reason}`);
  }
  console.log(
    `metrics: runs=${report.metrics.run_count}, avg_latency_ms=${report.metrics.latency_ms_avg}, ` +
      `cost_usd=${report.metrics.estimated_cost_usd_total}`,
  );
}

function main() {
  const format = parseReportFormat();
  const provider = process.env.AI_MEMORY_TEST_PROVIDER || "anthropic";
  const liveEnabled = process.env.AI_MEMORY_TEST_LIVE === "1";
  const apiKey = process.env.ANTHROPIC_API_KEY || "";

  const skillDir = join(import.meta.dir, "..");
  const artifactDir = join(skillDir, "tests", ".artifacts");
  mkdirSync(artifactDir, { recursive: true });

  const reportFile = getArg("report-file") || join(artifactDir, "live-report.json");
  const metricsFile = join(artifactDir, "live-metrics.jsonl");

  if (existsSync(metricsFile)) rmSync(metricsFile, { force: true });

  if (!liveEnabled) {
    const skipped: LiveReport = {
      suite: "live",
      status: "skipped",
      provider,
      duration_ms: 0,
      exit_code: 0,
      reason: "AI_MEMORY_TEST_LIVE is not set to 1",
      metrics: summarizeMetrics([]),
    };
    writeFileSync(reportFile, JSON.stringify(skipped, null, 2) + "\n", "utf-8");
    if (format === "json") {
      console.log(JSON.stringify(skipped, null, 2));
    } else {
      printTextReport(skipped);
    }
    process.exit(0);
  }

  if (provider !== "anthropic") {
    const skipped: LiveReport = {
      suite: "live",
      status: "skipped",
      provider,
      duration_ms: 0,
      exit_code: 0,
      reason: `Unsupported provider: ${provider}`,
      metrics: summarizeMetrics([]),
    };
    writeFileSync(reportFile, JSON.stringify(skipped, null, 2) + "\n", "utf-8");
    if (format === "json") {
      console.log(JSON.stringify(skipped, null, 2));
    } else {
      printTextReport(skipped);
    }
    process.exit(0);
  }

  if (!apiKey) {
    const skipped: LiveReport = {
      suite: "live",
      status: "skipped",
      provider,
      duration_ms: 0,
      exit_code: 0,
      reason: "ANTHROPIC_API_KEY is missing",
      metrics: summarizeMetrics([]),
    };
    writeFileSync(reportFile, JSON.stringify(skipped, null, 2) + "\n", "utf-8");
    if (format === "json") {
      console.log(JSON.stringify(skipped, null, 2));
    } else {
      printTextReport(skipped);
    }
    process.exit(0);
  }

  const started = Date.now();
  const run = Bun.spawnSync(["bun", "test", "tests/live"], {
    cwd: skillDir,
    env: {
      ...process.env,
      AI_MEMORY_TEST_LIVE: "1",
      AI_MEMORY_TEST_PROVIDER: provider,
      AI_MEMORY_LIVE_REPORT_FILE: metricsFile,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const durationMs = Date.now() - started;

  const stdout = new TextDecoder().decode(run.stdout).trim();
  const stderr = new TextDecoder().decode(run.stderr).trim();
  if (format !== "json") {
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
  }

  const metrics = readMetrics(metricsFile);
  const report: LiveReport = {
    suite: "live",
    status: run.exitCode === 0 ? "passed" : "failed",
    provider,
    duration_ms: durationMs,
    exit_code: run.exitCode,
    reason: null,
    metrics: summarizeMetrics(metrics),
  };

  writeFileSync(reportFile, JSON.stringify(report, null, 2) + "\n", "utf-8");

  if (format === "json") {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printTextReport(report);
  }

  process.exit(run.exitCode);
}

main();
