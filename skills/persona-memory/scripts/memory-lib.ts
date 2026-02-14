#!/usr/bin/env bun
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { basename, join } from "path";
import { homedir } from "os";
import { execSync } from "child_process";

export type MemoryType = "fact" | "preference" | "decision" | "thread" | "relationship";
export type Confidence = "confirmed" | "observed" | "inferred";
export type EventStatus = "candidate" | "promoted" | "duplicate" | "skipped";

export interface MemoryEvent {
  id: string;
  timestamp: string;
  type: MemoryType;
  content: string;
  confidence: Confidence;
  source: string;
  project_key: string | null;
  status: EventStatus;
  processed_at: string | null;
}

export interface RecallSnippet {
  source: string;
  text: string;
  score: number;
}

export interface RecallResult {
  profile: string;
  cwd: string;
  projectKey: string;
  snippets: RecallSnippet[];
}

export interface ConsolidateResult {
  processed: number;
  promoted: number;
  duplicates: number;
  skipped: number;
}

export interface ScriptResultEnvelope<T> {
  ok: boolean;
  code: string;
  details: T;
}

interface MemoryPaths {
  home: string;
  profiles: string;
  blocks: string;
  projects: string;
  events: string;
  index: string;
  runtime: string;
  runtimeSessionStart: string;
  snapshots: string;
  eventLog: string;
  indexFile: string;
}

let deterministicSequence = 0;

const DEFAULT_PERSONALITY_TEMPLATE = `# Persona Profile

## Identity
- Name: Teammate
- Role: Persistent engineering collaborator
- Mission: Help ship high-quality outcomes while preserving long-term context.

## Goals
- Maintain continuity across sessions and projects.
- Preserve important decisions and preferences.
- Improve collaboration quality over time.

## Collaboration Style
- Direct, pragmatic, concise.
- Surface tradeoffs and risks early.
- Propose clear next actions.

## Assertiveness Policy
- Default assertiveness: high
- Act proactively on low-risk implementation details.
- Ask before destructive or high-impact operations.

## Decision Policy
- Recommend a path when options exist.
- Record major decisions with rationale.
- Revisit decisions when conflicting evidence appears.
`;

function blockTemplate(title: string): string {
  return `# ${title}

## Entries

`;
}

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function nowDate(): Date {
  const injected = process.env.AI_MEMORY_NOW;
  if (injected) {
    const parsed = new Date(injected);
    if (Number.isFinite(parsed.getTime())) return parsed;
  }
  return new Date();
}

export function nowIso(): string {
  return nowDate().toISOString();
}

function todayDate(): string {
  return nowIso().slice(0, 10);
}

export function getMemoryHome(): string {
  return process.env.AI_MEMORY_HOME || `${homedir()}/.ai-memory`;
}

export function getMemoryPaths(memoryHome = getMemoryHome()): MemoryPaths {
  return {
    home: memoryHome,
    profiles: join(memoryHome, "profiles"),
    blocks: join(memoryHome, "blocks"),
    projects: join(memoryHome, "blocks", "projects"),
    events: join(memoryHome, "events"),
    index: join(memoryHome, "index"),
    runtime: join(memoryHome, "runtime"),
    runtimeSessionStart: join(memoryHome, "runtime", "session-start"),
    snapshots: join(memoryHome, "snapshots"),
    eventLog: join(memoryHome, "events", "memory-events.jsonl"),
    indexFile: join(memoryHome, "index", "memory-index.json"),
  };
}

function normalizeSpaces(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function normalizeForCompare(input: string): string {
  return normalizeSpaces(input).toLowerCase();
}

function touchFile(path: string, contents: string): void {
  if (!existsSync(path)) writeFileSync(path, contents, "utf-8");
}

export function getProfilePath(profile = "default"): string {
  return join(getMemoryPaths().profiles, profile, "personality.md");
}

function ensureBlockFile(name: string, title: string): void {
  const paths = getMemoryPaths();
  touchFile(join(paths.blocks, name), blockTemplate(title));
}

function ensureProjectBlock(projectKey: string): string {
  const paths = getMemoryPaths();
  const path = join(paths.projects, `${projectKey}.md`);
  touchFile(path, blockTemplate(`Project: ${projectKey}`));
  return path;
}

export function ensureMemoryHome(profile = "default"): void {
  const paths = getMemoryPaths();
  ensureDir(paths.home);
  ensureDir(paths.profiles);
  ensureDir(join(paths.profiles, "default"));
  ensureDir(join(paths.profiles, profile));
  ensureDir(paths.blocks);
  ensureDir(paths.projects);
  ensureDir(paths.events);
  ensureDir(paths.index);
  ensureDir(paths.runtime);
  ensureDir(paths.runtimeSessionStart);
  ensureDir(paths.snapshots);

  touchFile(getProfilePath("default"), DEFAULT_PERSONALITY_TEMPLATE);
  touchFile(getProfilePath(profile), DEFAULT_PERSONALITY_TEMPLATE);

  ensureBlockFile("user-profile.md", "User Profile");
  ensureBlockFile("preferences.md", "Preferences");
  ensureBlockFile("decisions.md", "Decisions");
  ensureBlockFile("active-threads.md", "Active Threads");
  ensureBlockFile("relationships.md", "Relationships");
  touchFile(paths.eventLog, "");

  if (!existsSync(paths.indexFile)) {
    writeFileSync(
      paths.indexFile,
      JSON.stringify(
        {
          version: 1,
          created_at: nowIso(),
          updated_at: nowIso(),
        },
        null,
        2,
      ) + "\n",
      "utf-8",
    );
  }
}

export function updateIndexTimestamp(): void {
  ensureMemoryHome(process.env.AI_MEMORY_PROFILE || "default");
  const paths = getMemoryPaths();
  let index: Record<string, unknown> = { version: 1, created_at: nowIso() };
  if (existsSync(paths.indexFile)) {
    try {
      index = JSON.parse(readFileSync(paths.indexFile, "utf-8"));
    } catch {
      index = { version: 1, created_at: nowIso() };
    }
  }
  index.updated_at = nowIso();
  writeFileSync(paths.indexFile, JSON.stringify(index, null, 2) + "\n", "utf-8");
}

export function readText(path: string): string {
  if (!existsSync(path)) return "";
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

export function writeText(path: string, value: string): void {
  writeFileSync(path, value, "utf-8");
}

function sanitizeProjectKey(input: string): string {
  const normalized = input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return normalized || "unknown-project";
}

function repoNameFromRemote(remote: string): string {
  const cleaned = remote.replace(/\.git$/, "");
  const parts = cleaned.split(/[/:]/).filter(Boolean);
  return parts[parts.length - 1] || "unknown-project";
}

export function getProjectKey(cwd = process.cwd()): string {
  try {
    const remote = execSync(`git -C "${cwd}" config --get remote.origin.url`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
    if (remote) return sanitizeProjectKey(repoNameFromRemote(remote));
  } catch {}

  return sanitizeProjectKey(basename(cwd));
}

function extractCandidateLines(markdown: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const raw of markdown.split("\n")) {
    const line = normalizeSpaces(raw.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, ""));
    if (!line) continue;
    if (line.startsWith("#")) continue;
    if (line.toLowerCase() === "entries") continue;
    if (line.length < 8) continue;

    const normalized = normalizeForCompare(line);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(line);
  }

  return out;
}

function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function lineScore(line: string, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 1;
  const lower = line.toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (lower.includes(token)) score += 1;
  }
  return score;
}

function collectBlockSnippets(
  path: string,
  sourceLabel: string,
  queryTokens: string[],
  boost: number,
): RecallSnippet[] {
  const text = readText(path);
  if (!text) return [];

  const lines = extractCandidateLines(text).slice(0, 50);
  const snippets: RecallSnippet[] = [];

  lines.forEach((line, idx) => {
    const relevance = lineScore(line, queryTokens);
    if (queryTokens.length > 0 && relevance === 0) return;
    snippets.push({
      source: sourceLabel,
      text: line,
      score: boost + relevance - idx * 0.01,
    });
  });

  return snippets;
}

function fitSnippetsToBudget(snippets: RecallSnippet[], maxChars: number): RecallSnippet[] {
  const out: RecallSnippet[] = [];
  const seen = new Set<string>();
  let used = 0;

  for (const snippet of snippets) {
    const normalized = normalizeForCompare(snippet.text);
    if (seen.has(normalized)) continue;
    const candidate = `${snippet.source}: ${snippet.text}`;
    if (used + candidate.length > maxChars) continue;

    seen.add(normalized);
    out.push(snippet);
    used += candidate.length + 1;
  }

  return out;
}

export function getRecallResult(options?: {
  cwd?: string;
  query?: string;
  maxChars?: number;
  profile?: string;
}): RecallResult {
  const cwd = options?.cwd || process.cwd();
  const query = options?.query || "";
  const maxChars = options?.maxChars ?? 2200;
  const profile = options?.profile || process.env.AI_MEMORY_PROFILE || "default";
  const projectKey = getProjectKey(cwd);
  const queryTokens = tokenizeQuery(query);

  ensureMemoryHome(profile);
  const projectPath = ensureProjectBlock(projectKey);
  const paths = getMemoryPaths();

  const blockDefs: Array<{ path: string; label: string; boost: number }> = [
    { path: projectPath, label: `project:${projectKey}`, boost: 40 },
    { path: join(paths.blocks, "active-threads.md"), label: "active-threads", boost: 30 },
    { path: join(paths.blocks, "decisions.md"), label: "decisions", boost: 25 },
    { path: join(paths.blocks, "preferences.md"), label: "preferences", boost: 20 },
    { path: join(paths.blocks, "user-profile.md"), label: "user-profile", boost: 15 },
    { path: join(paths.blocks, "relationships.md"), label: "relationships", boost: 10 },
  ];

  const rawSnippets = blockDefs.flatMap((def) =>
    collectBlockSnippets(def.path, def.label, queryTokens, def.boost),
  );

  rawSnippets.sort((a, b) => b.score - a.score);
  const snippets = fitSnippetsToBudget(rawSnippets, maxChars);

  return {
    profile,
    cwd,
    projectKey,
    snippets,
  };
}

export function formatRecallPrompt(result: RecallResult): string {
  const lines: string[] = [];
  lines.push("Memory Context");
  lines.push(`- Profile: ${result.profile}`);
  lines.push(`- Project: ${result.projectKey}`);
  if (result.snippets.length === 0) {
    lines.push("- No relevant memories found.");
    return lines.join("\n");
  }

  result.snippets.forEach((snippet) => {
    lines.push(`- [${snippet.source}] ${snippet.text}`);
  });
  return lines.join("\n");
}

export function formatRecallText(result: RecallResult): string {
  if (result.snippets.length === 0) return "No relevant memories found.";
  return result.snippets.map((snippet) => `[${snippet.source}] ${snippet.text}`).join("\n");
}

function eventId(): string {
  deterministicSequence += 1;
  return `evt_${nowDate().getTime()}_${deterministicSequence.toString().padStart(4, "0")}`;
}

export function appendMemoryEvent(input: {
  type: MemoryType;
  content: string;
  confidence?: Confidence;
  source?: string;
  projectKey?: string | null;
}): MemoryEvent {
  ensureMemoryHome(process.env.AI_MEMORY_PROFILE || "default");
  const paths = getMemoryPaths();

  const event: MemoryEvent = {
    id: eventId(),
    timestamp: nowIso(),
    type: input.type,
    content: normalizeSpaces(input.content),
    confidence: input.confidence || "observed",
    source: input.source || "manual",
    project_key: input.projectKey || getProjectKey(process.cwd()),
    status: "candidate",
    processed_at: null,
  };

  appendFileSync(paths.eventLog, JSON.stringify(event) + "\n", "utf-8");
  updateIndexTimestamp();
  return event;
}

export function readMemoryEvents(): MemoryEvent[] {
  ensureMemoryHome(process.env.AI_MEMORY_PROFILE || "default");
  const paths = getMemoryPaths();
  const raw = readText(paths.eventLog);
  if (!raw.trim()) return [];

  const out: MemoryEvent[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as MemoryEvent);
    } catch {}
  }
  return out;
}

export function writeMemoryEvents(events: MemoryEvent[]): void {
  const paths = getMemoryPaths();
  const payload = events.map((event) => JSON.stringify(event)).join("\n");
  writeText(paths.eventLog, payload ? payload + "\n" : "");
}

function blockPathForType(type: MemoryType): string {
  const paths = getMemoryPaths();
  switch (type) {
    case "fact":
      return join(paths.blocks, "user-profile.md");
    case "preference":
      return join(paths.blocks, "preferences.md");
    case "decision":
      return join(paths.blocks, "decisions.md");
    case "thread":
      return join(paths.blocks, "active-threads.md");
    case "relationship":
      return join(paths.blocks, "relationships.md");
    default:
      return join(paths.blocks, "active-threads.md");
  }
}

function appendEntryToBlock(path: string, content: string): boolean {
  const existing = readText(path);
  const normalizedContent = normalizeForCompare(content);
  const lines = extractCandidateLines(existing).map((line) =>
    normalizeForCompare(line.replace(/^\[\d{4}-\d{2}-\d{2}\]\s+/, "")),
  );
  if (lines.includes(normalizedContent)) return false;

  const prefix = existing.endsWith("\n") ? "" : "\n";
  const entry = `- [${todayDate()}] ${content}`;
  writeText(path, `${existing}${prefix}${entry}\n`);
  return true;
}

export function consolidateMemory(options?: { dryRun?: boolean }): ConsolidateResult {
  const dryRun = options?.dryRun === true;
  const events = readMemoryEvents();
  const updatedEvents: MemoryEvent[] = [];
  let processed = 0;
  let promoted = 0;
  let duplicates = 0;
  let skipped = 0;

  for (const event of events) {
    if (event.processed_at) {
      updatedEvents.push(event);
      continue;
    }

    processed += 1;
    const mutable = { ...event };

    if (!mutable.content || mutable.content.length < 6) {
      mutable.status = "skipped";
      mutable.processed_at = nowIso();
      skipped += 1;
      updatedEvents.push(mutable);
      continue;
    }

    if (mutable.confidence === "inferred") {
      mutable.status = "skipped";
      mutable.processed_at = nowIso();
      skipped += 1;
      updatedEvents.push(mutable);
      continue;
    }

    const destination = blockPathForType(mutable.type);
    const promotedMain = appendEntryToBlock(
      destination,
      `${mutable.content} (confidence: ${mutable.confidence})`,
    );

    let promotedProject = false;
    if (mutable.project_key) {
      const projectBlock = ensureProjectBlock(mutable.project_key);
      promotedProject = appendEntryToBlock(projectBlock, `${mutable.type}: ${mutable.content}`);
    }

    if (promotedMain || promotedProject) {
      mutable.status = "promoted";
      promoted += 1;
    } else {
      mutable.status = "duplicate";
      duplicates += 1;
    }
    mutable.processed_at = nowIso();
    updatedEvents.push(mutable);
  }

  if (!dryRun) {
    writeMemoryEvents(updatedEvents);
    updateIndexTimestamp();
  }

  return { processed, promoted, duplicates, skipped };
}

export function getRuntimeSessionStartPath(sessionId: string): string {
  ensureMemoryHome(process.env.AI_MEMORY_PROFILE || "default");
  const paths = getMemoryPaths();
  return join(paths.runtimeSessionStart, `${sessionId}.md`);
}

export function successEnvelope<T>(code: string, details: T): ScriptResultEnvelope<T> {
  return { ok: true, code, details };
}

export function failureEnvelope<T>(code: string, details: T): ScriptResultEnvelope<T> {
  return { ok: false, code, details };
}
