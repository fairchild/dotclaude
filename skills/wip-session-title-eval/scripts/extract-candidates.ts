#!/usr/bin/env bun
/**
 * Extract candidate test cases from existing session transcripts.
 *
 * Usage:
 *   bun extract-candidates.ts [--limit N] [--project NAME]
 */
import { readdirSync, readFileSync, existsSync, writeFileSync } from "fs";
import { join, basename } from "path";
import { createHash } from "crypto";

const HOME = process.env.HOME!;
const PROJECTS_DIR = join(HOME, ".claude", "projects");
const TITLES_DIR = join(HOME, ".claude", "session-titles");
const OUTPUT_FILE = join(HOME, ".claude", "skills", "session-title-eval", "data", "candidates.jsonl");

interface SessionContext {
  firstMessage: string | null;
  lastMessage: string | null;
  gitBranch: string | null;
  projectName: string;
  modifiedFiles: string[];
  explicitSummary: string | null;
  messageCount: number;
}

interface Candidate {
  id: string;
  source_session: string;
  source_project: string;
  context: SessionContext;
  generated_title: string | null;
  ideal_title: null;
  human_score: null;
  notes: null;
}

function extractSessionContext(path: string, projectName: string): SessionContext {
  const ctx: SessionContext = {
    firstMessage: null,
    lastMessage: null,
    gitBranch: null,
    projectName,
    modifiedFiles: [],
    explicitSummary: null,
    messageCount: 0,
  };

  if (!existsSync(path)) return ctx;

  const seenFiles = new Set<string>();

  for (const line of readFileSync(path, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);

      if (entry.type === "summary" && entry.summary && !ctx.explicitSummary) {
        ctx.explicitSummary = entry.summary.substring(0, 100);
        continue;
      }

      if (entry.type === "user" && entry.message?.role === "user") {
        if (entry.gitBranch && !ctx.gitBranch) {
          ctx.gitBranch = entry.gitBranch;
        }

        const text = typeof entry.message.content === "string"
          ? entry.message.content
          : entry.message.content?.find((c: any) => c.type === "text")?.text;

        if (!text || text.startsWith("<") || text.startsWith("Caveat:") || text.length < 10) continue;

        const sentence = text.split(/(?<=[.!?])\s+|\n/)[0].replace(/\s+/g, " ").trim().substring(0, 100);
        ctx.messageCount++;

        if (!ctx.firstMessage) ctx.firstMessage = sentence;
        ctx.lastMessage = sentence;
        continue;
      }

      if (entry.type === "assistant" && Array.isArray(entry.message?.content)) {
        for (const block of entry.message.content) {
          if (block.type === "tool_use" && (block.name === "Edit" || block.name === "Write")) {
            const filePath = block.input?.file_path;
            if (filePath && !seenFiles.has(filePath)) {
              seenFiles.add(filePath);
              ctx.modifiedFiles.push(basename(filePath));
            }
          }
        }
      }
    } catch {}
  }

  return ctx;
}

function getProjectNameFromPath(projectPath: string): string {
  // Project dirs are named like: -Users-username-code-myproject
  const dirName = basename(projectPath);
  const parts = dirName.split("-").filter(Boolean);
  return parts[parts.length - 1] || dirName;
}

function findSessionFiles(projectDir: string): string[] {
  const files: string[] = [];
  try {
    for (const file of readdirSync(projectDir)) {
      if (file.endsWith(".jsonl") && !file.includes("conversation")) {
        files.push(join(projectDir, file));
      }
    }
  } catch {}
  return files;
}

function getGeneratedTitle(projectName: string, sessionId: string): string | null {
  const titleFile = join(TITLES_DIR, projectName, `${sessionId}.txt`);
  if (existsSync(titleFile)) {
    return readFileSync(titleFile, "utf-8").trim();
  }
  return null;
}

function generateId(sessionId: string, projectName: string): string {
  const hash = createHash("sha256")
    .update(`${projectName}:${sessionId}`)
    .digest("hex")
    .substring(0, 8);
  return hash;
}

async function main() {
  const args = process.argv.slice(2);
  let limit = 100;
  let projectFilter: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1]) {
      limit = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--project" && args[i + 1]) {
      projectFilter = args[i + 1];
      i++;
    }
  }

  const candidates: Candidate[] = [];
  const projectDirs = readdirSync(PROJECTS_DIR).filter(d => {
    if (projectFilter) {
      return d.toLowerCase().includes(projectFilter.toLowerCase());
    }
    return true;
  });

  console.log(`Scanning ${projectDirs.length} project directories...`);

  for (const projectDir of projectDirs) {
    const fullPath = join(PROJECTS_DIR, projectDir);
    const projectName = getProjectNameFromPath(fullPath);
    const sessionFiles = findSessionFiles(fullPath);

    for (const sessionFile of sessionFiles) {
      if (candidates.length >= limit) break;

      const sessionId = basename(sessionFile, ".jsonl");
      const ctx = extractSessionContext(sessionFile, projectName);

      // Filter: must have 3+ messages and a valid first message
      if (ctx.messageCount < 3 || !ctx.firstMessage) continue;

      const generatedTitle = getGeneratedTitle(projectName, sessionId);

      candidates.push({
        id: generateId(sessionId, projectName),
        source_session: sessionId,
        source_project: projectName,
        context: ctx,
        generated_title: generatedTitle,
        ideal_title: null,
        human_score: null,
        notes: null,
      });
    }

    if (candidates.length >= limit) break;
  }

  // Write output
  const output = candidates.map(c => JSON.stringify(c)).join("\n");
  writeFileSync(OUTPUT_FILE, output + "\n");

  console.log(`\nExtracted ${candidates.length} candidates to:`);
  console.log(`  ${OUTPUT_FILE}`);
  console.log(`\nNext steps:`);
  console.log(`  1. Review candidates and add ideal_title, human_score, notes`);
  console.log(`  2. Move curated entries to data/golden.jsonl`);
}

main().catch(console.error);
