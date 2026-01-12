#!/usr/bin/env bun
/**
 * Chronicle Worktree Mapping Report
 *
 * Identifies blocks with city-name projects that should be mapped to repos.
 * Also identifies blocks where branch name suggests a worktree was used.
 * Does NOT auto-fix - outputs a report for manual review.
 *
 * Usage:
 *   bun ~/.claude/scripts/chronicle-worktree-report.ts
 */
import { readdirSync, readFileSync } from "fs";

const CHRONICLE_DIR = `${process.env.HOME}/.claude/chronicle/blocks`;

// City names commonly used as worktree names (comprehensive list from branch analysis)
const CITY_NAMES = new Set([
  // Common worktree cities (observed in branches)
  "barcelona", "dallas", "sydney", "riyadh", "karachi", "denpasar",
  "moab", "munich", "cayenne", "provo", "kiev", "miami", "krakow",
  "denver", "copenhagen", "accra", "dublin", "muscat", "montreal",
  "pangyo", "bordeaux", "guangzhou", "nuuk", "brasilia", "buffalo",
  "lahore", "kabul", "west-monroe", "baton-rouge", "cape-town",
  "asuncion", "calgary", "amman", "missoula", "san-francisco",
  // V1 variants
  "columbus-v1", "denpasar-v1", "san-antonio-v1", "kabul-v2",
  // Additional cities that might be used
  "tokyo", "london", "paris", "berlin", "rome", "madrid", "lisbon",
  "amsterdam", "brussels", "vienna", "prague", "warsaw", "budapest",
  "athens", "stockholm", "oslo", "helsinki", "dublin", "edinburgh",
  "bangkok", "singapore", "hong-kong", "seoul", "taipei", "manila",
  "jakarta", "kuala-lumpur", "hanoi", "mumbai", "delhi", "bangalore",
  "chennai", "kolkata", "hyderabad", "pune", "ahmedabad", "cairo",
  "lagos", "nairobi", "johannesburg", "cape-town", "casablanca",
  "tunis", "algiers", "addis-ababa", "kinshasa", "luanda", "accra",
  "dakar", "abidjan", "kampala", "dar-es-salaam", "khartoum",
  "sao-paulo", "rio", "buenos-aires", "santiago", "lima", "bogota",
  "caracas", "quito", "montevideo", "la-paz", "mexico-city",
  "toronto", "vancouver", "montreal", "ottawa", "calgary", "edmonton",
  "seattle", "portland", "phoenix", "austin", "houston", "chicago",
  "boston", "atlanta", "detroit", "minneapolis", "st-louis",
]);

// Known valid repo names
const KNOWN_REPOS = new Set([
  "planventura", "jrnlfish-v4", "services", "bread-builder",
  "bread-builder-ios", "dotclaude",
]);

// Also flag these as likely incorrect project names
const SUSPICIOUS_PROJECTS = new Set(["code", "workspaces"]);

interface BlockIssue {
  file: string;
  currentProject: string;
  suggestedRepo: string | null;
  timestamp: string;
  branch: string | null;
  summary: string;
  sessionId: string;
  accomplished: string[];
}

interface ChronicleBlock {
  timestamp: string;
  sessionId: string;
  project: string;
  worktree?: string;
  branch: string | null;
  summary: string;
  accomplished: string[];
  pending: string[];
}

interface WorktreeCandidate {
  file: string;
  project: string;
  branch: string;
  timestamp: string;
  hasWorktreeField: boolean;
}

function main() {
  const files = readdirSync(CHRONICLE_DIR).filter((f) => f.endsWith(".json"));
  const issues: BlockIssue[] = [];
  const worktreeCandidates: WorktreeCandidate[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(`${CHRONICLE_DIR}/${file}`, "utf-8");
      const block: ChronicleBlock = JSON.parse(content);

      const project = block.project?.toLowerCase();
      const branch = block.branch?.toLowerCase();

      // Check if project name looks like a city/worktree name or is suspicious
      if (CITY_NAMES.has(project) || SUSPICIOUS_PROJECTS.has(project)) {
        issues.push({
          file,
          currentProject: block.project,
          suggestedRepo: null, // Will need manual review
          timestamp: block.timestamp,
          branch: block.branch,
          summary: block.summary,
          sessionId: block.sessionId,
          accomplished: block.accomplished || [],
        });
      }

      // Check if branch name looks like a city (could indicate worktree used)
      if (branch && CITY_NAMES.has(branch) && KNOWN_REPOS.has(project) && !block.worktree) {
        worktreeCandidates.push({
          file,
          project: block.project,
          branch: block.branch!,
          timestamp: block.timestamp,
          hasWorktreeField: !!block.worktree,
        });
      }
    } catch {
      // Skip malformed files
    }
  }

  // Output report
  console.log("# Chronicle Worktree Mapping Report");
  console.log(`Generated: ${new Date().toISOString()}`);
  console.log(`Total blocks scanned: ${files.length}`);
  console.log(`Blocks with city-name projects (need fix): ${issues.length}`);
  console.log(`Blocks with city-name branches (could backfill worktree): ${worktreeCandidates.length}`);
  console.log("");

  // Section 1: Wrong project names
  if (issues.length > 0) {
    console.log("## Part 1: Blocks with Wrong Project Names\n");
    console.log("These blocks have city names as projects and need the project field fixed.\n");

    // Group by current project
    const byProject = new Map<string, BlockIssue[]>();
    for (const issue of issues) {
      const existing = byProject.get(issue.currentProject) || [];
      existing.push(issue);
      byProject.set(issue.currentProject, existing);
    }

    for (const [project, projectIssues] of byProject) {
      console.log(`### Project: \`${project}\` (${projectIssues.length} blocks)\n`);

      for (const issue of projectIssues) {
        console.log(`**File:** \`${issue.file}\``);
        console.log(`- Timestamp: ${issue.timestamp}`);
        console.log(`- Branch: ${issue.branch || "(none)"}`);
        console.log(`- Summary: ${issue.summary?.substring(0, 100) || "(no summary)"}...`);
        if (issue.accomplished.length > 0) {
          console.log(`- Accomplished: ${issue.accomplished.slice(0, 2).join("; ")}`);
        }
        console.log("");
      }
    }
  } else {
    console.log("## Part 1: No Wrong Project Names Found\n");
  }

  // Section 2: Worktree candidates (correct project, city branch, no worktree field)
  console.log("---\n");
  console.log("## Part 2: Blocks Where Worktree Could Be Inferred\n");
  console.log("These have correct project names but branch looks like a city (the worktree used).\n");

  if (worktreeCandidates.length > 0) {
    // Group by branch (city name)
    const byBranch = new Map<string, WorktreeCandidate[]>();
    for (const candidate of worktreeCandidates) {
      const existing = byBranch.get(candidate.branch) || [];
      existing.push(candidate);
      byBranch.set(candidate.branch, existing);
    }

    // Sort by count descending
    const sortedBranches = [...byBranch.entries()].sort((a, b) => b[1].length - a[1].length);

    console.log("| Branch (Worktree?) | Count | Projects |");
    console.log("|-------------------|-------|----------|");
    for (const [branch, candidates] of sortedBranches) {
      const projects = [...new Set(candidates.map(c => c.project))].join(", ");
      console.log(`| ${branch} | ${candidates.length} | ${projects} |`);
    }
    console.log("");
    console.log(`Total: ${worktreeCandidates.length} blocks could have worktree field backfilled.\n`);
  } else {
    console.log("No candidates found.\n");
  }

  // Section 3: Instructions
  console.log("---\n");
  console.log("## Manual Fix Instructions\n");
  console.log("**For Part 1 (wrong project):** Edit JSON, change `project` to correct repo name.\n");
  console.log("**For Part 2 (backfill worktree):** Add `worktree` field with the branch/city name.\n");
  console.log("Example:");
  console.log("```json");
  console.log("{");
  console.log('  "project": "jrnlfish-v4",');
  console.log('  "worktree": "barcelona",');
  console.log("  ...");
  console.log("}");
  console.log("```");
}

main();
