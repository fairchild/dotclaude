#!/usr/bin/env bun
/**
 * Chronicle Dashboard - Newspaper-style UI for exploring session history.
 *
 * Structure:
 *   FRONT PAGE (above the fold) - Aggregated highlights
 *   INSIDE (below the fold) - Project breakdowns & session details
 *
 * Usage:
 *   bun dashboard.ts
 *
 * Opens browser to http://localhost:3456
 */
import {
  loadAllBlocks,
  getDateRanges,
  type ChronicleBlock,
  type ProjectStats,
} from "./queries.ts";
import {
  getGlobalUsage,
  getRepoUsage,
  getToolBreakdown,
  getPeakHours,
} from "./usage-queries.ts";
import { readdirSync, statSync, existsSync } from "fs";
import { execSync } from "child_process";

const PORT = parseInt(process.env.PORT || "3456");
const WORKTREES_ROOT = `${process.env.HOME}/.worktrees`;

// Worktree status for Mission Control sidebar
interface WorktreeStatus {
  name: string;
  repo: string;
  path: string;
  branch: string;
  mainRepoPath: string;
  gitStatus: "clean" | "dirty";
  uncommittedFiles: number;
  lastCommitTime: string;
  session: {
    active: boolean;
    lastActivity: string;
    ageMinutes: number;
  } | null;
  chronicle: {
    latestSummary: string;
    pendingCount: number;
    pending: string[];
  } | null;
}

// Derive main repo path from worktree's .git file
function getMainRepoPath(wtPath: string): string {
  try {
    const gitFile = `${wtPath}/.git`;
    const content = require("fs").readFileSync(gitFile, "utf-8");
    // Format: gitdir: /path/to/main/.git/worktrees/{branch}
    const match = content.match(/gitdir:\s*(.+)/);
    if (match) {
      const gitdir = match[1].trim();
      // Extract main repo: remove .git/worktrees/{branch}
      const mainGit = gitdir.replace(/\/\.git\/worktrees\/[^/]+$/, "");
      return mainGit;
    }
  } catch {
    // Graceful degradation - worktree may not have standard .git file format
  }
  return "";
}

// Random name generator for new worktrees
const ADJECTIVES = [
  "brave", "swift", "calm", "wild", "quiet", "bold", "keen", "wise",
  "warm", "cool", "fair", "fond", "glad", "kind", "soft", "true",
  "free", "pure", "rare", "safe", "sure", "vast", "wary", "zany",
  "deft", "fine", "good", "hale", "neat", "spry"
];
const NOUNS = [
  "fox", "moon", "river", "hawk", "oak", "wolf", "bear", "deer",
  "dove", "elm", "fern", "glen", "hill", "lake", "lynx", "nest",
  "peak", "pine", "reef", "sage", "star", "tide", "vale", "wind",
  "wren", "aspen", "cedar", "maple", "birch", "coral"
];

function generateRandomName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj}-${noun}`;
}

function getSessionStatus(wtPath: string): WorktreeStatus["session"] | null {
  // Path encoding: /Users/x/.worktrees/y -> -Users-x--worktrees-y
  // Both / and . become -
  const encodedPath = wtPath.replace(/[/.]/g, "-");
  const claudeProjectDir = `${process.env.HOME}/.claude/projects/${encodedPath}`;

  if (!existsSync(claudeProjectDir)) return null;

  try {
    const files = readdirSync(claudeProjectDir);
    const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));
    if (jsonlFiles.length === 0) return null;

    let latestMtime = 0;
    for (const file of jsonlFiles) {
      const mtime = statSync(`${claudeProjectDir}/${file}`).mtimeMs;
      if (mtime > latestMtime) latestMtime = mtime;
    }

    const ageMinutes = Math.floor((Date.now() - latestMtime) / 60000);
    return {
      active: ageMinutes < 5,
      lastActivity: new Date(latestMtime).toISOString(),
      ageMinutes,
    };
  } catch {
    return null;
  }
}

function getChronicleForWorktree(
  repo: string,
  branch: string
): WorktreeStatus["chronicle"] | null {
  const blocks = loadAllBlocks();
  const matching = blocks.filter(
    (b) =>
      b.project.toLowerCase() === repo.toLowerCase() && b.branch === branch
  );

  if (matching.length === 0) return null;

  const latest = matching[0];
  const allPending = matching.flatMap((b) => b.pending);
  const uniquePending = [...new Set(allPending)];

  return {
    latestSummary: latest.summary,
    pendingCount: uniquePending.length,
    pending: uniquePending.slice(0, 3),
  };
}

function getWorktreeStatus(): WorktreeStatus[] {
  const worktrees: WorktreeStatus[] = [];

  if (!existsSync(WORKTREES_ROOT)) return worktrees;

  try {
    for (const repo of readdirSync(WORKTREES_ROOT)) {
      if (repo.startsWith(".")) continue;
      const repoPath = `${WORKTREES_ROOT}/${repo}`;
      if (!statSync(repoPath).isDirectory()) continue;

      for (const branch of readdirSync(repoPath)) {
        const wtPath = `${repoPath}/${branch}`;
        if (!existsSync(`${wtPath}/.git`)) continue;

        try {
          const gitBranch = execSync(`git -C "${wtPath}" branch --show-current`, {
            encoding: "utf-8",
          }).trim();
          const gitStatusOutput = execSync(
            `git -C "${wtPath}" status --porcelain`,
            { encoding: "utf-8" }
          );
          const uncommittedFiles = gitStatusOutput
            .split("\n")
            .filter(Boolean).length;
          const lastCommitTime = execSync(
            `git -C "${wtPath}" log -1 --format=%cI 2>/dev/null || echo ""`,
            { encoding: "utf-8" }
          ).trim();

          const session = getSessionStatus(wtPath);
          const chronicle = getChronicleForWorktree(repo, gitBranch);
          const mainRepoPath = getMainRepoPath(wtPath);

          worktrees.push({
            name: branch,
            repo,
            path: wtPath,
            branch: gitBranch,
            mainRepoPath,
            gitStatus: uncommittedFiles === 0 ? "clean" : "dirty",
            uncommittedFiles,
            lastCommitTime,
            session,
            chronicle,
          });
        } catch {
          // Skip worktrees with git errors
        }
      }
    }
  } catch {
    return worktrees;
  }

  return worktrees.sort((a, b) => {
    if (a.session?.active && !b.session?.active) return -1;
    if (!a.session?.active && b.session?.active) return 1;
    return (a.session?.ageMinutes ?? Infinity) - (b.session?.ageMinutes ?? Infinity);
  });
}

// Archived worktrees info
interface ArchivedWorktree {
  name: string;
  repo: string;
  archivedAt: string;
  chronicle: { latestSummary: string; pendingCount: number } | null;
}

function getArchivedWorktrees(repoName?: string): ArchivedWorktree[] {
  const archiveRoot = `${process.env.HOME}/.worktrees/.archive`;
  if (!existsSync(archiveRoot)) return [];

  const archived: ArchivedWorktree[] = [];
  const allBlocks = loadAllBlocks(); // Load once, not per worktree

  try {
    const repos = repoName ? [repoName] : readdirSync(archiveRoot).filter(f => !f.startsWith("."));

    for (const repo of repos) {
      const repoArchive = `${archiveRoot}/${repo}`;
      if (!existsSync(repoArchive) || !statSync(repoArchive).isDirectory()) continue;

      for (const name of readdirSync(repoArchive)) {
        const wtPath = `${repoArchive}/${name}`;
        if (!statSync(wtPath).isDirectory()) continue;

        const archivedAt = statSync(wtPath).mtime.toISOString();

        // Try to get chronicle data - match by branch name (worktree names often match branch)
        const matching = allBlocks.filter(
          (b) => b.project.toLowerCase() === repo.toLowerCase() &&
                 (b.worktree === name || b.branch === name)
        );
        const chronicle = matching.length > 0
          ? { latestSummary: matching[0].summary, pendingCount: matching.flatMap(b => b.pending).length }
          : null;

        archived.push({ name, repo, archivedAt, chronicle });
      }
    }
  } catch {
    return archived;
  }

  return archived.sort((a, b) => new Date(b.archivedAt).getTime() - new Date(a.archivedAt).getTime());
}

// Load saved AI summaries
interface SavedSummary {
  level: string;
  period: string;
  date: string;
  repo?: string;
  narrative: string;
  highlights: string[];
  pending: string[];
  generatedAt: string;
}

function loadRepoSummaries(repoName: string): SavedSummary[] {
  const summaryDir = `${process.env.HOME}/.claude/chronicle/summaries/repos/${repoName.toLowerCase()}`;
  if (!existsSync(summaryDir)) return [];

  const summaries: SavedSummary[] = [];
  try {
    for (const file of readdirSync(summaryDir).filter(f => f.endsWith(".json"))) {
      const content = require("fs").readFileSync(`${summaryDir}/${file}`, "utf-8");
      summaries.push(JSON.parse(content));
    }
  } catch {}

  return summaries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

// Load deep insights from chronicle-insights agent
interface DeepInsight {
  type: "tech_debt" | "stalled_work" | "pattern" | "opportunity";
  title: string;
  detail: string;
  evidence: string[];
  recommendation: string;
}

interface DeepInsightsFile {
  project: string;
  generatedAt: string;
  generatedBy: string;
  explorationDepth: string;
  insights: DeepInsight[];
  crossProjectPatterns: string[];
  stalledItems: string[];
  summary: string;
}

function loadDeepInsights(repoName: string): DeepInsightsFile | null {
  const insightsDir = `${process.env.HOME}/.claude/chronicle/insights`;
  if (!existsSync(insightsDir)) return null;

  try {
    const files = readdirSync(insightsDir)
      .filter(f => f.toLowerCase().includes(repoName.toLowerCase()) && f.endsWith(".json"))
      .sort()
      .reverse();

    if (files.length === 0) return null;

    const content = require("fs").readFileSync(`${insightsDir}/${files[0]}`, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

// Generate insights from memory blocks (pattern detection)
interface RepoInsights {
  themes: string[];
  patterns: string[];
  hotspots: string[];
  velocity: { trend: "increasing" | "decreasing" | "stable"; change: number };
}

function analyzeRepoPatterns(repoName: string): RepoInsights {
  const blocks = loadAllBlocks().filter(
    (b) => b.project.toLowerCase().includes(repoName.toLowerCase())
  );

  if (blocks.length < 2) {
    return { themes: [], patterns: [], hotspots: [], velocity: { trend: "stable", change: 0 } };
  }

  // Extract themes from accomplishments
  const allAccomplished = blocks.flatMap(b => b.accomplished);
  const wordFreq = new Map<string, number>();
  const stopWords = new Set(["the", "a", "an", "to", "for", "of", "in", "on", "with", "and", "is", "was", "are", "were", "this", "that"]);

  for (const text of allAccomplished) {
    for (const word of text.toLowerCase().split(/\W+/)) {
      if (word.length > 3 && !stopWords.has(word)) {
        wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
      }
    }
  }

  const themes = Array.from(wordFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);

  // Detect patterns (recurring pending items, repeated work areas)
  const pendingFreq = new Map<string, number>();
  for (const block of blocks) {
    for (const p of block.pending) {
      const key = p.toLowerCase().substring(0, 50);
      pendingFreq.set(key, (pendingFreq.get(key) || 0) + 1);
    }
  }

  const patterns: string[] = [];
  for (const [text, count] of pendingFreq) {
    if (count >= 2) {
      patterns.push(`Recurring: "${text.substring(0, 40)}..." (${count}x)`);
    }
  }

  // Hotspots (most modified files)
  const fileFreq = new Map<string, number>();
  for (const block of blocks) {
    for (const f of block.filesModified || []) {
      fileFreq.set(f, (fileFreq.get(f) || 0) + 1);
    }
  }

  const hotspots = Array.from(fileFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([file, count]) => `${file.split("/").pop()} (${count} sessions)`);

  // Velocity trend (comparing recent vs older activity)
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const twoWeeksAgo = now - 14 * 24 * 60 * 60 * 1000;

  const recentCount = blocks.filter(b => new Date(b.timestamp).getTime() > weekAgo).length;
  const olderCount = blocks.filter(b => {
    const t = new Date(b.timestamp).getTime();
    return t > twoWeeksAgo && t <= weekAgo;
  }).length;

  const change = olderCount > 0 ? Math.round(((recentCount - olderCount) / olderCount) * 100) : 0;
  const trend = change > 20 ? "increasing" : change < -20 ? "decreasing" : "stable";

  return { themes, patterns: patterns.slice(0, 3), hotspots, velocity: { trend, change } };
}

interface FrontPage {
  headline: string;
  dateline: string;
  leadStory: string;         // Narrative prose for the main story
  topStories: string[];      // Notable accomplishments (aggregated)
  challenges: string[];      // Problems/blockers encountered
  whatsNext: string[];       // Top pending items
  insights: string[];        // Observations
}

interface ProjectBreakdown {
  project: string;
  sessionCount: number;
  branches: string[];
  narrative: string;         // Natural language summary
  accomplished: string[];
  pending: string[];
}

type Period = "daily" | "weekly" | "monthly";

// Generate front page content from blocks
function generateFrontPage(blocks: ChronicleBlock[], stats: ProjectStats[], period: Period = "weekly"): FrontPage {
  if (blocks.length === 0) {
    return {
      headline: "No activity recorded",
      dateline: new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }),
      leadStory: "Start a coding session to see your Chronicle come to life.",
      topStories: [],
      challenges: [],
      whatsNext: [],
      insights: [],
    };
  }

  const totalSessions = blocks.length;
  const projectCount = stats.length;
  const topProject = stats[0];
  const topProjectPct = Math.round((topProject.sessionCount / totalSessions) * 100);

  // Collect all accomplishments and pending, tracking source project
  const allAccomplished: { text: string; project: string; timestamp: string }[] = [];
  const allPending: { text: string; project: string; timestamp: string }[] = [];
  const allChallenges: string[] = [];

  for (const block of blocks) {
    for (const a of block.accomplished) {
      allAccomplished.push({ text: a, project: block.project, timestamp: block.timestamp });
    }
    for (const p of block.pending) {
      allPending.push({ text: p, project: block.project, timestamp: block.timestamp });
    }
    if (block.challenges) {
      allChallenges.push(...block.challenges);
    }
  }

  // Curate top stories: pick notable accomplishments across projects
  // Strategy: one from each project (max 5), prioritize recent
  const topStories: string[] = [];
  const seenProjects = new Set<string>();

  // Sort by recency
  allAccomplished.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  for (const item of allAccomplished) {
    if (topStories.length >= 5) break;
    if (!seenProjects.has(item.project) || topStories.length < 3) {
      // Skip very generic items
      const lower = item.text.toLowerCase();
      if (lower.includes("renamed branch") || (lower.includes("reviewed") && lower.length < 40)) continue;
      topStories.push(item.text);
      seenProjects.add(item.project);
    }
  }

  // What's next: top pending items (diverse across projects)
  const whatsNext: string[] = [];
  const seenPendingProjects = new Set<string>();

  // Sort by recency
  allPending.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  for (const item of allPending) {
    if (whatsNext.length >= 5) break;
    if (!seenPendingProjects.has(item.project) || whatsNext.length < 3) {
      whatsNext.push(item.text);
      seenPendingProjects.add(item.project);
    }
  }

  // Dedupe challenges
  const uniqueChallenges = [...new Set(allChallenges)].slice(0, 3);

  // Generate headline
  const headline = topProjectPct >= 50
    ? `Deep focus on ${topProject.project}`
    : projectCount === 1
    ? `All work on ${topProject.project}`
    : `Work across ${projectCount} projects`;

  // Generate dateline
  const dates = blocks.map(b => new Date(b.timestamp)).sort((a, b) => a.getTime() - b.getTime());
  const startDate = dates[0];
  const endDate = dates[dates.length - 1];
  const dateline = startDate.toDateString() === endDate.toDateString()
    ? startDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
    : `${startDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${endDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

  // Generate lead story narrative
  const totalPending = new Set(allPending.map(p => p.text)).size;

  // Build a narrative lead story
  const leadParts: string[] = [];
  const periodWord = period === "daily" ? "day" : period === "monthly" ? "month" : "week";

  // Opening sentence - set the scene
  if (topProjectPct >= 60) {
    leadParts.push(`This was a ${periodWord} of deep focus. ${topProject.project} commanded attention with ${topProject.sessionCount} sessions, representing ${topProjectPct}% of all coding activity.`);
  } else if (topProjectPct >= 40) {
    leadParts.push(`${topProject.project} led the ${periodWord}'s efforts with ${topProject.sessionCount} sessions (${topProjectPct}% of activity), while work continued across ${projectCount - 1} other project${projectCount > 2 ? 's' : ''}.`);
  } else if (projectCount >= 4) {
    leadParts.push(`A ${periodWord} of distributed effort across ${projectCount} projects. No single project dominated, with work spread between ${stats.slice(0, 3).map(s => s.project).join(', ')}, and others.`);
  } else {
    leadParts.push(`${totalSessions} coding sessions spanned ${projectCount} project${projectCount > 1 ? 's' : ''} this period.`);
  }

  // Middle - what was accomplished
  if (topStories.length > 0) {
    const highlightVerbs = ["Key accomplishments include", "Notable progress was made on", `The ${periodWord} saw advances in`];
    const verb = highlightVerbs[Math.floor(blocks.length % highlightVerbs.length)];
    // Take first 2-3 top stories and weave into prose
    if (topStories.length >= 2) {
      leadParts.push(`${verb} ${topStories[0].toLowerCase()}, as well as ${topStories[1].toLowerCase()}.`);
    } else {
      leadParts.push(`${verb} ${topStories[0].toLowerCase()}.`);
    }
  }

  // Closing - what's ahead
  if (whatsNext.length > 0) {
    const pendingIntros = ["Looking ahead,", "Work continues on", "Attention turns next to"];
    const intro = pendingIntros[Math.floor(blocks.length % pendingIntros.length)];
    leadParts.push(`${intro} ${whatsNext[0].toLowerCase()}${whatsNext.length > 1 ? ` and ${whatsNext.length - 1} other pending item${whatsNext.length > 2 ? 's' : ''}` : ''}.`);
  }

  // Add challenges if any
  if (uniqueChallenges.length > 0) {
    leadParts.push(`Challenges encountered include ${uniqueChallenges[0].toLowerCase()}.`);
  }

  const leadStory = leadParts.join(' ');

  // Generate insights
  const insights: string[] = [];

  if (topProjectPct >= 60) {
    insights.push(`Heavy concentration on ${topProject.project}`);
  } else if (projectCount >= 4) {
    insights.push(`High context-switching across ${projectCount} projects`);
  }

  const activeBranches = stats.reduce((sum, s) => sum + s.branches.length, 0);
  if (activeBranches > 10) {
    insights.push(`${activeBranches} active branches`);
  }

  const totalAccomplished = new Set(allAccomplished.map(a => a.text)).size;
  if (totalPending > totalAccomplished * 2) {
    insights.push(`Pending items outpacing accomplishments`);
  }

  return {
    headline,
    dateline,
    leadStory,
    topStories,
    challenges: uniqueChallenges,
    whatsNext,
    insights,
  };
}

// Generate a narrative summary for a project
function generateProjectNarrative(
  project: string,
  sessionCount: number,
  branches: string[],
  accomplished: string[],
  pending: string[],
  totalSessions: number
): string {
  const parts: string[] = [];
  const pct = Math.round((sessionCount / totalSessions) * 100);

  // Opening - session activity
  if (pct >= 40) {
    parts.push(`${project} was the primary focus this period, accounting for ${sessionCount} sessions (${pct}% of all activity).`);
  } else if (sessionCount >= 10) {
    parts.push(`Significant work continued on ${project} with ${sessionCount} sessions.`);
  } else if (sessionCount >= 3) {
    parts.push(`${project} saw steady progress across ${sessionCount} sessions.`);
  } else {
    parts.push(`Light activity on ${project} with ${sessionCount} session${sessionCount > 1 ? 's' : ''}.`);
  }

  // Branch context
  if (branches.length > 1) {
    parts.push(`Work spanned ${branches.length} branches including ${branches.slice(0, 2).join(' and ')}.`);
  } else if (branches.length === 1) {
    parts.push(`Development focused on the ${branches[0]} branch.`);
  }

  // Accomplishments narrative
  if (accomplished.length > 0) {
    const accomplishmentPhrases = [
      "Key accomplishments include",
      "Progress was made on",
      "The team delivered",
    ];
    const phrase = accomplishmentPhrases[sessionCount % accomplishmentPhrases.length];

    if (accomplished.length >= 3) {
      parts.push(`${phrase} ${accomplished[0].toLowerCase()}, ${accomplished[1].toLowerCase()}, and ${accomplished.length - 2} other item${accomplished.length > 3 ? 's' : ''}.`);
    } else if (accomplished.length === 2) {
      parts.push(`${phrase} ${accomplished[0].toLowerCase()} and ${accomplished[1].toLowerCase()}.`);
    } else {
      parts.push(`${phrase} ${accomplished[0].toLowerCase()}.`);
    }
  }

  // Pending context
  if (pending.length >= 3) {
    parts.push(`${pending.length} items remain pending, including ${pending[0].toLowerCase()}.`);
  } else if (pending.length > 0) {
    parts.push(`Still pending: ${pending[0].toLowerCase()}.`);
  } else if (accomplished.length > 0) {
    parts.push(`No outstanding items remain.`);
  }

  return parts.join(' ');
}

// Generate project breakdowns
function generateProjectBreakdowns(blocks: ChronicleBlock[], stats: ProjectStats[]): ProjectBreakdown[] {
  const breakdowns: ProjectBreakdown[] = [];
  const totalSessions = blocks.length;

  for (const stat of stats) {
    const projectBlocks = blocks.filter(b => b.project === stat.project);

    // Collect unique accomplishments and pending
    const accomplished = new Set<string>();
    const pending = new Set<string>();

    for (const block of projectBlocks) {
      block.accomplished.forEach(a => accomplished.add(a));
      block.pending.forEach(p => pending.add(p));
    }

    const accomplishedList = [...accomplished].slice(0, 8);
    const pendingList = [...pending].slice(0, 5);
    const branchesList = stat.branches.slice(0, 3);

    const narrative = generateProjectNarrative(
      stat.project,
      stat.sessionCount,
      branchesList,
      accomplishedList,
      pendingList,
      totalSessions
    );

    breakdowns.push({
      project: stat.project,
      sessionCount: stat.sessionCount,
      branches: branchesList,
      narrative,
      accomplished: accomplishedList,
      pending: pendingList,
    });
  }

  return breakdowns;
}

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>The Coding Chronicle</title>
  <style>
    :root {
      --bg: #0d1117;
      --bg-secondary: #161b22;
      --bg-tertiary: #21262d;
      --text: #e6edf3;
      --text-secondary: #c9d1d9;
      --text-muted: #8b949e;
      --accent: #58a6ff;
      --accent-subtle: #388bfd26;
      --border: #30363d;
      --green: #3fb950;
      --yellow: #d29922;
      --red: #f85149;
      --purple: #a371f7;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      display: flex;
    }

    /* Sidebar */
    .sidebar {
      width: 280px;
      height: 100vh;
      position: fixed;
      left: 0;
      top: 0;
      background: var(--bg-secondary);
      border-right: 1px solid var(--border);
      overflow-y: auto;
      padding: 16px;
      transition: width 0.2s, padding 0.2s;
    }

    .sidebar.collapsed {
      width: 48px;
      padding: 8px;
      overflow: hidden;
    }

    .sidebar.collapsed .sidebar-header,
    .sidebar.collapsed .worktree-list,
    .sidebar.collapsed .sidebar-footer {
      display: none;
    }

    .sidebar-title-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 16px;
    }

    .sidebar-toggle {
      width: 32px;
      height: 32px;
      border: none;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      flex-shrink: 0;
    }

    .sidebar-toggle:hover {
      background: var(--bg-tertiary);
      color: var(--text);
    }

    .sidebar.collapsed .sidebar-title-row {
      justify-content: center;
    }

    .sidebar-nav-link {
      font-size: 18px;
      font-weight: 700;
      color: var(--text);
      text-decoration: none;
      padding: 4px 8px;
      border-radius: 6px;
      transition: background 0.15s;
    }

    .sidebar-nav-link:hover { background: var(--bg-tertiary); }
    .sidebar-nav-link.active { color: var(--accent); }

    .sidebar.collapsed .sidebar-nav-link { display: none; }

    .sidebar-header {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border);
    }

    .worktree-list { list-style: none; }

    .repo-group { margin-bottom: 16px; }

    .repo-name-text {
      font-size: 14px;
      font-weight: 600;
      color: var(--accent);
    }

    .repo-branches { list-style: none; margin-left: 8px; }

    .worktree-item {
      padding: 6px 8px;
      border-radius: 4px;
      cursor: pointer;
      transition: background 0.15s;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .worktree-item:hover { background: var(--bg-tertiary); }
    .worktree-item.selected { background: var(--accent-subtle); }

    .tree-connector {
      color: var(--text-muted);
      font-family: monospace;
      font-size: 12px;
      width: 20px;
      flex-shrink: 0;
    }

    .worktree-name {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      color: var(--text);
    }

    .worktree-name .indicator {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .indicator.active { background: var(--green); }
    .indicator.recent { background: var(--yellow); }
    .indicator.stale { background: var(--text-muted); }

    .worktree-status {
      font-size: 11px;
      color: var(--text-muted);
      margin-left: auto;
    }

    .sidebar-empty {
      color: var(--text-muted);
      font-size: 13px;
      text-align: center;
      padding: 24px 12px;
    }

    .sidebar-footer {
      margin-top: 16px;
      padding-top: 12px;
      border-top: 1px solid var(--border);
    }

    .clear-filter-btn {
      width: 100%;
      padding: 8px;
      font-size: 12px;
      border: 1px solid var(--border);
      background: transparent;
      color: var(--text-muted);
      border-radius: 4px;
      cursor: pointer;
      display: none;
    }

    .clear-filter-btn.visible { display: block; }
    .clear-filter-btn:hover { border-color: var(--accent); color: var(--text); }

    /* Worktree management buttons */
    .repo-name {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 4px;
    }

    .repo-create-btn {
      width: 20px;
      height: 20px;
      border: none;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
      border-radius: 4px;
      font-size: 14px;
      opacity: 0;
      transition: opacity 0.15s, background 0.15s, color 0.15s;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .repo-group:hover .repo-create-btn { opacity: 1; }
    .repo-create-btn:hover { background: var(--accent-subtle); color: var(--accent); }
    .repo-create-btn.loading { opacity: 1; }
    .repo-create-btn.error { background: rgba(248, 81, 73, 0.3); color: var(--red); opacity: 1; }

    .worktree-archive-btn {
      width: 18px;
      height: 18px;
      border: none;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
      border-radius: 3px;
      font-size: 12px;
      opacity: 0;
      transition: opacity 0.15s, background 0.15s, color 0.15s;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-left: auto;
      flex-shrink: 0;
    }

    .worktree-item:hover .worktree-archive-btn { opacity: 1; }
    .worktree-archive-btn:hover { background: rgba(248, 81, 73, 0.2); color: var(--red); }
    .worktree-archive-btn.loading { opacity: 1; }
    .worktree-archive-btn.error { background: rgba(248, 81, 73, 0.3); opacity: 1; }

    /* Spinner */
    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .spinner {
      display: inline-block;
      width: 12px;
      height: 12px;
      border: 2px solid var(--text-muted);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    /* Toast notifications */
    .toast {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--green);
      color: #000;
      padding: 10px 20px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      z-index: 1000;
      animation: toast-in 0.2s ease-out;
    }

    .toast.error {
      background: var(--red);
      color: #fff;
    }

    @keyframes toast-in {
      from { opacity: 0; transform: translateX(-50%) translateY(10px); }
      to { opacity: 1; transform: translateX(-50%) translateY(0); }
    }

    /* Main content */
    .main-content {
      flex: 1;
      margin-left: 280px;
      transition: margin-left 0.2s;
    }

    body.sidebar-collapsed .main-content {
      margin-left: 48px;
    }

    .container {
      max-width: 900px;
      margin: 0 auto;
      padding: 32px 24px;
    }

    /* Masthead */
    .masthead {
      text-align: center;
      padding-bottom: 24px;
      margin-bottom: 32px;
      border-bottom: 3px double var(--border);
    }

    .masthead-title {
      font-size: 48px;
      font-weight: 700;
      letter-spacing: -1px;
      margin-bottom: 8px;
      font-family: Georgia, "Times New Roman", serif;
    }

    .masthead-subtitle {
      font-size: 14px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 2px;
    }

    .period-select {
      display: flex;
      justify-content: center;
      gap: 8px;
      margin-top: 16px;
    }

    .period-btn {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text-muted);
      padding: 6px 16px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      transition: all 0.15s;
    }

    .period-btn:hover { border-color: var(--accent); color: var(--text); }
    .period-btn.active { background: var(--accent-subtle); border-color: var(--accent); color: var(--accent); }

    /* Front Page */
    .front-page {
      margin-bottom: 48px;
    }

    .headline {
      font-size: 36px;
      font-weight: 700;
      line-height: 1.2;
      margin-bottom: 8px;
      font-family: Georgia, "Times New Roman", serif;
    }

    .dateline {
      font-size: 14px;
      color: var(--text-muted);
      margin-bottom: 16px;
      font-style: italic;
    }

    .lead-story {
      font-size: 18px;
      color: var(--text-secondary);
      line-height: 1.8;
      margin-bottom: 32px;
      border-left: 3px solid var(--accent);
      padding-left: 20px;
      font-style: normal;
    }

    /* Stats bar */
    .stats-bar {
      display: flex;
      gap: 32px;
      padding: 16px 0;
      margin-bottom: 32px;
      border-top: 1px solid var(--border);
      border-bottom: 1px solid var(--border);
    }

    .stat { display: flex; flex-direction: column; }
    .stat-value { font-size: 24px; font-weight: 600; color: var(--accent); }
    .stat-label { font-size: 12px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }

    /* Front page sections */
    .fp-columns {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 32px;
      margin-bottom: 32px;
    }

    .fp-section {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 20px;
    }

    .fp-section-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 16px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border);
    }

    .fp-list { list-style: none; }

    .fp-list li {
      padding: 10px 0;
      border-bottom: 1px solid var(--border);
      color: var(--text-secondary);
      display: flex;
      align-items: flex-start;
      gap: 10px;
    }

    .fp-list li:last-child { border-bottom: none; }

    .fp-list li::before {
      content: "";
      width: 8px;
      height: 8px;
      border-radius: 50%;
      margin-top: 7px;
      flex-shrink: 0;
    }

    .top-stories li::before { background: var(--green); }
    .challenges li::before { background: var(--red); }
    .whats-next li::before { background: var(--yellow); }

    .fp-section.full-width {
      grid-column: 1 / -1;
    }

    /* Insights */
    .insights {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
      margin-bottom: 32px;
    }

    .insight {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 8px 16px;
      font-size: 13px;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .insight::before { content: "\\1F4A1"; }

    /* Section divider */
    .section-divider {
      text-align: center;
      margin: 48px 0 32px;
      position: relative;
    }

    .section-divider::before {
      content: "";
      position: absolute;
      left: 0;
      right: 0;
      top: 50%;
      height: 1px;
      background: var(--border);
    }

    .section-divider span {
      background: var(--bg);
      padding: 0 16px;
      position: relative;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 2px;
      color: var(--text-muted);
    }

    /* Inside the paper - Project breakdowns */
    .inside {
      margin-bottom: 48px;
    }

    .project-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 8px;
      margin-bottom: 16px;
      overflow: hidden;
    }

    .project-header {
      padding: 16px 20px;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      transition: background 0.15s;
    }

    .project-header:hover { background: var(--bg-tertiary); }

    .project-name {
      font-size: 18px;
      font-weight: 600;
      color: var(--accent);
    }

    .project-meta {
      font-size: 13px;
      color: var(--text-muted);
    }

    .project-arrow {
      color: var(--text-muted);
      transition: transform 0.2s;
    }

    .project-card.expanded .project-arrow { transform: rotate(180deg); }

    .project-details {
      display: none;
      padding: 0 20px 20px;
      border-top: 1px solid var(--border);
    }

    .project-card.expanded .project-details { display: block; }

    .project-narrative {
      color: var(--text-secondary);
      font-size: 15px;
      line-height: 1.7;
      margin: 0 0 16px 0;
    }

    .project-section { margin-top: 16px; }

    .project-section-title {
      font-size: 12px;
      font-weight: 500;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
    }

    .project-list { list-style: none; }
    .project-list li { padding: 6px 0; color: var(--text-secondary); font-size: 14px; }

    /* Session details */
    .sessions-section {
      margin-top: 32px;
    }

    .sessions-toggle {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px 20px;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .sessions-toggle:hover { border-color: var(--accent); }
    .sessions-toggle.open .toggle-arrow { transform: rotate(180deg); }
    .toggle-arrow { color: var(--text-muted); transition: transform 0.2s; }

    .sessions-list { display: none; margin-top: 16px; }
    .sessions-list.open { display: block; }

    .search-bar { margin-bottom: 16px; }

    .search-input {
      width: 100%;
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px 16px;
      color: var(--text);
      font-size: 14px;
    }

    .search-input:focus { outline: none; border-color: var(--accent); }
    .search-input::placeholder { color: var(--text-muted); }

    .session-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 12px;
      cursor: pointer;
    }

    .session-card:hover { border-color: var(--accent); }

    .session-header { display: flex; justify-content: space-between; margin-bottom: 8px; }
    .session-project { font-weight: 600; color: var(--accent); }
    .session-branch { font-size: 12px; color: var(--text-muted); margin-left: 8px; }
    .session-date { font-size: 13px; color: var(--text-muted); }
    .session-summary { color: var(--text-secondary); }

    .session-details { display: none; margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border); }
    .session-card.expanded .session-details { display: block; }

    .detail-section { margin-bottom: 12px; }
    .detail-label { font-size: 12px; font-weight: 500; color: var(--text-muted); text-transform: uppercase; margin-bottom: 6px; }
    .detail-list { list-style: none; }
    .detail-list li { padding: 4px 0; color: var(--text-secondary); font-size: 14px; }

    /* Footer */
    footer {
      text-align: center;
      padding-top: 24px;
      border-top: 1px solid var(--border);
      color: var(--text-muted);
      font-size: 13px;
    }

    footer kbd {
      background: var(--bg-tertiary);
      padding: 2px 6px;
      border-radius: 4px;
      border: 1px solid var(--border);
      font-family: monospace;
    }

    .empty { text-align: center; padding: 24px; color: var(--text-muted); }

    /* Worktree Article View */
    .worktree-article {
      padding-top: 24px;
    }

    .article-header {
      margin-bottom: 32px;
    }

    .article-breadcrumb {
      margin-bottom: 16px;
    }

    .article-breadcrumb a {
      color: var(--accent);
      text-decoration: none;
      font-size: 14px;
    }

    .article-breadcrumb a:hover {
      text-decoration: underline;
    }

    .article-title {
      font-size: 36px;
      font-weight: 700;
      font-family: Georgia, "Times New Roman", serif;
      margin-bottom: 8px;
    }

    .article-meta {
      color: var(--text-muted);
      font-size: 14px;
    }

    .article-status {
      display: flex;
      gap: 16px;
      padding: 16px 20px;
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 8px;
      margin-bottom: 32px;
    }

    .article-status-item {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .article-status-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
    }

    .article-status-dot.active { background: var(--green); }
    .article-status-dot.recent { background: var(--yellow); }
    .article-status-dot.stale { background: var(--text-muted); }

    .article-section {
      margin-bottom: 32px;
    }

    .article-section-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 16px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border);
    }

    .article-summary {
      font-size: 18px;
      line-height: 1.8;
      color: var(--text-secondary);
      border-left: 3px solid var(--accent);
      padding-left: 20px;
    }

    .article-list {
      list-style: none;
    }

    .article-list li {
      padding: 10px 0;
      border-bottom: 1px solid var(--border);
      color: var(--text-secondary);
      display: flex;
      align-items: flex-start;
      gap: 10px;
    }

    .article-list li:last-child { border-bottom: none; }

    .article-list li::before {
      content: "•";
      color: var(--accent);
      font-weight: bold;
    }

    .article-actions {
      display: flex;
      gap: 12px;
      padding-top: 24px;
      border-top: 1px solid var(--border);
    }

    .article-action-btn {
      padding: 10px 20px;
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      color: var(--text);
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      transition: all 0.15s;
    }

    .article-action-btn:hover {
      border-color: var(--accent);
      background: var(--accent-subtle);
    }

    .article-action-archive {
      border-color: var(--red);
      color: var(--red);
    }

    .article-action-archive:hover {
      border-color: var(--red);
      background: rgba(248, 81, 73, 0.1);
    }

    .article-empty {
      text-align: center;
      padding: 48px 24px;
      color: var(--text-muted);
    }

    .article-empty p {
      margin-bottom: 12px;
    }

    .article-empty-hint {
      font-size: 14px;
    }

    .article-empty code {
      background: var(--bg-tertiary);
      padding: 2px 6px;
      border-radius: 4px;
    }

    /* Repo name clickable */
    .repo-name-text.clickable { cursor: pointer; }
    .repo-name-text.clickable:hover { color: var(--text); text-decoration: underline; }
    .repo-name.selected .repo-name-text { color: var(--green); }

    /* Repo Article View */
    .repo-article { padding-top: 24px; }

    .worktree-cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 1rem;
    }

    .worktree-card {
      background: var(--bg-secondary);
      padding: 1rem;
      border-radius: 8px;
      cursor: pointer;
      border: 1px solid var(--border);
      transition: border-color 0.15s;
    }

    .worktree-card:hover { border-color: var(--accent); }

    .wt-card-name {
      font-weight: 600;
      margin-bottom: 0.25rem;
      color: var(--text);
    }

    .wt-card-meta {
      font-size: 0.85rem;
      color: var(--text-muted);
    }

    .wt-card-summary {
      margin-top: 0.5rem;
      font-size: 0.9rem;
      color: var(--text-secondary);
    }

    .wt-card-pending {
      margin-top: 0.5rem;
      font-size: 0.85rem;
      color: var(--yellow);
    }

    .usage-stats {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 1rem;
    }

    .usage-stat { text-align: center; }

    .usage-stat-value {
      font-size: 1.5rem;
      font-weight: 600;
      color: var(--accent);
    }

    .usage-stat-label {
      font-size: 0.85rem;
      color: var(--text-muted);
    }

    .article-narrative {
      font-size: 16px;
      line-height: 1.8;
      color: var(--text-secondary);
      border-left: 3px solid var(--accent);
      padding-left: 20px;
    }

    /* AI Summary Section */
    .ai-summary-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-left: 3px solid var(--purple);
      border-radius: 8px;
      padding: 16px 20px;
      margin-bottom: 12px;
    }

    .ai-summary-meta {
      font-size: 12px;
      color: var(--text-muted);
      margin-bottom: 8px;
    }

    .ai-summary-narrative {
      font-size: 15px;
      line-height: 1.7;
      color: var(--text-secondary);
    }

    .ai-summary-badge {
      display: inline-block;
      background: var(--purple);
      color: #fff;
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 3px;
      margin-left: 8px;
    }

    /* Insights Section */
    .insights-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 16px;
    }

    .insight-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
    }

    .insight-card-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      margin-bottom: 8px;
    }

    .insight-themes { color: var(--accent); }
    .insight-patterns { color: var(--yellow); }
    .insight-hotspots { color: var(--red); }
    .insight-velocity { color: var(--green); }

    .velocity-trend {
      font-size: 24px;
      font-weight: 600;
    }

    .velocity-trend.increasing { color: var(--green); }
    .velocity-trend.decreasing { color: var(--red); }
    .velocity-trend.stable { color: var(--text-muted); }

    /* Deep Insights (from chronicle-insights agent) */
    .deep-insights-section {
      margin-top: 24px;
    }

    .deep-insights-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }

    .deep-insights-meta {
      font-size: 12px;
      color: var(--text-muted);
    }

    .deep-insight-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 12px;
    }

    .deep-insight-card.tech_debt { border-left: 3px solid var(--red); }
    .deep-insight-card.stalled_work { border-left: 3px solid var(--yellow); }
    .deep-insight-card.pattern { border-left: 3px solid var(--accent); }
    .deep-insight-card.opportunity { border-left: 3px solid var(--green); }

    .deep-insight-type {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      margin-bottom: 4px;
    }

    .deep-insight-card.tech_debt .deep-insight-type { color: var(--red); }
    .deep-insight-card.stalled_work .deep-insight-type { color: var(--yellow); }
    .deep-insight-card.pattern .deep-insight-type { color: var(--accent); }
    .deep-insight-card.opportunity .deep-insight-type { color: var(--green); }

    .deep-insight-title {
      font-weight: 600;
      margin-bottom: 8px;
      color: var(--text);
    }

    .deep-insight-detail {
      font-size: 14px;
      color: var(--text-secondary);
      margin-bottom: 8px;
      line-height: 1.5;
    }

    .deep-insight-recommendation {
      font-size: 13px;
      color: var(--accent);
      font-style: italic;
    }

    .deep-insights-summary {
      font-size: 15px;
      line-height: 1.7;
      color: var(--text-secondary);
      border-left: 3px solid var(--purple);
      padding-left: 16px;
      margin-bottom: 16px;
    }

    /* Archived Worktrees */
    .archived-section {
      margin-top: 16px;
    }

    .archived-toggle {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      color: var(--text-muted);
      font-size: 14px;
      padding: 8px 0;
    }

    .archived-toggle:hover { color: var(--text); }

    .archived-toggle .arrow {
      transition: transform 0.2s;
    }

    .archived-toggle.open .arrow {
      transform: rotate(90deg);
    }

    .archived-list {
      display: none;
      margin-top: 8px;
    }

    .archived-list.open { display: block; }

    .archived-item {
      display: flex;
      justify-content: space-between;
      padding: 8px 12px;
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 4px;
      margin-bottom: 4px;
      font-size: 13px;
    }

    .archived-item-name { color: var(--text-muted); }
    .archived-item-date { color: var(--text-muted); font-size: 12px; }
  </style>
</head>
<body>
  <!-- Sidebar: Worktrees -->
  <aside class="sidebar" id="sidebar">
    <div class="sidebar-title-row">
      <button class="sidebar-toggle" id="sidebar-toggle" title="Toggle sidebar">☰</button>
      <a href="#" class="sidebar-nav-link active" id="nav-chronicle">Code</a>
    </div>
    <div class="sidebar-header">Worktrees</div>
    <ul class="worktree-list" id="worktree-list"></ul>
    <div class="sidebar-footer">
      <button class="clear-filter-btn" id="clear-filter">Show All Projects</button>
    </div>
  </aside>

  <!-- Main content -->
  <div class="main-content">
  <div class="container">
    <!-- Masthead -->
    <header class="masthead">
      <h1 class="masthead-title">The Coding Chronicle</h1>
      <p class="masthead-subtitle">A record of your coding sessions</p>
      <div class="period-select">
        <button class="period-btn" data-period="daily">Today</button>
        <button class="period-btn active" data-period="weekly">This Week</button>
        <button class="period-btn" data-period="monthly">This Month</button>
      </div>
    </header>

    <!-- Front Page -->
    <section class="front-page">
      <h2 class="headline" id="headline">Loading...</h2>
      <p class="dateline" id="dateline"></p>
      <p class="lead-story" id="lead-story"></p>

      <div class="stats-bar">
        <div class="stat">
          <span class="stat-value" id="stat-sessions">-</span>
          <span class="stat-label">Sessions</span>
        </div>
        <div class="stat">
          <span class="stat-value" id="stat-accomplished">-</span>
          <span class="stat-label">Done</span>
        </div>
        <div class="stat">
          <span class="stat-value" id="stat-pending">-</span>
          <span class="stat-label">Pending</span>
        </div>
        <div class="stat">
          <span class="stat-value" id="stat-projects">-</span>
          <span class="stat-label">Projects</span>
        </div>
        <div class="stat">
          <span class="stat-value" id="stat-tokens">-</span>
          <span class="stat-label">Tokens</span>
        </div>
        <div class="stat">
          <span class="stat-value" id="stat-peak">-</span>
          <span class="stat-label">Peak Hour</span>
        </div>
      </div>

      <div class="fp-columns">
        <div class="fp-section">
          <h3 class="fp-section-title">Top Stories</h3>
          <ul class="fp-list top-stories" id="top-stories"></ul>
        </div>
        <div class="fp-section">
          <h3 class="fp-section-title">What's Next</h3>
          <ul class="fp-list whats-next" id="whats-next"></ul>
        </div>
      </div>

      <div id="challenges-section" style="display: none;">
        <div class="fp-section full-width">
          <h3 class="fp-section-title">Challenges Encountered</h3>
          <ul class="fp-list challenges" id="challenges"></ul>
        </div>
      </div>

      <div class="insights" id="insights"></div>
    </section>

    <!-- Section Divider -->
    <div class="section-divider">
      <span>Inside This Edition</span>
    </div>

    <!-- Inside - Project Breakdowns -->
    <section class="inside">
      <div id="project-breakdowns"></div>

      <!-- Sessions -->
      <div class="sessions-section">
        <div class="sessions-toggle" id="sessions-toggle">
          <span>View <span id="session-count">0</span> individual sessions</span>
          <span class="toggle-arrow">&#9662;</span>
        </div>
        <div class="sessions-list" id="sessions-list">
          <div class="search-bar">
            <input type="text" class="search-input" id="search" placeholder="Search sessions... (press / to focus)">
          </div>
          <div id="sessions-content"></div>
        </div>
      </div>
    </section>

    <footer>
      <p>Press <kbd>/</kbd> to search &middot; <kbd>Esc</kbd> to clear</p>
    </footer>
  </div>

  <!-- Worktree Article View (hidden by default) -->
  <div class="container worktree-article" id="worktree-article" style="display: none;">
    <div class="article-header">
      <div class="article-breadcrumb">
        <a href="#" id="article-back">← Code</a>
      </div>
      <h1 class="article-title" id="article-title">Loading...</h1>
      <div class="article-meta" id="article-meta"></div>
    </div>

    <div class="article-status" id="article-status"></div>

    <div class="article-section" id="article-summary-section">
      <h2 class="article-section-title">Latest Session</h2>
      <p class="article-summary" id="article-summary"></p>
    </div>

    <div class="article-section" id="article-pending-section">
      <h2 class="article-section-title">Pending Work</h2>
      <ul class="article-list" id="article-pending"></ul>
    </div>

    <div class="article-section" id="article-accomplished-section">
      <h2 class="article-section-title">Accomplished</h2>
      <ul class="article-list" id="article-accomplished"></ul>
    </div>

    <div class="article-empty" id="article-empty" style="display: none;">
      <p>No Chronicle entries yet for this worktree.</p>
      <p class="article-empty-hint">Chronicle captures session summaries when you use <code>/chronicle</code> or session hooks.</p>
    </div>

    <div class="article-actions">
      <button class="article-action-btn" id="article-open-editor" title="Opens in VS Code (or copies command)">Open in Editor</button>
      <button class="article-action-btn" id="article-open-terminal" title="Opens in iTerm2 (or copies command)">Open Terminal</button>
      <button class="article-action-btn article-action-archive" id="article-archive" title="Copies: wt archive [name]">Archive</button>
    </div>
  </div>

  <!-- Repo Article View (hidden by default) -->
  <div class="container repo-article" id="repo-article" style="display: none;">
    <div class="article-header">
      <div class="article-breadcrumb"><a href="#" id="repo-back">← Code</a></div>
      <h1 class="article-title" id="repo-title">Loading...</h1>
      <div class="article-meta" id="repo-meta"></div>
    </div>
    <div class="article-status" id="repo-status"></div>

    <!-- AI Summary Section -->
    <div class="article-section" id="repo-ai-summary-section" style="display: none;">
      <h2 class="article-section-title">AI Summary <span class="ai-summary-badge">Synthesized</span></h2>
      <div id="repo-ai-summaries"></div>
    </div>

    <!-- Insights Section -->
    <div class="article-section" id="repo-insights-section">
      <h2 class="article-section-title">Insights &amp; Patterns</h2>
      <div class="insights-grid" id="repo-insights">
        <div class="insight-card">
          <div class="insight-card-title insight-velocity">Velocity</div>
          <div id="insight-velocity">-</div>
        </div>
        <div class="insight-card">
          <div class="insight-card-title insight-themes">Themes</div>
          <div id="insight-themes">-</div>
        </div>
        <div class="insight-card">
          <div class="insight-card-title insight-hotspots">Hotspots</div>
          <div id="insight-hotspots">-</div>
        </div>
        <div class="insight-card">
          <div class="insight-card-title insight-patterns">Patterns</div>
          <div id="insight-patterns">-</div>
        </div>
      </div>
    </div>

    <!-- Deep Insights (from chronicle-insights agent with Explore subagents) -->
    <div class="article-section deep-insights-section" id="repo-deep-insights-section" style="display: none;">
      <div class="deep-insights-header">
        <h2 class="article-section-title">Deep Insights <span class="ai-summary-badge">Explored</span></h2>
        <span class="deep-insights-meta" id="deep-insights-meta"></span>
      </div>
      <p class="deep-insights-summary" id="deep-insights-summary"></p>
      <div id="deep-insights-list"></div>
    </div>

    <div class="article-section" id="repo-narrative-section">
      <h2 class="article-section-title">Current State</h2>
      <p class="article-narrative" id="repo-narrative">Aggregate summary across worktrees will appear here.</p>
    </div>

    <div class="article-section" id="repo-worktrees-section">
      <h2 class="article-section-title">Active Worktrees</h2>
      <div class="worktree-cards" id="repo-worktree-cards"></div>
      <!-- Archived worktrees (collapsible) -->
      <div class="archived-section" id="repo-archived-section" style="display: none;">
        <div class="archived-toggle" id="archived-toggle">
          <span class="arrow">▶</span>
          <span id="archived-count">0 archived worktrees</span>
        </div>
        <div class="archived-list" id="archived-list"></div>
      </div>
    </div>

    <div class="article-section" id="repo-pending-section">
      <h2 class="article-section-title">Pending Work</h2>
      <ul class="article-list" id="repo-pending"></ul>
    </div>

    <div class="article-section" id="repo-usage-section">
      <h2 class="article-section-title">Usage</h2>
      <div class="usage-stats" id="repo-usage">
        <div class="usage-stat">
          <div class="usage-stat-value" id="repo-usage-sessions">-</div>
          <div class="usage-stat-label">Sessions</div>
        </div>
        <div class="usage-stat">
          <div class="usage-stat-value" id="repo-usage-interactions">-</div>
          <div class="usage-stat-label">Interactions</div>
        </div>
        <div class="usage-stat">
          <div class="usage-stat-value" id="repo-usage-tokens">-</div>
          <div class="usage-stat-label">Tokens</div>
        </div>
        <div class="usage-stat">
          <div class="usage-stat-value" id="repo-usage-worktrees">-</div>
          <div class="usage-stat-label">Worktrees</div>
        </div>
      </div>
    </div>
  </div>
  </div><!-- end main-content -->

  <script>
    let allData = { blocks: [], frontPage: null, breakdowns: [], stats: [] };
    let worktrees = [];
    let currentPeriod = 'weekly';
    let searchQuery = '';
    let selectedWorktree = null;
    let selectedRepo = null;

    function selectRepo(repoName) {
      selectedRepo = repoName;
      selectedWorktree = null;

      // Update selection UI
      document.querySelectorAll('.worktree-item').forEach(item => item.classList.remove('selected'));
      document.querySelectorAll('.repo-name').forEach(el => {
        el.classList.toggle('selected', el.dataset.repo === repoName);
      });
      document.getElementById('clear-filter').classList.add('visible');

      showRepoArticle(repoName);
    }

    async function showRepoArticle(repoName) {
      // Hide other views, show repo article
      document.querySelector('.container:not(.worktree-article):not(.repo-article)').style.display = 'none';
      document.getElementById('worktree-article').style.display = 'none';
      document.getElementById('repo-article').style.display = 'block';

      // Get worktrees for this repo
      const repoWorktrees = worktrees.filter(w => w.repo === repoName);

      // Populate header
      document.getElementById('repo-title').textContent = repoName;
      document.getElementById('repo-meta').textContent = repoWorktrees.length + ' worktrees';

      // Status bar
      const cleanCount = repoWorktrees.filter(w => w.gitStatus === 'clean').length;
      const activeCount = repoWorktrees.filter(w => w.session?.active).length;
      document.getElementById('repo-status').innerHTML = \`
        <div class="article-status-item"><span>\${cleanCount}/\${repoWorktrees.length} clean</span></div>
        <div class="article-status-item"><span>\${activeCount} active</span></div>
      \`;

      // Worktree cards
      const cardsHtml = repoWorktrees.map(wt => \`
        <div class="worktree-card" data-path="\${wt.path}">
          <div class="wt-card-name">\${wt.name}</div>
          <div class="wt-card-meta">\${wt.branch} · \${wt.gitStatus}</div>
          <div class="wt-card-summary">\${wt.chronicle?.latestSummary || 'No chronicle data'}</div>
          <div class="wt-card-pending">\${wt.chronicle?.pendingCount || 0} pending</div>
        </div>
      \`).join('');
      document.getElementById('repo-worktree-cards').innerHTML = cardsHtml;

      // Add click handlers to worktree cards
      document.querySelectorAll('.worktree-card').forEach(card => {
        card.addEventListener('click', () => {
          const path = card.dataset.path;
          const wt = worktrees.find(w => w.path === path);
          if (wt) selectWorktree(wt);
        });
      });

      // Aggregate pending from all worktrees
      const allPending = repoWorktrees.flatMap(w => w.chronicle?.pending || []);
      const uniquePending = [...new Set(allPending)];
      if (uniquePending.length > 0) {
        document.getElementById('repo-pending-section').style.display = 'block';
        document.getElementById('repo-pending').innerHTML = uniquePending.map(p => \`<li>\${p}</li>\`).join('');
      } else {
        document.getElementById('repo-pending-section').style.display = 'none';
      }

      // Generate aggregate narrative
      const totalSessions = repoWorktrees.reduce((sum, w) => {
        const wBlocks = allData.blocks.filter(b => b.project.toLowerCase() === repoName.toLowerCase());
        return wBlocks.length;
      }, 0);
      const narrative = repoWorktrees.length > 1
        ? \`This repo has \${repoWorktrees.length} active worktrees. \${activeCount > 0 ? activeCount + ' have active sessions.' : 'No active sessions.'}\`
        : \`Single worktree (\${repoWorktrees[0]?.name || 'unknown'}) for this repo.\`;
      document.getElementById('repo-narrative').textContent = narrative;

      // Update usage stats
      document.getElementById('repo-usage-worktrees').textContent = repoWorktrees.length;
      const repoBlocks = allData.blocks.filter(b => b.project.toLowerCase() === repoName.toLowerCase());
      document.getElementById('repo-usage-sessions').textContent = repoBlocks.length;

      // Fetch usage stats from API
      try {
        const usageRes = await fetch('/api/usage/repo/' + encodeURIComponent(repoName));
        if (usageRes.ok) {
          const usage = await usageRes.json();
          document.getElementById('repo-usage-interactions').textContent = usage.interactions || '-';
          document.getElementById('repo-usage-tokens').textContent = usage.tokens ? (usage.tokens / 1000).toFixed(0) + 'k' : '-';
        }
      } catch {}

      // Load AI summaries
      try {
        const summariesRes = await fetch('/api/summaries/' + encodeURIComponent(repoName));
        if (summariesRes.ok) {
          const summaries = await summariesRes.json();
          if (summaries.length > 0) {
            document.getElementById('repo-ai-summary-section').style.display = 'block';
            document.getElementById('repo-ai-summaries').innerHTML = summaries.slice(0, 2).map(s => \`
              <div class="ai-summary-card">
                <div class="ai-summary-meta">\${s.period} · \${s.date} · via \${s.generatedBy?.includes('opus') ? 'Opus' : 'Sonnet'}</div>
                <div class="ai-summary-narrative">\${s.narrative}</div>
              </div>
            \`).join('');
          } else {
            document.getElementById('repo-ai-summary-section').style.display = 'none';
          }
        }
      } catch {}

      // Load insights
      try {
        const insightsRes = await fetch('/api/insights/' + encodeURIComponent(repoName));
        if (insightsRes.ok) {
          const insights = await insightsRes.json();

          // Velocity
          const velocityEl = document.getElementById('insight-velocity');
          const trendIcon = insights.velocity.trend === 'increasing' ? '↑' : insights.velocity.trend === 'decreasing' ? '↓' : '→';
          velocityEl.innerHTML = \`<span class="velocity-trend \${insights.velocity.trend}">\${trendIcon} \${Math.abs(insights.velocity.change)}%</span>\`;

          // Themes
          const themesEl = document.getElementById('insight-themes');
          themesEl.textContent = insights.themes.length > 0 ? insights.themes.join(', ') : 'No clear themes';

          // Hotspots
          const hotspotsEl = document.getElementById('insight-hotspots');
          hotspotsEl.innerHTML = insights.hotspots.length > 0
            ? insights.hotspots.map(h => \`<div>\${h}</div>\`).join('')
            : 'No hotspots detected';

          // Patterns
          const patternsEl = document.getElementById('insight-patterns');
          patternsEl.innerHTML = insights.patterns.length > 0
            ? insights.patterns.map(p => \`<div>\${p}</div>\`).join('')
            : 'No recurring patterns';
        }
      } catch {}

      // Load archived worktrees
      try {
        const archivedRes = await fetch('/api/archived?repo=' + encodeURIComponent(repoName));
        if (archivedRes.ok) {
          const archived = await archivedRes.json();
          if (archived.length > 0) {
            document.getElementById('repo-archived-section').style.display = 'block';
            document.getElementById('archived-count').textContent = archived.length + ' archived worktree' + (archived.length > 1 ? 's' : '');
            document.getElementById('archived-list').innerHTML = archived.map(a => \`
              <div class="archived-item">
                <span class="archived-item-name">\${a.name}</span>
                <span class="archived-item-date">\${new Date(a.archivedAt).toLocaleDateString()}</span>
              </div>
            \`).join('');

            // Toggle handler for archived list
            const toggle = document.getElementById('archived-toggle');
            toggle.onclick = () => {
              toggle.classList.toggle('open');
              document.getElementById('archived-list').classList.toggle('open');
            };
          } else {
            document.getElementById('repo-archived-section').style.display = 'none';
          }
        }
      } catch {}

      // Load deep insights (from chronicle-insights agent)
      try {
        const deepRes = await fetch('/api/deep-insights/' + encodeURIComponent(repoName));
        if (deepRes.ok) {
          const data = await deepRes.json();
          if (data && data.insights?.length > 0) {
            document.getElementById('repo-deep-insights-section').style.display = 'block';
            document.getElementById('deep-insights-meta').textContent =
              'Generated ' + new Date(data.generatedAt).toLocaleDateString() + ' · ' + data.explorationDepth;
            document.getElementById('deep-insights-summary').textContent = data.summary || '';
            document.getElementById('deep-insights-list').innerHTML = data.insights.map(i => \`
              <div class="deep-insight-card \${i.type}">
                <div class="deep-insight-type">\${i.type.replace('_', ' ')}</div>
                <div class="deep-insight-title">\${i.title}</div>
                <div class="deep-insight-detail">\${i.detail}</div>
                <div class="deep-insight-recommendation">\${i.recommendation}</div>
              </div>
            \`).join('');
          } else {
            document.getElementById('repo-deep-insights-section').style.display = 'none';
          }
        }
      } catch {}
    }

    // Repo back link
    document.getElementById('repo-back').addEventListener('click', (e) => {
      e.preventDefault();
      showChronicleView();
    });

    async function loadWorktrees() {
      const res = await fetch('/api/worktrees');
      worktrees = await res.json();
      renderWorktrees();
    }

    function renderWorktrees() {
      const list = document.getElementById('worktree-list');

      if (worktrees.length === 0) {
        list.innerHTML = '<li class="sidebar-empty">No worktrees found.<br><br>Run <code>wt &lt;branch&gt;</code> to create one.</li>';
        return;
      }

      // Group by repo
      const byRepo = {};
      for (const wt of worktrees) {
        if (!byRepo[wt.repo]) byRepo[wt.repo] = [];
        byRepo[wt.repo].push(wt);
      }

      let html = '';
      for (const [repo, branches] of Object.entries(byRepo)) {
        // Get mainRepoPath from first worktree in this repo
        const mainRepoPath = branches[0]?.mainRepoPath || '';
        const repoSelected = selectedRepo === repo ? 'selected' : '';
        html += \`<li class="repo-group">
          <div class="repo-name \${repoSelected}" data-repo="\${repo}">
            <span class="repo-name-text clickable">\${repo}</span>
            <button class="repo-create-btn" data-repo="\${repo}" data-main-repo-path="\${mainRepoPath}" title="Create new worktree">+</button>
          </div>
          <ul class="repo-branches">\`;

        branches.forEach((wt, idx) => {
          const isLast = idx === branches.length - 1;
          const connector = isLast ? '└──' : '├──';
          const indicator = wt.session?.active ? 'active' :
                           wt.session?.ageMinutes < 60 ? 'recent' : 'stale';
          const ageText = wt.session ? (wt.session.ageMinutes < 60 ? wt.session.ageMinutes + 'm' : Math.floor(wt.session.ageMinutes / 60) + 'h') : '';
          const statusMark = wt.gitStatus === 'dirty' ? ' *' : '';
          const selected = selectedWorktree && selectedWorktree.path === wt.path ? 'selected' : '';

          html += \`
            <li class="worktree-item \${selected}" data-path="\${wt.path}" data-repo="\${wt.repo}" data-branch="\${wt.branch}" data-name="\${wt.name}" data-main-repo-path="\${wt.mainRepoPath}">
              <span class="tree-connector">\${connector}</span>
              <span class="worktree-name">
                <span class="indicator \${indicator}"></span>
                \${wt.name}\${statusMark}
              </span>
              <span class="worktree-status">\${ageText}</span>
              <button class="worktree-archive-btn" title="Archive worktree">&#128230;</button>
            </li>
          \`;
        });

        html += '</ul></li>';
      }
      list.innerHTML = html;

      // Add click handlers for worktree items
      document.querySelectorAll('.worktree-item').forEach(item => {
        item.addEventListener('click', (e) => {
          // Don't select if clicking archive button
          if (e.target.closest('.worktree-archive-btn')) return;
          const path = item.dataset.path;
          const wt = worktrees.find(w => w.path === path);
          selectWorktree(wt);
        });
      });

      // Add click handlers for repo names (to show repo article view)
      document.querySelectorAll('.repo-name-text.clickable').forEach(el => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          const repo = el.closest('.repo-name').dataset.repo;
          selectRepo(repo);
        });
      });

      // Add click handlers for create buttons
      document.querySelectorAll('.repo-create-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const mainRepoPath = btn.dataset.mainRepoPath;
          if (!mainRepoPath) return;

          btn.classList.add('loading');
          btn.innerHTML = '<span class="spinner"></span>';

          try {
            const res = await fetch('/api/worktrees/create', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ mainRepoPath })
            });
            const data = await res.json();

            if (data.success) {
              await loadWorktrees();
            } else {
              btn.classList.add('error');
              setTimeout(() => btn.classList.remove('error'), 1500);
            }
          } catch (err) {
            btn.classList.add('error');
            setTimeout(() => btn.classList.remove('error'), 1500);
          } finally {
            btn.classList.remove('loading');
            btn.innerHTML = '+';
          }
        });
      });

      // Add click handlers for archive buttons
      document.querySelectorAll('.worktree-archive-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const item = btn.closest('.worktree-item');
          const name = item.dataset.name;
          const mainRepoPath = item.dataset.mainRepoPath;
          if (!mainRepoPath) return;

          btn.classList.add('loading');
          btn.innerHTML = '<span class="spinner"></span>';

          try {
            const res = await fetch('/api/worktrees/archive', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name, mainRepoPath })
            });
            const data = await res.json();

            if (data.success) {
              if (selectedWorktree && selectedWorktree.name === name) {
                showChronicleView();
              }
              await loadWorktrees();
            } else {
              btn.classList.add('error');
              setTimeout(() => btn.classList.remove('error'), 1500);
            }
          } catch (err) {
            btn.classList.add('error');
            setTimeout(() => btn.classList.remove('error'), 1500);
          } finally {
            btn.classList.remove('loading');
            btn.innerHTML = '&#128230;';
          }
        });
      });
    }

    function selectWorktree(wt) {
      selectedWorktree = wt;

      // Update selection in list
      document.querySelectorAll('.worktree-item').forEach(item => {
        item.classList.toggle('selected', item.dataset.path === wt.path);
      });

      // Show clear filter button
      document.getElementById('clear-filter').classList.add('visible');

      // Switch to worktree article view
      showWorktreeArticle(wt);
    }

    function showChronicleView() {
      // Show newspaper, hide article views
      document.querySelector('.container:not(.worktree-article):not(.repo-article)').style.display = 'block';
      document.getElementById('worktree-article').style.display = 'none';
      document.getElementById('repo-article').style.display = 'none';

      // Update nav
      document.getElementById('nav-chronicle').classList.add('active');

      // Deselect worktree and repo
      selectedWorktree = null;
      selectedRepo = null;
      document.querySelectorAll('.worktree-item').forEach(item => item.classList.remove('selected'));
      document.querySelectorAll('.repo-name').forEach(el => el.classList.remove('selected'));
      document.getElementById('clear-filter').classList.remove('visible');

      // Load all data
      loadData();
    }

    function showWorktreeArticle(wt) {
      // Hide newspaper and repo article, show worktree article
      document.querySelector('.container:not(.worktree-article):not(.repo-article)').style.display = 'none';
      document.getElementById('repo-article').style.display = 'none';
      document.getElementById('worktree-article').style.display = 'block';

      // Update nav
      document.getElementById('nav-chronicle').classList.remove('active');

      // Populate article header
      document.getElementById('article-title').textContent = wt.name;
      document.getElementById('article-meta').textContent = wt.repo + ' · ' + wt.branch;

      // Status bar
      const statusClass = wt.session?.active ? 'active' : wt.session?.ageMinutes < 60 ? 'recent' : 'stale';
      const sessionText = wt.session?.active ? 'Active session' :
                         wt.session ? (wt.session.ageMinutes < 60 ? wt.session.ageMinutes + 'm ago' : Math.floor(wt.session.ageMinutes / 60) + 'h ago') : 'No session';
      const gitText = wt.gitStatus === 'clean' ? 'Clean' : wt.uncommittedFiles + ' uncommitted';

      document.getElementById('article-status').innerHTML = \`
        <div class="article-status-item">
          <span class="article-status-dot \${statusClass}"></span>
          <span>\${sessionText}</span>
        </div>
        <div class="article-status-item">
          <span>\${gitText}</span>
        </div>
        <div class="article-status-item">
          <span>Last commit: \${wt.lastCommitTime ? new Date(wt.lastCommitTime).toLocaleDateString() : 'unknown'}</span>
        </div>
      \`;

      // Check if we have any chronicle data
      const hasChronicle = wt.chronicle?.latestSummary || wt.chronicle?.pending?.length > 0;
      const emptyState = document.getElementById('article-empty');

      // Summary section
      const summarySection = document.getElementById('article-summary-section');
      const summaryEl = document.getElementById('article-summary');
      if (wt.chronicle?.latestSummary) {
        summarySection.style.display = 'block';
        summaryEl.textContent = wt.chronicle.latestSummary;
      } else {
        summarySection.style.display = 'none';
      }

      // Pending section
      const pendingSection = document.getElementById('article-pending-section');
      const pendingList = document.getElementById('article-pending');
      if (wt.chronicle?.pending?.length > 0) {
        pendingSection.style.display = 'block';
        pendingList.innerHTML = wt.chronicle.pending.map(p => \`<li>\${p}</li>\`).join('');
      } else {
        pendingSection.style.display = 'none';
      }

      // Accomplished section - fetch from chronicle blocks
      fetchWorktreeAccomplished(wt, hasChronicle);
    }

    async function fetchWorktreeAccomplished(wt, hasChronicle) {
      const url = '/api/data?period=weekly&worktree=' + encodeURIComponent(wt.repo + '/' + wt.branch);
      const res = await fetch(url);
      const data = await res.json();

      const accomplishedSection = document.getElementById('article-accomplished-section');
      const accomplishedList = document.getElementById('article-accomplished');
      const emptyState = document.getElementById('article-empty');

      // Collect unique accomplishments from all blocks
      const accomplished = new Set();
      for (const block of data.blocks) {
        block.accomplished.forEach(a => accomplished.add(a));
      }

      const accomplishedArr = [...accomplished].slice(0, 10);
      if (accomplishedArr.length > 0) {
        accomplishedSection.style.display = 'block';
        accomplishedList.innerHTML = accomplishedArr.map(a => \`<li>\${a}</li>\`).join('');
        emptyState.style.display = 'none';
      } else {
        accomplishedSection.style.display = 'none';
        // Show empty state if no chronicle data at all
        emptyState.style.display = hasChronicle ? 'none' : 'block';
      }
    }

    // Chronicle nav link
    document.getElementById('nav-chronicle').addEventListener('click', (e) => {
      e.preventDefault();
      showChronicleView();
    });

    // Article back link
    document.getElementById('article-back').addEventListener('click', (e) => {
      e.preventDefault();
      showChronicleView();
    });

    // URL protocol support for native app integration
    // Editors: vscode://, cursor:// (if added), zed://
    // Terminals: warp://, iterm2://, wezterm://, ghostty://
    // Falls back to clipboard if protocol handler not registered

    // Terminal URL schemes (in preference order - user can change via localStorage)
    const TERMINAL_SCHEMES = {
      warp: (path) => \`warp://action/new_tab?path=\${encodeURIComponent(path)}\`,
      iterm2: (path) => \`iterm2://open?dir=\${encodeURIComponent(path)}\`,
      wezterm: (path) => \`wezterm://open?path=\${encodeURIComponent(path)}\`,
      ghostty: (path) => \`ghostty://open?path=\${encodeURIComponent(path)}\`,
    };

    // Editor URL schemes
    const EDITOR_SCHEMES = {
      vscode: (path) => \`vscode://file\${path}\`,
      cursor: (path) => \`cursor://file\${path}\`,  // May not work yet
      zed: (path) => \`zed://file\${path}\`,
    };

    // Get user's preferred terminal (default: warp, then iterm2)
    function getPreferredTerminal() {
      return localStorage.getItem('preferredTerminal') || 'warp';
    }

    function getPreferredEditor() {
      return localStorage.getItem('preferredEditor') || 'zed';
    }

    function tryOpenEditor(path) {
      const editor = getPreferredEditor();
      const schemeBuilder = EDITOR_SCHEMES[editor] || EDITOR_SCHEMES.vscode;
      window.location.href = schemeBuilder(path);

      // Fallback to clipboard after delay
      setTimeout(async () => {
        const cmd = 'wt open ' + selectedWorktree?.name;
        await navigator.clipboard.writeText(cmd);
        showToast('Copied: ' + cmd);
      }, 800);
    }

    function tryOpenTerminal(path) {
      const terminal = getPreferredTerminal();
      const schemeBuilder = TERMINAL_SCHEMES[terminal] || TERMINAL_SCHEMES.warp;
      window.location.href = schemeBuilder(path);

      // Fallback to clipboard
      setTimeout(async () => {
        const wtCmd = 'wt cd ' + selectedWorktree?.name;
        await navigator.clipboard.writeText(wtCmd);
        showToast('Copied: ' + wtCmd);
      }, 800);
    }

    // Allow setting preferences via console: setTerminal('iterm2'), setEditor('zed')
    window.setTerminal = (t) => { localStorage.setItem('preferredTerminal', t); showToast('Terminal set to: ' + t); };
    window.setEditor = (e) => { localStorage.setItem('preferredEditor', e); showToast('Editor set to: ' + e); };

    // Article action buttons
    document.getElementById('article-open-editor').addEventListener('click', () => {
      if (selectedWorktree) {
        tryOpenEditor(selectedWorktree.path);
      }
    });

    document.getElementById('article-open-terminal').addEventListener('click', () => {
      if (selectedWorktree) {
        tryOpenTerminal(selectedWorktree.path);
      }
    });

    document.getElementById('article-archive').addEventListener('click', async () => {
      if (selectedWorktree) {
        const cmd = 'wt archive ' + selectedWorktree.name;
        await navigator.clipboard.writeText(cmd);
        showToast('Copied: ' + cmd);
      }
    });

    function clearFilter() {
      showChronicleView();
    }

    function showToast(message, isError = false) {
      const toast = document.createElement('div');
      toast.className = 'toast' + (isError ? ' error' : '');
      toast.textContent = message;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 3000);
    }

    document.getElementById('clear-filter').addEventListener('click', clearFilter);

    // Sidebar toggle
    document.getElementById('sidebar-toggle').addEventListener('click', () => {
      const sidebar = document.getElementById('sidebar');
      sidebar.classList.toggle('collapsed');
      document.body.classList.toggle('sidebar-collapsed');
      // Persist state
      localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
    });

    // Restore sidebar state
    if (localStorage.getItem('sidebarCollapsed') === 'true') {
      document.getElementById('sidebar').classList.add('collapsed');
      document.body.classList.add('sidebar-collapsed');
    }

    async function loadData() {
      let url = '/api/data?period=' + currentPeriod;
      if (selectedWorktree) {
        url += '&worktree=' + encodeURIComponent(selectedWorktree.repo + '/' + selectedWorktree.branch);
      }
      const res = await fetch(url);
      allData = await res.json();
      render();
    }

    // Auto-refresh worktrees every 30 seconds
    setInterval(loadWorktrees, 30000);

    function render() {
      const { frontPage, breakdowns, blocks, stats } = allData;

      // Front page
      document.getElementById('headline').textContent = frontPage.headline;
      document.getElementById('dateline').textContent = frontPage.dateline;
      document.getElementById('lead-story').textContent = frontPage.leadStory;

      // Stats
      const totalDone = breakdowns.reduce((sum, p) => sum + p.accomplished.length, 0);
      const totalPending = breakdowns.reduce((sum, p) => sum + p.pending.length, 0);
      document.getElementById('stat-sessions').textContent = blocks.length;
      document.getElementById('stat-accomplished').textContent = totalDone;
      document.getElementById('stat-pending').textContent = totalPending;
      document.getElementById('stat-projects').textContent = stats.length;

      // Top stories
      document.getElementById('top-stories').innerHTML = frontPage.topStories.length
        ? frontPage.topStories.map(s => \`<li>\${s}</li>\`).join('')
        : '<li class="empty">No notable accomplishments</li>';

      // What's next
      document.getElementById('whats-next').innerHTML = frontPage.whatsNext.length
        ? frontPage.whatsNext.map(s => \`<li>\${s}</li>\`).join('')
        : '<li class="empty">Nothing pending</li>';

      // Challenges
      if (frontPage.challenges.length > 0) {
        document.getElementById('challenges-section').style.display = 'block';
        document.getElementById('challenges').innerHTML = frontPage.challenges.map(c => \`<li>\${c}</li>\`).join('');
      } else {
        document.getElementById('challenges-section').style.display = 'none';
      }

      // Insights
      document.getElementById('insights').innerHTML = frontPage.insights.map(i => \`<div class="insight">\${i}</div>\`).join('');

      // Project breakdowns
      document.getElementById('project-breakdowns').innerHTML = breakdowns.map(p => \`
        <div class="project-card" data-project="\${p.project}">
          <div class="project-header">
            <div>
              <span class="project-name">\${p.project}</span>
              <span class="project-meta">\${p.sessionCount} sessions\${p.branches.length ? ' · ' + p.branches.join(', ') : ''}</span>
            </div>
            <span class="project-arrow">&#9662;</span>
          </div>
          <div class="project-details">
            <p class="project-narrative">\${p.narrative}</p>
            \${p.accomplished.length ? \`
              <div class="project-section">
                <div class="project-section-title">Accomplished</div>
                <ul class="project-list">
                  \${p.accomplished.map(a => \`<li>\${a}</li>\`).join('')}
                </ul>
              </div>
            \` : ''}
            \${p.pending.length ? \`
              <div class="project-section">
                <div class="project-section-title">Pending</div>
                <ul class="project-list">
                  \${p.pending.map(p => \`<li>\${p}</li>\`).join('')}
                </ul>
              </div>
            \` : ''}
          </div>
        </div>
      \`).join('');

      // Project card toggle
      document.querySelectorAll('.project-card').forEach(card => {
        card.querySelector('.project-header').addEventListener('click', () => {
          card.classList.toggle('expanded');
        });
      });

      // Sessions
      document.getElementById('session-count').textContent = blocks.length;
      renderSessions();
    }

    function renderSessions() {
      let blocks = allData.blocks;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        blocks = blocks.filter(b =>
          b.summary.toLowerCase().includes(q) ||
          b.project.toLowerCase().includes(q) ||
          b.branch?.toLowerCase().includes(q) ||
          b.accomplished.some(a => a.toLowerCase().includes(q)) ||
          b.pending.some(p => p.toLowerCase().includes(q))
        );
      }

      document.getElementById('sessions-content').innerHTML = blocks.map(b => \`
        <div class="session-card" data-id="\${b.sessionId}">
          <div class="session-header">
            <div>
              <span class="session-project">\${b.project}</span>
              \${b.branch ? \`<span class="session-branch">on \${b.branch}</span>\` : ''}
            </div>
            <span class="session-date">\${formatDate(b.timestamp)}</span>
          </div>
          <div class="session-summary">\${b.summary}</div>
          <div class="session-details">
            \${b.accomplished.length ? \`
              <div class="detail-section">
                <div class="detail-label">Accomplished</div>
                <ul class="detail-list">\${b.accomplished.map(a => \`<li>\${a}</li>\`).join('')}</ul>
              </div>
            \` : ''}
            \${b.pending.length ? \`
              <div class="detail-section">
                <div class="detail-label">Pending</div>
                <ul class="detail-list">\${b.pending.map(p => \`<li>\${p}</li>\`).join('')}</ul>
              </div>
            \` : ''}
            \${(b.filesModified || []).length ? \`
              <div class="detail-section">
                <div class="detail-label">Files Modified</div>
                <ul class="detail-list">\${(b.filesModified || []).map(f => \`<li>\${f}</li>\`).join('')}</ul>
              </div>
            \` : ''}
          </div>
        </div>
      \`).join('') || '<p class="empty">No sessions found</p>';

      document.querySelectorAll('.session-card').forEach(card => {
        card.addEventListener('click', () => card.classList.toggle('expanded'));
      });
    }

    function formatDate(ts) {
      const d = new Date(ts);
      return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    }

    // Event listeners
    document.querySelectorAll('.period-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentPeriod = btn.dataset.period;
        loadData();
      });
    });

    document.getElementById('sessions-toggle').addEventListener('click', function() {
      this.classList.toggle('open');
      document.getElementById('sessions-list').classList.toggle('open');
    });

    const searchInput = document.getElementById('search');
    searchInput.addEventListener('input', e => { searchQuery = e.target.value; renderSessions(); });

    document.addEventListener('keydown', e => {
      if (e.key === '/') { e.preventDefault(); searchInput.focus(); }
      else if (e.key === 'Escape') { searchInput.value = ''; searchQuery = ''; renderSessions(); searchInput.blur(); }
    });

    async function loadUsageStats() {
      try {
        const usage = await fetch('/api/usage/global').then(r => r.json());
        if (usage.total_tokens) {
          document.getElementById('stat-tokens').textContent = (usage.total_tokens / 1000).toFixed(0) + 'k';
        }
        const peaks = await fetch('/api/usage/peaks').then(r => r.json());
        if (peaks && peaks[0]) {
          document.getElementById('stat-peak').textContent = peaks[0].hour_of_day + ':00';
        }
      } catch { /* Usage API may not have data */ }
    }

    loadData();
    loadWorktrees();
    loadUsageStats();
  </script>
</body>
</html>`;

function getBlocksForPeriod(period: string): ChronicleBlock[] {
  const allBlocks = loadAllBlocks();
  const ranges = getDateRanges();

  let range;
  switch (period) {
    case "daily":
      range = { start: new Date(Date.now() - 24 * 60 * 60 * 1000), end: new Date() };
      break;
    case "monthly":
      range = ranges.last30Days;
      break;
    case "weekly":
    default:
      range = ranges.last7Days;
  }

  return allBlocks.filter((block) => {
    const ts = new Date(block.timestamp);
    return ts >= range.start && ts <= range.end;
  });
}

function buildApiData(periodParam: string) {
  const period = (periodParam === "daily" || periodParam === "monthly" ? periodParam : "weekly") as Period;
  const blocks = getBlocksForPeriod(period);

  // Calculate stats for this period
  const statsMap = new Map<string, ProjectStats>();
  for (const block of blocks) {
    const existing = statsMap.get(block.project);
    if (existing) {
      existing.sessionCount++;
      existing.totalMessages += block.messageCount ?? 0;
      existing.accomplishedCount += block.accomplished.length;
      existing.pendingCount += block.pending.length;
      if (block.branch && !existing.branches.includes(block.branch)) {
        existing.branches.push(block.branch);
      }
    } else {
      statsMap.set(block.project, {
        project: block.project,
        sessionCount: 1,
        totalMessages: block.messageCount ?? 0,
        filesModified: block.filesModified ? [...block.filesModified] : [],
        accomplishedCount: block.accomplished.length,
        pendingCount: block.pending.length,
        branches: block.branch ? [block.branch] : [],
        firstSession: block.timestamp,
        lastSession: block.timestamp,
      });
    }
  }

  const stats = Array.from(statsMap.values()).sort((a, b) => b.sessionCount - a.sessionCount);
  const frontPage = generateFrontPage(blocks, stats, period);
  const breakdowns = generateProjectBreakdowns(blocks, stats);

  return { blocks, stats, frontPage, breakdowns };
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/api/data") {
      const period = url.searchParams.get("period") ?? "weekly";
      const worktreeFilter = url.searchParams.get("worktree");
      let data = buildApiData(period);

      // Filter by worktree if specified
      if (worktreeFilter) {
        const [repo, branch] = worktreeFilter.split("/");
        data = {
          ...data,
          blocks: data.blocks.filter(
            (b) =>
              b.project.toLowerCase() === repo.toLowerCase() &&
              b.branch === branch
          ),
        };
      }

      return new Response(JSON.stringify(data), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/api/worktrees") {
      return new Response(JSON.stringify(getWorktreeStatus()), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Create new worktree
    if (url.pathname === "/api/worktrees/create" && req.method === "POST") {
      try {
        const body = await req.json() as { mainRepoPath: string };
        const { mainRepoPath } = body;

        if (!mainRepoPath || !existsSync(mainRepoPath)) {
          return new Response(JSON.stringify({ error: "Invalid main repo path" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const name = generateRandomName();
        const wtScript = `${process.env.HOME}/.claude/skills/git-worktree/scripts/wt.sh`;

        // Run wt command from main repo
        const result = execSync(`bash "${wtScript}" "${name}" --no-editor`, {
          cwd: mainRepoPath,
          encoding: "utf-8",
          timeout: 60000,
        });

        return new Response(JSON.stringify({ success: true, name, output: result }), {
          headers: { "Content-Type": "application/json" },
        });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        return new Response(JSON.stringify({ error }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // Archive worktree
    if (url.pathname === "/api/worktrees/archive" && req.method === "POST") {
      try {
        const body = await req.json() as { name: string; mainRepoPath: string };
        const { name, mainRepoPath } = body;

        // Validate name to prevent command injection (alphanumeric, dash, underscore only)
        if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
          return new Response(JSON.stringify({ error: "Invalid worktree name" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (!mainRepoPath || !existsSync(mainRepoPath)) {
          return new Response(JSON.stringify({ error: "Invalid main repo path" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const wtScript = `${process.env.HOME}/.claude/skills/git-worktree/scripts/wt.sh`;

        // Run wt archive command from main repo
        const result = execSync(`bash "${wtScript}" archive "${name}"`, {
          cwd: mainRepoPath,
          encoding: "utf-8",
          timeout: 60000,
        });

        return new Response(JSON.stringify({ success: true, name, output: result }), {
          headers: { "Content-Type": "application/json" },
        });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        return new Response(JSON.stringify({ error }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // Usage API endpoints
    if (url.pathname === "/api/usage/global") {
      const days = parseInt(url.searchParams.get("days") || "7");
      const usage = getGlobalUsage(days);
      return new Response(JSON.stringify(usage || {}), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/api/usage/peaks") {
      const peaks = getPeakHours();
      return new Response(JSON.stringify(peaks), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/api/usage/tools") {
      const project = url.searchParams.get("project") || undefined;
      const days = parseInt(url.searchParams.get("days") || "7");
      const tools = getToolBreakdown(project, days);
      return new Response(JSON.stringify(tools), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname.startsWith("/api/usage/repo/")) {
      const repoName = decodeURIComponent(url.pathname.split("/").pop() || "");
      const days = parseInt(url.searchParams.get("days") || "7");
      const usage = getRepoUsage(repoName, days);
      return new Response(JSON.stringify(usage || {}), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Archived worktrees API
    if (url.pathname === "/api/archived") {
      const repo = url.searchParams.get("repo") || undefined;
      const archived = getArchivedWorktrees(repo);
      return new Response(JSON.stringify(archived), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Repo summaries API (AI-generated)
    if (url.pathname.startsWith("/api/summaries/")) {
      const repoName = decodeURIComponent(url.pathname.split("/").pop() || "");
      const summaries = loadRepoSummaries(repoName);
      return new Response(JSON.stringify(summaries), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Repo insights API (pattern analysis)
    if (url.pathname.startsWith("/api/insights/")) {
      const repoName = decodeURIComponent(url.pathname.split("/").pop() || "");
      const insights = analyzeRepoPatterns(repoName);
      return new Response(JSON.stringify(insights), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Deep insights from chronicle-insights agent (Explore subagent analysis)
    if (url.pathname.startsWith("/api/deep-insights/")) {
      const repoName = decodeURIComponent(url.pathname.split("/").pop() || "");
      const deepInsights = loadDeepInsights(repoName);
      return new Response(JSON.stringify(deepInsights), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(HTML, { headers: { "Content-Type": "text/html" } });
  },
});

console.log(`The Coding Chronicle running at http://localhost:${PORT}`);

const { exec } = await import("child_process");
exec(`open http://localhost:${PORT}`);

process.on("SIGINT", () => {
  console.log("\nShutting down The Coding Chronicle");
  process.exit(0);
});
