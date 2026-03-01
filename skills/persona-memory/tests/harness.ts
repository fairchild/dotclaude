#!/usr/bin/env bun
import { join } from "path";
import { runCommand } from "./helpers/cli.ts";

type Suite = "deterministic" | "live" | "all";
type ReportFormat = "text" | "json";

interface SuiteReport {
  suite: string;
  status: string;
  duration_ms: number;
  exit_code: number;
}

interface HarnessReport {
  suite: Suite;
  status: "passed" | "failed";
  duration_ms: number;
  deterministic: SuiteReport | null;
  live: SuiteReport | null;
}

function getArg(name: string): string | null {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= process.argv.length) return null;
  return process.argv[idx + 1];
}

function parseSuite(): Suite {
  const raw = (getArg("suite") || "deterministic") as Suite;
  if (raw === "deterministic" || raw === "live" || raw === "all") return raw;
  return "deterministic";
}

function parseReportFormat(): ReportFormat {
  const raw = getArg("report") || "text";
  return raw === "json" ? "json" : "text";
}

function parseReport(raw: string): SuiteReport {
  return JSON.parse(raw) as SuiteReport;
}

function runSubscript(scriptFile: string): { report: SuiteReport; exitCode: number; stderr: string } {
  const scriptPath = join(import.meta.dir, scriptFile);
  const run = runCommand(["bun", scriptPath, "--report", "json"], {
    env: Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    ),
  });

  if (run.exitCode !== 0 && !run.stdout) {
    throw new Error(`Failed running ${scriptFile}: ${run.stderr}`);
  }

  const report = parseReport(run.stdout);
  return {
    report,
    exitCode: run.exitCode,
    stderr: run.stderr,
  };
}

function printText(summary: HarnessReport): void {
  console.log(`[harness] suite=${summary.suite} status=${summary.status} duration_ms=${summary.duration_ms}`);
  if (summary.deterministic) {
    console.log(
      `[harness] deterministic status=${summary.deterministic.status} duration_ms=${summary.deterministic.duration_ms}`,
    );
  }
  if (summary.live) {
    console.log(`[harness] live status=${summary.live.status} duration_ms=${summary.live.duration_ms}`);
  }
}

function main() {
  const suite = parseSuite();
  const format = parseReportFormat();
  const started = Date.now();

  let deterministic: SuiteReport | null = null;
  let live: SuiteReport | null = null;
  let exitCode = 0;

  if (suite === "deterministic" || suite === "all") {
    const run = runSubscript("run-deterministic.ts");
    deterministic = run.report;
    if (run.exitCode !== 0) exitCode = 1;
  }

  if (suite === "live" || suite === "all") {
    const run = runSubscript("run-live.ts");
    live = run.report;
    if (suite === "live" && run.exitCode !== 0) {
      exitCode = 1;
    }
    if (suite === "all" && run.exitCode !== 0) {
      exitCode = 1;
    }
  }

  const report: HarnessReport = {
    suite,
    status: exitCode === 0 ? "passed" : "failed",
    duration_ms: Date.now() - started,
    deterministic,
    live,
  };

  if (format === "json") {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printText(report);
  }

  process.exit(exitCode);
}

main();
