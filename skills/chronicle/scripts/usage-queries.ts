/**
 * Usage queries for Chronicle - fetch data from ai-coding-usage DuckDB.
 */
import { execSync } from "child_process";

const DB_PATH = `${process.env.HOME}/.local/share/ai-coding-usage/usage.duckdb`;

function query(sql: string): unknown[] {
  try {
    const result = execSync(`duckdb "${DB_PATH}" -json -c "${sql.replace(/"/g, '\\"')}"`, {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return JSON.parse(result);
  } catch {
    return [];
  }
}

// Sanitize input to prevent SQL injection (alphanumeric, dash, underscore, space only)
function sanitize(input: string): string {
  return input.replace(/[^a-zA-Z0-9_\- ]/g, "");
}

export interface GlobalUsage {
  total_interactions: number;
  total_tokens: number;
  sessions: number;
  projects: number;
}

export interface RepoUsage {
  interactions: number;
  tokens: number;
  sessions: number;
}

export interface ToolBreakdown {
  tool: string;
  uses: number;
}

export interface PeakHour {
  hour_of_day: number;
  total: number;
}

export function getGlobalUsage(days = 7): GlobalUsage | null {
  const results = query(`
    SELECT
      COUNT(*) as total_interactions,
      SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)) as total_tokens,
      COUNT(DISTINCT session_id) as sessions,
      COUNT(DISTINCT project_name) as projects
    FROM interactions
    WHERE timestamp >= CURRENT_DATE - INTERVAL '${days} days'
  `);
  return (results[0] as GlobalUsage) || null;
}

export function getRepoUsage(repoName: string, days = 7): RepoUsage | null {
  const sanitized = sanitize(repoName);
  const results = query(`
    SELECT
      COUNT(*) as interactions,
      SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)) as tokens,
      COUNT(DISTINCT session_id) as sessions
    FROM interactions
    WHERE (project_name ILIKE '%${sanitized}%' OR project ILIKE '%${sanitized}%')
      AND timestamp >= CURRENT_DATE - INTERVAL '${days} days'
  `);
  return (results[0] as RepoUsage) || null;
}

export function getToolBreakdown(projectPath?: string, days = 7): ToolBreakdown[] {
  const where = projectPath
    ? `WHERE (project ILIKE '%${sanitize(projectPath)}%' OR project_name ILIKE '%${sanitize(projectPath)}%') AND timestamp >= CURRENT_DATE - INTERVAL '${days} days'`
    : `WHERE timestamp >= CURRENT_DATE - INTERVAL '${days} days'`;

  const results = query(`
    SELECT category as tool, COUNT(*) as uses
    FROM interactions
    ${where}
    GROUP BY category
    ORDER BY uses DESC
    LIMIT 10
  `);
  return results as ToolBreakdown[];
}

export function getPeakHours(days = 30): PeakHour[] {
  const results = query(`
    SELECT hour_of_day, SUM(interactions) as total
    FROM peak_hours
    GROUP BY hour_of_day
    ORDER BY total DESC
    LIMIT 3
  `);
  return results as PeakHour[];
}

export function getDailyActivity(days = 7): { date: string; interactions: number }[] {
  const results = query(`
    SELECT DATE(timestamp) as date, COUNT(*) as interactions
    FROM interactions
    WHERE timestamp >= CURRENT_DATE - INTERVAL '${days} days'
    GROUP BY DATE(timestamp)
    ORDER BY date DESC
  `);
  return results as { date: string; interactions: number }[];
}

export function getTopProjects(days = 7, limit = 5): { project: string; interactions: number }[] {
  const results = query(`
    SELECT
      COALESCE(project_name, project) as project,
      COUNT(*) as interactions
    FROM interactions
    WHERE timestamp >= CURRENT_DATE - INTERVAL '${days} days'
    GROUP BY COALESCE(project_name, project)
    ORDER BY interactions DESC
    LIMIT ${limit}
  `);
  return results as { project: string; interactions: number }[];
}
