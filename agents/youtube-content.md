---
name: youtube-content
description: Extract and analyze YouTube video content (transcripts + metadata). Use when the user shares a YouTube URL and asks to summarize, analyze, extract wisdom from, or get context from a video. Returns transcript and metadata for analysis.
---

# YouTube Content Agent

Extract and analyze YouTube videos independently so the main conversation can continue.

## Instructions

Read `~/.claude/skills/youtube-content/SKILL.md` for the complete workflow (fetch script, analysis modes, knowledge persistence), then apply it to the user's request.

## Output

Return the analysis in the requested mode (wisdom, summary, Q&A, quotes, or custom) along with video metadata (title, channel, duration).
