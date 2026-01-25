/**
 * Shared context detection for Chronicle scripts.
 * Detects project, worktree, and branch from a working directory.
 */
import { execSync } from "child_process";
import { basename } from "path";

export interface Context {
  project: string;
  worktree: string | null;
  branch: string | null;
  cwd: string;
}

const WORKTREE_SPACES = [
  {
    basePath: `${process.env.HOME}/conductor/workspaces`,
    projectAliases: { ".claude": "dotclaude" } as Record<string, string>,
  },
  {
    basePath: `${process.env.HOME}/.worktrees`,
    projectAliases: {} as Record<string, string>,
  },
];

function parseWorktreeSpace(cwd: string): { project: string; worktree: string | null } | null {
  for (const space of WORKTREE_SPACES) {
    if (!cwd.startsWith(space.basePath)) continue;
    const relativePath = cwd.slice(space.basePath.length + 1);
    const parts = relativePath.split("/").filter(Boolean);
    if (parts.length >= 2) {
      const repo = parts[0];
      const worktree = parts[1];
      const project = space.projectAliases[repo] ?? repo;
      return { project, worktree };
    } else if (parts.length === 1) {
      const project = space.projectAliases[parts[0]] ?? parts[0];
      return { project, worktree: null };
    }
  }
  return null;
}

export function detectContext(cwd: string): Context {
  const parsed = parseWorktreeSpace(cwd);
  const worktree = parsed?.worktree ?? null;
  let project = parsed?.project ?? null;
  let branch: string | null = null;

  try {
    const url = execSync(`git -C "${cwd}" config --get remote.origin.url`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    project = url.replace(/\.git$/, "").split("/").pop() || basename(cwd);
  } catch {
    if (!project) project = basename(cwd);
  }

  try {
    branch = execSync(`git -C "${cwd}" branch --show-current`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim() || null;
  } catch {}

  return { project, worktree, branch, cwd };
}
