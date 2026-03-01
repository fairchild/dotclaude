#!/usr/bin/env bun
import { compileEvalset, ensureEvalsetInitialized, getEvalsetLayoutPaths, getEvalsetStats } from "./evalset-lib.ts";

type ReportFormat = "text" | "json";

interface RebuildReport {
  ok: boolean;
  code: "SUCCESS" | "REBUILD_FAILED";
  details: {
    layout: Record<string, string>;
    summary: ReturnType<typeof compileEvalset>;
    stats: ReturnType<typeof getEvalsetStats>;
  };
}

function getArg(name: string): string | null {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= process.argv.length) return null;
  return process.argv[idx + 1];
}

function parseFormat(): ReportFormat {
  const raw = getArg("report") || "text";
  return raw === "json" ? "json" : "text";
}

function main(): void {
  const format = parseFormat();

  try {
    ensureEvalsetInitialized();
    const summary = compileEvalset();
    const stats = getEvalsetStats();

    const report: RebuildReport = {
      ok: true,
      code: "SUCCESS",
      details: {
        layout: getEvalsetLayoutPaths(),
        summary,
        stats,
      },
    };

    if (format === "json") {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log("[evalset] rebuild success");
      console.log(
        `[evalset] base events=${summary.base.events} queries=${summary.base.queries} | ` +
          `compiled events=${summary.compiled.events} queries=${summary.compiled.queries}`,
      );
      console.log(
        `[evalset] labels latest events=${summary.labels.events_latest} queries=${summary.labels.queries_latest} | ` +
          `high_quality events=${summary.high_quality.events} queries=${summary.high_quality.queries}`,
      );
    }

    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const report: RebuildReport = {
      ok: false,
      code: "REBUILD_FAILED",
      details: {
        layout: getEvalsetLayoutPaths(),
        summary: {
          base: { events: 0, queries: 0 },
          compiled: { events: 0, queries: 0 },
          labels: { events_total: 0, queries_total: 0, events_latest: 0, queries_latest: 0 },
          high_quality: { events: 0, queries: 0 },
        },
        stats: {
          base_rows: { events: 0, queries: 0, total: 0 },
          labeled_good: { events: 0, queries: 0, total: 0 },
          labeled_bad: { events: 0, queries: 0, total: 0 },
          compiled_high_quality: { events: 0, queries: 0, total: 0 },
          unlabeled: { events: 0, queries: 0, total: 0 },
        },
      },
    };

    if (format === "json") {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.error(`[evalset] rebuild failed: ${message}`);
    }

    process.exit(1);
  }
}

main();
