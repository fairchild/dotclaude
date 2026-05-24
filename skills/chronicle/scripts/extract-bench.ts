#!/usr/bin/env bun
/**
 * Chronicle extraction quality benchmark.
 *
 * Classifies blocks in ~/.claude/chronicle/blocks/ into:
 *   - fallback     summary matches fallbackEntry() templates from extract-lib.ts
 *   - narrative    summary is not a fallback template AND has challenges or nextSteps
 *   - curator      narrative + multi-item accomplished + challenges + nextSteps (or notes field)
 *   - thin-other   not fallback, but no narrative signals (rare)
 *
 * Emits a baseline report and optionally writes baseline.json for diffing
 * future runs (after Phase 2 lands).
 *
 * Usage:
 *   bun extract-bench.ts                  # report only
 *   bun extract-bench.ts --write-baseline # also write baseline.json sidecar
 *   bun extract-bench.ts --golden-set     # print curator-grade block paths for golden set
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import type { ChronicleBlock } from "./types.ts";

const CHRONICLE_DIR = `${process.env.HOME}/.claude/chronicle/blocks`;
const BASELINE_PATH = `${import.meta.dir}/extract-bench-baseline.json`;

type BlockClass = "fallback" | "narrative" | "curator" | "thin-other";

const FALLBACK_PATTERNS: RegExp[] = [
  /^Worked on .+: modified /,
  /^.+ session with \d+ actions$/,
  /^.+ session \(\d+ messages\)$/,
];

function isFallbackSummary(summary: string): boolean {
  return FALLBACK_PATTERNS.some((re) => re.test(summary));
}

function classify(b: ChronicleBlock): BlockClass {
  if (isFallbackSummary(b.summary)) return "fallback";

  const accLen = b.accomplished?.length ?? 0;
  const challLen = b.challenges?.length ?? 0;
  const stepLen = b.nextSteps?.length ?? 0;
  const hasNotes = typeof b.notes === "string" && b.notes.length > 0;

  if (hasNotes || (accLen >= 5 && challLen >= 1 && stepLen >= 2)) return "curator";
  if (challLen >= 1 || stepLen >= 1) return "narrative";
  return "thin-other";
}

interface BlockRow {
  path: string;
  timestamp: string;
  project: string;
  klass: BlockClass;
  messageCount: number;
  filesCount: number;
  accomplishedCount: number;
}

function loadBlocks(): BlockRow[] {
  if (!existsSync(CHRONICLE_DIR)) return [];
  const rows: BlockRow[] = [];
  for (const file of readdirSync(CHRONICLE_DIR)) {
    if (!file.endsWith(".json")) continue;
    const path = `${CHRONICLE_DIR}/${file}`;
    try {
      const b: ChronicleBlock = JSON.parse(readFileSync(path, "utf-8"));
      rows.push({
        path,
        timestamp: b.timestamp,
        project: b.project,
        klass: classify(b),
        messageCount: b.messageCount ?? 0,
        filesCount: b.filesModified?.length ?? 0,
        accomplishedCount: b.accomplished?.length ?? 0,
      });
    } catch {
      // skip unparseable blocks; counted separately if needed
    }
  }
  return rows;
}

interface Report {
  generatedAt: string;
  totalBlocks: number;
  byClass: Record<BlockClass, number>;
  byClassPct: Record<BlockClass, number>;
  recentFallbackRatio30d: number | null;
  goldenSetCandidates: string[];
}

function buildReport(rows: BlockRow[]): Report {
  const byClass: Record<BlockClass, number> = {
    fallback: 0,
    narrative: 0,
    curator: 0,
    "thin-other": 0,
  };
  for (const r of rows) byClass[r.klass]++;

  const total = rows.length;
  const byClassPct = Object.fromEntries(
    Object.entries(byClass).map(([k, v]) => [k, total === 0 ? 0 : +(100 * v / total).toFixed(1)])
  ) as Record<BlockClass, number>;

  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recent = rows.filter((r) => Date.parse(r.timestamp) >= cutoff);
  const recentFallbackRatio30d = recent.length === 0
    ? null
    : +(recent.filter((r) => r.klass === "fallback").length / recent.length).toFixed(3);

  const goldenSetCandidates = rows
    .filter((r) => r.klass === "curator")
    .sort((a, b) => (b.accomplishedCount - a.accomplishedCount) || (b.messageCount - a.messageCount))
    .slice(0, 20)
    .map((r) => r.path);

  return {
    generatedAt: new Date().toISOString(),
    totalBlocks: total,
    byClass,
    byClassPct,
    recentFallbackRatio30d,
    goldenSetCandidates,
  };
}

function renderHuman(report: Report): string {
  const out: string[] = [];
  out.push(`Chronicle extraction quality — ${report.generatedAt}`);
  out.push(`Blocks scanned: ${report.totalBlocks}`);
  out.push("");
  out.push("Class           Count   %     ");
  out.push("─".repeat(32));
  const order: BlockClass[] = ["fallback", "narrative", "curator", "thin-other"];
  for (const k of order) {
    const c = String(report.byClass[k]).padStart(5);
    const p = String(report.byClassPct[k]).padStart(5);
    out.push(`${k.padEnd(15)} ${c}  ${p}%`);
  }
  out.push("");
  out.push(`30d fallback ratio: ${report.recentFallbackRatio30d ?? "n/a"}`);
  out.push(`Golden set candidates: ${report.goldenSetCandidates.length} (curator-grade, ranked by accomplished count)`);
  return out.join("\n");
}

function main() {
  const args = new Set(process.argv.slice(2));
  const rows = loadBlocks();
  const report = buildReport(rows);

  if (args.has("--golden-set")) {
    for (const p of report.goldenSetCandidates) console.log(p);
    return;
  }

  console.log(renderHuman(report));

  if (args.has("--write-baseline")) {
    writeFileSync(BASELINE_PATH, JSON.stringify(report, null, 2));
    console.log(`\nBaseline written to ${BASELINE_PATH}`);
  }
}

if (import.meta.main) main();

export { classify, isFallbackSummary, buildReport, loadBlocks, FALLBACK_PATTERNS };
export type { BlockClass, Report, BlockRow };
