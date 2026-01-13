#!/usr/bin/env bun
/**
 * Chronicle Dashboard - Newspaper-style UI for exploring session history.
 *
 * Structure:
 *   FRONT PAGE (above the fold) - Aggregated highlights
 *   INSIDE (below the fold) - Project breakdowns & session details
 *
 * Usage:
 *   bun scripts/chronicle-dashboard.ts
 *
 * Opens browser to http://localhost:3456
 */
import {
  loadAllBlocks,
  getDateRanges,
  type ChronicleBlock,
  type ProjectStats,
} from "./queries.ts";

const PORT = 3456;

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
  <title>The Chronicle</title>
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
  </style>
</head>
<body>
  <div class="container">
    <!-- Masthead -->
    <header class="masthead">
      <h1 class="masthead-title">The Chronicle</h1>
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

  <script>
    let allData = { blocks: [], frontPage: null, breakdowns: [], stats: [] };
    let currentPeriod = 'weekly';
    let searchQuery = '';

    async function loadData() {
      const res = await fetch('/api/data?period=' + currentPeriod);
      allData = await res.json();
      render();
    }

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

    loadData();
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
  fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/api/data") {
      const period = url.searchParams.get("period") ?? "weekly";
      return new Response(JSON.stringify(buildApiData(period)), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(HTML, { headers: { "Content-Type": "text/html" } });
  },
});

console.log(`The Chronicle running at http://localhost:${PORT}`);

const { exec } = await import("child_process");
exec(`open http://localhost:${PORT}`);

process.on("SIGINT", () => {
  console.log("\nShutting down The Chronicle");
  process.exit(0);
});
