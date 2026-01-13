#!/usr/bin/env bun
/**
 * Chronicle Worktree Backfill Script
 *
 * Fixes blocks with wrong project names and backfills worktree field
 * where it can be inferred from branch name.
 *
 * Usage:
 *   bun scripts/chronicle-worktree-backfill.ts          # Dry run (preview)
 *   bun scripts/chronicle-worktree-backfill.ts --apply  # Apply changes
 */
import { readdirSync, readFileSync, writeFileSync } from "fs";

const CHRONICLE_DIR = `${process.env.HOME}/.claude/chronicle/blocks`;
const DRY_RUN = !process.argv.includes("--apply");

// City names commonly used as worktree names
const CITY_NAMES = new Set([
  "barcelona", "dallas", "sydney", "riyadh", "karachi", "denpasar",
  "moab", "munich", "cayenne", "provo", "kiev", "miami", "krakow",
  "denver", "copenhagen", "accra", "dublin", "muscat", "montreal",
  "pangyo", "bordeaux", "guangzhou", "nuuk", "brasilia", "buffalo",
  "lahore", "kabul", "west-monroe", "baton-rouge", "cape-town",
  "asuncion", "calgary", "amman", "missoula", "san-francisco",
  "columbus-v1", "denpasar-v1", "san-antonio-v1", "kabul-v2",
  "tokyo", "london", "paris", "berlin", "rome", "madrid", "lisbon",
  "amsterdam", "brussels", "vienna", "prague", "warsaw", "budapest",
  "athens", "stockholm", "oslo", "helsinki", "edinburgh",
  "bangkok", "singapore", "hong-kong", "seoul", "taipei", "manila",
  "jakarta", "kuala-lumpur", "hanoi", "mumbai", "delhi", "bangalore",
  "chennai", "kolkata", "hyderabad", "pune", "ahmedabad", "cairo",
  "lagos", "nairobi", "johannesburg", "casablanca",
  "tunis", "algiers", "addis-ababa", "kinshasa", "luanda",
  "dakar", "abidjan", "kampala", "dar-es-salaam", "khartoum",
  "sao-paulo", "rio", "buenos-aires", "santiago", "lima", "bogota",
  "caracas", "quito", "montevideo", "la-paz", "mexico-city",
  "toronto", "vancouver", "ottawa", "edmonton",
  "seattle", "portland", "phoenix", "austin", "houston", "chicago",
  "boston", "atlanta", "detroit", "minneapolis", "st-louis",
]);

// Known valid repo names
const KNOWN_REPOS = new Set([
  "planventura", "jrnlfish-v4", "services", "bread-builder",
  "bread-builder-ios", "dotclaude",
]);

// Mapping from city (worktree) to repo - based on historical data
const CITY_TO_REPO: Record<string, string> = {
  // jrnlfish-v4 worktrees
  "columbus-v1": "jrnlfish-v4",
  "accra": "jrnlfish-v4",
  "cayenne": "jrnlfish-v4",
  "montreal": "jrnlfish-v4",
  "pangyo": "jrnlfish-v4",
  "bordeaux": "jrnlfish-v4",
  "west-monroe": "jrnlfish-v4",
  "munich": "jrnlfish-v4",
  "santiago": "jrnlfish-v4",
  "kampala": "jrnlfish-v4",
  // bread-builder-ios worktrees
  "barcelona": "bread-builder-ios",
  "riyadh": "bread-builder-ios",
  "lahore": "bread-builder-ios",
  "san-francisco": "bread-builder-ios",
  "missoula": "bread-builder-ios",
  // bread-builder worktrees
  "provo": "bread-builder",
  "kiev": "bread-builder",
  "miami": "bread-builder",
  "baton-rouge": "bread-builder",
  "calgary": "bread-builder",
  "asuncion": "bread-builder",
  "cape-town": "bread-builder",
  "amman": "bread-builder",
  // planventura worktrees
  "dallas": "planventura",
  "sydney": "planventura",
  "karachi": "planventura",
  "denpasar": "planventura",
  "moab": "planventura",
  "kabul-v2": "planventura",
  "krakow": "planventura",
  "denver": "planventura",
  "cairo": "planventura",
  "guangzhou": "planventura",
  "nuuk": "planventura",
  // services worktrees
  "dublin": "services",
  "lisbon": "services",
  "paris": "services",
  "chennai": "services",
  "buffalo": "services",
  "brasilia": "services",
  // dotclaude worktrees
  "copenhagen": "dotclaude",
  "muscat": "dotclaude",
  "denpasar-v1": "dotclaude",
  "stockholm": "dotclaude",
  "hanoi": "dotclaude",
};

interface ChronicleBlock {
  timestamp: string;
  sessionId: string;
  project: string;
  worktree?: string;
  branch: string | null;
  summary: string;
  accomplished: string[];
  pending: string[];
  filesModified?: string[];
  messageCount?: number;
  [key: string]: unknown;
}

interface Change {
  file: string;
  type: "fix_project" | "add_worktree";
  before: { project: string; worktree?: string };
  after: { project: string; worktree?: string };
}

function main() {
  console.log(`# Chronicle Worktree Backfill ${DRY_RUN ? "(DRY RUN)" : "(APPLYING CHANGES)"}`);
  console.log(`Generated: ${new Date().toISOString()}\n`);

  if (DRY_RUN) {
    console.log("Run with --apply to make changes.\n");
  }

  const files = readdirSync(CHRONICLE_DIR).filter((f) => f.endsWith(".json"));
  const changes: Change[] = [];

  for (const file of files) {
    try {
      const filepath = `${CHRONICLE_DIR}/${file}`;
      const content = readFileSync(filepath, "utf-8");
      const block: ChronicleBlock = JSON.parse(content);

      const project = block.project?.toLowerCase();
      const branch = block.branch?.toLowerCase();
      let modified = false;
      const before = { project: block.project, worktree: block.worktree };

      // Part 1: Fix wrong project names (city as project)
      if (CITY_NAMES.has(project) && !KNOWN_REPOS.has(project)) {
        const correctRepo = CITY_TO_REPO[project];
        if (correctRepo) {
          block.worktree = block.project; // Preserve city as worktree
          block.project = correctRepo;
          modified = true;
          changes.push({
            file,
            type: "fix_project",
            before,
            after: { project: block.project, worktree: block.worktree },
          });
        }
      }

      // Part 2: Add worktree from branch name
      if (!modified && !block.worktree && branch && CITY_NAMES.has(branch) && KNOWN_REPOS.has(project)) {
        block.worktree = block.branch!;
        modified = true;
        changes.push({
          file,
          type: "add_worktree",
          before,
          after: { project: block.project, worktree: block.worktree },
        });
      }

      // Write changes
      if (modified && !DRY_RUN) {
        writeFileSync(filepath, JSON.stringify(block, null, 2));
      }
    } catch {
      // Skip malformed files
    }
  }

  // Report
  const fixes = changes.filter((c) => c.type === "fix_project");
  const backfills = changes.filter((c) => c.type === "add_worktree");

  console.log(`## Summary\n`);
  console.log(`- Blocks scanned: ${files.length}`);
  console.log(`- Project fixes: ${fixes.length}`);
  console.log(`- Worktree backfills: ${backfills.length}`);
  console.log(`- Total changes: ${changes.length}\n`);

  if (fixes.length > 0) {
    console.log(`## Part 1: Project Fixes (${fixes.length})\n`);
    for (const change of fixes) {
      console.log(`- \`${change.file}\``);
      console.log(`  - Before: project=\`${change.before.project}\``);
      console.log(`  - After: project=\`${change.after.project}\`, worktree=\`${change.after.worktree}\``);
    }
    console.log("");
  }

  if (backfills.length > 0) {
    console.log(`## Part 2: Worktree Backfills (${backfills.length})\n`);

    // Group by worktree
    const byWorktree = new Map<string, Change[]>();
    for (const change of backfills) {
      const wt = change.after.worktree || "unknown";
      const existing = byWorktree.get(wt) || [];
      existing.push(change);
      byWorktree.set(wt, existing);
    }

    const sorted = [...byWorktree.entries()].sort((a, b) => b[1].length - a[1].length);
    console.log(`| Worktree | Count |`);
    console.log(`|----------|-------|`);
    for (const [wt, wtChanges] of sorted) {
      console.log(`| ${wt} | ${wtChanges.length} |`);
    }
    console.log("");
  }

  if (!DRY_RUN && changes.length > 0) {
    console.log(`\n**${changes.length} blocks updated.**`);
  } else if (DRY_RUN && changes.length > 0) {
    console.log(`\n**Run with --apply to update ${changes.length} blocks.**`);
  } else {
    console.log(`\nNo changes needed.`);
  }
}

main();
