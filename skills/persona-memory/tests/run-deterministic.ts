#!/usr/bin/env bun
import { writeFileSync } from "fs";
import { join } from "path";

type ReportFormat = "text" | "json";

interface DeterministicReport {
  suite: "deterministic";
  status: "passed" | "failed";
  duration_ms: number;
  exit_code: number;
  test_paths: string[];
  eval: {
    status: "passed" | "failed";
    exit_code: number;
    report_file: string;
  };
  rebuild: {
    status: "passed" | "failed";
    exit_code: number;
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

function main() {
  const format = parseReportFormat();
  const reportFile = getArg("report-file");
  const skillDir = join(import.meta.dir, "..");
  const artifactsDir = join(skillDir, "tests", ".artifacts");
  const evalReportFile = join(artifactsDir, "eval-report.json");
  const testPaths = ["tests/unit", "tests/cli", "tests/integration"];

  const started = Date.now();
  const run = Bun.spawnSync(["bun", "test", ...testPaths], {
    cwd: skillDir,
    env: {
      ...process.env,
      AI_MEMORY_TEST_LIVE: "0",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const durationMs = Date.now() - started;
  const rebuildRun = Bun.spawnSync(["bun", "scripts/evalset-rebuild.ts", "--report", "json"], {
    cwd: skillDir,
    env: {
      ...process.env,
      AI_MEMORY_TEST_LIVE: "0",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const evalRun = Bun.spawnSync(["bun", "tests/eval.ts", "--report", "json", "--report-file", evalReportFile], {
    cwd: skillDir,
    env: {
      ...process.env,
      AI_MEMORY_TEST_LIVE: "0",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const evalStdout = new TextDecoder().decode(evalRun.stdout).trim();
  const evalStderr = new TextDecoder().decode(evalRun.stderr).trim();
  const rebuildStdout = new TextDecoder().decode(rebuildRun.stdout).trim();
  const rebuildStderr = new TextDecoder().decode(rebuildRun.stderr).trim();

  const stdout = new TextDecoder().decode(run.stdout).trim();
  const stderr = new TextDecoder().decode(run.stderr).trim();
  const report: DeterministicReport = {
    suite: "deterministic",
    status: run.exitCode === 0 && rebuildRun.exitCode === 0 && evalRun.exitCode === 0 ? "passed" : "failed",
    duration_ms: durationMs,
    exit_code: run.exitCode === 0 && rebuildRun.exitCode === 0 && evalRun.exitCode === 0 ? 0 : 1,
    test_paths: testPaths,
    rebuild: {
      status: rebuildRun.exitCode === 0 ? "passed" : "failed",
      exit_code: rebuildRun.exitCode,
    },
    eval: {
      status: evalRun.exitCode === 0 ? "passed" : "failed",
      exit_code: evalRun.exitCode,
      report_file: evalReportFile,
    },
  };

  if (reportFile) {
    writeFileSync(reportFile, JSON.stringify(report, null, 2) + "\n", "utf-8");
  }

  if (format === "json") {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`[deterministic] ${report.status} in ${durationMs}ms`);
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
    if (rebuildStdout) console.log(rebuildStdout);
    if (rebuildStderr) console.error(rebuildStderr);
    if (evalStdout) console.log(evalStdout);
    if (evalStderr) console.error(evalStderr);
  }

  process.exit(report.exit_code);
}

main();
