#!/usr/bin/env bun
/**
 * Chronicle Recap - Multi-session narrative recap for a project.
 *
 * Thin wrapper over `summarize.ts`'s narrative format. The synthesis logic,
 * fallback handling, prompt-building, and context-gathering all live in
 * summarize.ts; this script just parses recap-specific args and calls in.
 *
 * Usage:
 *   bun recap.ts                          # current project (from cwd), last 7 days
 *   bun recap.ts workspaces               # specific project
 *   bun recap.ts --days=14                # extend window
 *   bun recap.ts --stdout-only            # skip writing to ~/.claude/chronicle/recaps/  (portability: allow)
 */
import { generateSummary } from "./summarize.ts";
import { detectContext } from "./context.ts";
import { mkdirSync, writeFileSync } from "fs";

const RECAPS_DIR = `${process.env.HOME}/.claude/chronicle/recaps`;

interface Args {
  project: string | null;
  days: number;
  stdoutOnly: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { project: null, days: 7, stdoutOnly: false };
  for (const arg of argv) {
    if (arg.startsWith("--days=")) out.days = parseInt(arg.split("=")[1], 10);
    else if (arg === "--stdout-only") out.stdoutOnly = true;
    else if (!arg.startsWith("--") && !out.project) out.project = arg;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const ctx = detectContext(process.cwd());
  const project = args.project ?? ctx.project;

  if (!project) {
    console.error("[recap] could not determine project — pass one as the first arg");
    process.exit(1);
  }

  const result = await generateSummary({
    level: "repo",
    windowDays: args.days,
    repoName: project,
    format: "narrative",
    withContext: true,
  });

  if (!result.markdown) {
    console.error("[recap] no markdown returned (unexpected — narrative format should always populate markdown)");
    process.exit(1);
  }

  console.log(result.markdown);

  if (!args.stdoutOnly) {
    mkdirSync(RECAPS_DIR, { recursive: true });
    const date = new Date().toISOString().split("T")[0];
    const path = `${RECAPS_DIR}/${project}-${date}-${args.days}d.md`;
    writeFileSync(path, result.markdown);
    console.error(`[recap] wrote ${path}`);
  }
}

main().catch((err) => {
  console.error(`[recap] fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
