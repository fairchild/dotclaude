---
arc: memory-loop-quality
---

# ai-coding-usage: Import Auto Memory into DuckDB

## Problem Statement

The ai-coding-usage script indexes session logs (JSONL), messages, system events, and session metadata — but ignores Claude's auto memory files (`~/.claude/projects/*/memory/`). These markdown files contain accumulated learnings, patterns, and insights that Claude writes for itself across sessions. Importing them would enable queries like "what has Claude learned across all projects" and correlate memory growth with session activity.

## What We Know

- Memory files live at `~/.claude/projects/{project-hash}/memory/`
- Each project has a `MEMORY.md` entrypoint (first 200 lines loaded into system prompt)
- Optional topic files: `debugging.md`, `patterns.md`, etc.
- Files are markdown, not JSONL — needs different parsing than existing loaders
- Project hash maps to a git repo root (same hash used for session JSONL files)
- Memory files are small and few compared to session logs

## Potential Table Schema

```sql
CREATE TABLE memory_files (
    file_path VARCHAR PRIMARY KEY,
    project_dir VARCHAR,        -- parent project directory
    repo_name VARCHAR,          -- extracted from project path
    filename VARCHAR,           -- e.g., MEMORY.md, debugging.md
    content VARCHAR,            -- full markdown content
    line_count INTEGER,
    byte_size INTEGER,
    mtime TIMESTAMP,
    source_file VARCHAR         -- for incremental loading consistency
);
```

## Potential Queries

```sql
-- Which projects have memory files?
SELECT repo_name, COUNT(*) as files, SUM(line_count) as total_lines
FROM memory_files GROUP BY repo_name ORDER BY total_lines DESC;

-- Search across all memory
SELECT repo_name, filename, content
FROM memory_files WHERE content ILIKE '%pattern%';

-- Memory growth over time (via mtime)
SELECT DATE_TRUNC('week', mtime) as week, COUNT(*) as files_modified
FROM memory_files GROUP BY week ORDER BY week;

-- Projects with most accumulated knowledge
SELECT repo_name, SUM(byte_size) as total_bytes
FROM memory_files GROUP BY repo_name ORDER BY total_bytes DESC;
```

## Open Questions

- Should we parse markdown structure (headings, bullets) into structured fields?
- FTS index on memory content for cross-project search?
- Track memory file history (content changes over time) or just current state?
- Include CLAUDE.md files too, or just auto memory?
