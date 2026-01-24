/**
 * Shared utilities for Chronicle sync features.
 * Used by popup, post-sync notification, and feedback capture.
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync, statSync, readdirSync } from "fs";
import { execSync } from "child_process";

const CHRONICLE_DIR = `${process.env.HOME}/.claude/chronicle/blocks`;
const LAST_SYNC_FILE = `${process.env.HOME}/.claude/.chronicle-last-sync`;

export interface ChronicleBlock {
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
  goal?: string;
  challenges?: string[];
  nextSteps?: string[];
  notes?: string;
  relatedSessions?: string[];
}

export interface PendingThread {
  text: string;
  project: string;
  branch: string | null;
  firstSeen: string;
  lastSeen: string;
  occurrences: number;
  daysActive: number;
}

export interface SyncPreview {
  sessionCount: number;
  projectCount: number;
  filesChanged: Set<string>;
  pendingThreads: PendingThread[];
  recentSessions: ChronicleBlock[];
  lastSyncTime: Date | null;
  newBlocksSinceSync: number;
}

export interface Suggestion {
  type: "resume_thread" | "continue_pattern" | "address_stale" | "explore_connection";
  title: string;
  detail: string;
  project: string;
  path?: string;
  reason: string;
}


export function loadEnv(): Record<string, string> {
  const envPath = `${process.env.HOME}/.claude/.env`;
  if (!existsSync(envPath)) return {};

  const content = readFileSync(envPath, "utf-8");
  const env: Record<string, string> = {};

  for (const line of content.split("\n")) {
    if (line.startsWith("#") || !line.includes("=")) continue;
    const [key, ...valueParts] = line.split("=");
    env[key.trim()] = valueParts.join("=").trim();
  }

  return env;
}

export function getLastSyncTime(): Date | null {
  if (!existsSync(LAST_SYNC_FILE)) return null;

  try {
    const timestamp = parseInt(readFileSync(LAST_SYNC_FILE, "utf-8").trim(), 10);
    return new Date(timestamp * 1000);
  } catch {
    return null;
  }
}

export function updateLastSyncTime(): void {
  const timestamp = Math.floor(Date.now() / 1000);
  writeFileSync(LAST_SYNC_FILE, timestamp.toString());
}

export function loadAllBlocks(): ChronicleBlock[] {
  if (!existsSync(CHRONICLE_DIR)) return [];

  const files = readdirSync(CHRONICLE_DIR).filter(f => f.endsWith(".json"));
  const blocks: ChronicleBlock[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(`${CHRONICLE_DIR}/${file}`, "utf-8");
      blocks.push(JSON.parse(content));
    } catch {
      // Skip malformed files
    }
  }

  return blocks.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

export function getBlocksSinceSync(lastSync: Date | null): ChronicleBlock[] {
  const blocks = loadAllBlocks();
  if (!lastSync) return blocks;

  return blocks.filter(block => new Date(block.timestamp) > lastSync);
}

export function aggregatePendingThreads(blocks: ChronicleBlock[]): PendingThread[] {
  const threadMap = new Map<string, {
    text: string;
    project: string;
    branch: string | null;
    firstSeen: Date;
    lastSeen: Date;
    occurrences: number;
  }>();

  // Normalize pending text for grouping (lowercase, trim)
  const normalizeText = (text: string) => text.toLowerCase().trim();

  for (const block of blocks) {
    for (const pending of block.pending) {
      const key = `${block.project}:${normalizeText(pending)}`;
      const blockDate = new Date(block.timestamp);

      const existing = threadMap.get(key);
      if (existing) {
        existing.occurrences++;
        if (blockDate < existing.firstSeen) existing.firstSeen = blockDate;
        if (blockDate > existing.lastSeen) existing.lastSeen = blockDate;
      } else {
        threadMap.set(key, {
          text: pending,
          project: block.project,
          branch: block.branch,
          firstSeen: blockDate,
          lastSeen: blockDate,
          occurrences: 1,
        });
      }
    }
  }

  const now = new Date();
  return Array.from(threadMap.values())
    .map(t => ({
      ...t,
      firstSeen: t.firstSeen.toISOString(),
      lastSeen: t.lastSeen.toISOString(),
      daysActive: Math.ceil((now.getTime() - t.firstSeen.getTime()) / (1000 * 60 * 60 * 24)),
    }))
    .sort((a, b) => b.daysActive - a.daysActive);
}

export function getSyncPreview(): SyncPreview {
  const lastSync = getLastSyncTime();
  const allBlocks = loadAllBlocks();
  const newBlocks = getBlocksSinceSync(lastSync);

  const projects = new Set(newBlocks.map(b => b.project));
  const files = new Set<string>();
  for (const block of newBlocks) {
    for (const file of block.filesModified ?? []) {
      files.add(file);
    }
  }

  const pendingThreads = aggregatePendingThreads(allBlocks);

  return {
    sessionCount: newBlocks.length,
    projectCount: projects.size,
    filesChanged: files,
    pendingThreads: pendingThreads.slice(0, 10),
    recentSessions: newBlocks.slice(0, 5),
    lastSyncTime: lastSync,
    newBlocksSinceSync: newBlocks.length,
  };
}

export function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMinutes = Math.floor(diffMs / (1000 * 60));

  if (diffDays > 0) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
  if (diffHours > 0) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
  if (diffMinutes > 0) return `${diffMinutes} minute${diffMinutes > 1 ? "s" : ""} ago`;
  return "just now";
}

export function formatSyncPopupMessage(preview: SyncPreview): string {
  const lines: string[] = [];

  lines.push(`${preview.sessionCount} session${preview.sessionCount !== 1 ? "s" : ""} ready to sync`);
  lines.push("");

  // Pending threads section
  if (preview.pendingThreads.length > 0) {
    lines.push("⚡ PENDING THREADS");
    for (const thread of preview.pendingThreads.slice(0, 3)) {
      const staleIndicator = thread.daysActive > 3 ? ` (${thread.daysActive}d)` : "";
      lines.push(`• ${thread.project}: ${thread.text}${staleIndicator}`);
    }
    lines.push("");
  }

  // Recent sessions section
  if (preview.recentSessions.length > 0) {
    lines.push("📝 RECENT SESSIONS");
    for (const session of preview.recentSessions.slice(0, 3)) {
      const summary = session.summary.length > 40
        ? session.summary.slice(0, 40) + "..."
        : session.summary;
      lines.push(`• ${summary}`);
    }
    lines.push("");
  }

  // Last sync info
  if (preview.lastSyncTime) {
    lines.push(`Last sync: ${formatTimeAgo(preview.lastSyncTime)}`);
  } else {
    lines.push("First sync");
  }

  return lines.join("\n");
}

export async function showOsascriptDialog(
  message: string,
  buttons: string[],
  defaultButton: string,
  title: string
): Promise<string> {
  const buttonList = buttons.map(b => `"${b}"`).join(", ");
  const script = `display dialog "${message.replace(/"/g, '\\"').replace(/\n/g, "\\n")}" buttons {${buttonList}} default button "${defaultButton}" with title "${title}"`;

  try {
    const result = execSync(`osascript -e '${script}'`, { encoding: "utf-8" });
    return result.trim();
  } catch (error: unknown) {
    // User clicked cancel or closed dialog
    if (error instanceof Error && "status" in error && (error as { status: number }).status === 1) {
      return "cancelled";
    }
    throw error;
  }
}

export function showOsascriptNotification(message: string, title: string, subtitle?: string): void {
  const subtitlePart = subtitle ? ` subtitle "${subtitle}"` : "";
  const script = `display notification "${message.replace(/"/g, '\\"')}" with title "${title}"${subtitlePart}`;

  try {
    execSync(`osascript -e '${script}'`);
  } catch {
    // Notification failures are non-critical
  }
}

export function openUrl(url: string): void {
  try {
    execSync(`open "${url}"`);
  } catch {
    // URL open failures are non-critical
  }
}

export function runAnsibleSync(deployDir: string): boolean {
  try {
    execSync(
      `cd "${deployDir}" && ansible-playbook claude.yml --tags chronicle-sync -e chronicle_sync_enabled=true`,
      { stdio: "inherit" }
    );
    return true;
  } catch {
    return false;
  }
}

export function generateSuggestions(preview: SyncPreview): [Suggestion, Suggestion] {
  const candidates: Suggestion[] = [];

  // Priority 1: Stalled threads (>3 days)
  for (const thread of preview.pendingThreads) {
    if (thread.daysActive > 3) {
      candidates.push({
        type: "address_stale",
        title: `Resume "${thread.text.slice(0, 30)}${thread.text.length > 30 ? "..." : ""}"`,
        detail: `Blocked for ${thread.daysActive} days`,
        project: thread.project,
        path: `~/code/${thread.project}`,
        reason: `stalled_${thread.daysActive}d`,
      });
    }
  }

  // Priority 2: Recent high-activity threads
  for (const thread of preview.pendingThreads) {
    if (thread.occurrences > 2 && thread.daysActive <= 3) {
      candidates.push({
        type: "continue_pattern",
        title: `Continue ${thread.project} work`,
        detail: thread.text,
        project: thread.project,
        path: `~/code/${thread.project}`,
        reason: `active_${thread.occurrences}_sessions`,
      });
    }
  }

  // Priority 3: Any remaining pending threads
  for (const thread of preview.pendingThreads) {
    if (!candidates.some(c => c.project === thread.project && c.title.includes(thread.text.slice(0, 20)))) {
      candidates.push({
        type: "resume_thread",
        title: `Work on ${thread.project}`,
        detail: thread.text,
        project: thread.project,
        path: `~/code/${thread.project}`,
        reason: "pending_thread",
      });
    }
  }

  // Priority 4: Recent sessions without pending
  for (const session of preview.recentSessions) {
    if (!candidates.some(c => c.project === session.project)) {
      candidates.push({
        type: "continue_pattern",
        title: `Continue ${session.project}`,
        detail: session.summary,
        project: session.project,
        path: `~/code/${session.project}`,
        reason: "recent_activity",
      });
    }
  }

  // Fallback suggestions
  if (candidates.length === 0) {
    candidates.push({
      type: "explore_connection",
      title: "Review Chronicle dashboard",
      detail: "Explore your session history",
      project: "chronicle",
      reason: "no_pending",
    });
  }

  if (candidates.length === 1) {
    candidates.push({
      type: "explore_connection",
      title: "Start fresh work",
      detail: "Begin a new coding session",
      project: "general",
      reason: "single_suggestion",
    });
  }

  return [candidates[0], candidates[1]];
}

// === Structured Output for Any UI ===

export interface SyncOutput {
  summary: {
    sessionsToSync: number;
    projectCount: number;
    lastSyncTime: string | null;
    lastSyncAgo: string;
  };
  pendingThreads: {
    text: string;
    project: string;
    daysActive: number;
    isStalled: boolean;
  }[];
  recentSessions: {
    summary: string;
    project: string;
    timestamp: string;
  }[];
  insights: {
    continuity: { title: string; detail: string }[];
    technical: { title: string; detail: string }[];
    crossProject: { title: string; detail: string }[];
  };
  suggestedActions: {
    title: string;
    detail: string;
    command: string;
  }[];
}

export function getSyncOutput(): SyncOutput {
  const preview = getSyncPreview();
  const suggestions = generateSuggestions(preview);

  const pendingThreads = preview.pendingThreads.map(t => ({
    text: t.text,
    project: t.project,
    daysActive: t.daysActive,
    isStalled: t.daysActive > 7,
  }));

  const recentSessions = preview.recentSessions.map(s => ({
    summary: s.summary,
    project: s.project,
    timestamp: s.timestamp,
  }));

  const insights = categorizeInsights(preview);

  const suggestedActions = suggestions.map(s => ({
    title: s.title,
    detail: s.detail,
    command: s.path ? `cd ${s.path} && claude` : `claude`,
  }));

  return {
    summary: {
      sessionsToSync: preview.sessionCount,
      projectCount: preview.projectCount,
      lastSyncTime: preview.lastSyncTime?.toISOString() ?? null,
      lastSyncAgo: preview.lastSyncTime ? formatTimeAgo(preview.lastSyncTime) : "never",
    },
    pendingThreads,
    recentSessions,
    insights,
    suggestedActions,
  };
}

function categorizeInsights(preview: SyncPreview): SyncOutput["insights"] {
  const continuity: { title: string; detail: string }[] = [];
  const technical: { title: string; detail: string }[] = [];
  const crossProject: { title: string; detail: string }[] = [];

  // Continuity: stalled threads
  const stalledThreads = preview.pendingThreads.filter(t => t.daysActive > 7);
  if (stalledThreads.length > 0) {
    continuity.push({
      title: `${stalledThreads.length} stalled thread${stalledThreads.length > 1 ? "s" : ""}`,
      detail: stalledThreads.map(t => `${t.project}: ${t.text}`).slice(0, 3).join("; "),
    });
  }

  // Continuity: active threads
  const activeThreads = preview.pendingThreads.filter(t => t.daysActive <= 3 && t.occurrences > 1);
  if (activeThreads.length > 0) {
    continuity.push({
      title: `${activeThreads.length} active thread${activeThreads.length > 1 ? "s" : ""}`,
      detail: activeThreads.map(t => t.project).slice(0, 3).join(", "),
    });
  }

  // Technical: file changes
  if (preview.filesChanged.size > 0) {
    technical.push({
      title: `${preview.filesChanged.size} files modified`,
      detail: Array.from(preview.filesChanged).slice(0, 5).join(", "),
    });
  }

  // Cross-project: multiple projects
  if (preview.projectCount > 1) {
    const projects = [...new Set(preview.recentSessions.map(s => s.project))];
    crossProject.push({
      title: `Work across ${preview.projectCount} projects`,
      detail: projects.slice(0, 4).join(", "),
    });
  }

  return { continuity, technical, crossProject };
}
