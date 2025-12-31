---
name: youtube-content
description: Extract and analyze YouTube video content (transcripts + metadata). Use when the user shares a YouTube URL and asks to summarize, analyze, extract wisdom from, or get context from a video. Returns transcript and metadata for analysis.
---

# YouTube Content Agent

Extract transcripts and metadata from YouTube videos for analysis.

## When to Use

- User shares a YouTube URL and asks for summary, analysis, or insights
- User wants to understand a video without watching it
- User asks for key quotes, wisdom extraction, or Q&A prep from a video

## Workflow

### Step 1: Extract Video Content

Run the fetch script with the YouTube URL:

```bash
# Default (most analysis modes - saves ~70% tokens)
uv run ~/.claude/skills/youtube-content/scripts/fetch_youtube.py "VIDEO_URL"

# For quote extraction with timestamps
uv run ~/.claude/skills/youtube-content/scripts/fetch_youtube.py "VIDEO_URL" --with-segments
```

The script outputs JSON with:
- `video_id`: The YouTube video ID
- `metadata`: Title, channel, description, duration, view count, upload date, tags
- `transcript`: Full text and language (add `--with-segments` for timestamped segments)
- `errors`: Any issues encountered

### Step 2: Present Metadata Summary

Show the user:
- **Title**: {metadata.title}
- **Channel**: {metadata.channel}
- **Duration**: {metadata.duration_formatted}
- **Views**: {metadata.view_count}

### Step 3: Apply Analysis Mode

Based on user request:

| Request | Analysis |
|---------|----------|
| "summarize", "TLDR", "overview" | Provide concise summary with main points |
| "extract wisdom", "key insights" | Key ideas, actionable insights, memorable quotes |
| "questions", "Q&A", "discussion" | Clarifying, discussion, and follow-up questions |
| "quotes", "notable statements" | Notable quotes with context and timestamps (use `--with-segments`) |
| Other | Apply user's specific instructions |

### Step 4: Return Analysis

Format output as markdown with clear sections based on the analysis mode.

## Error Handling

- **No transcript**: Return metadata summary, explain transcript unavailable
- **Private video**: Inform user video is inaccessible
- **Invalid URL**: Ask user to verify the URL

## Supported URL Formats

- `youtube.com/watch?v=VIDEO_ID`
- `youtu.be/VIDEO_ID`
- `youtube.com/embed/VIDEO_ID`
- URLs with timestamps (`?t=30`)

## Example Usage

User: "Summarize this video https://youtu.be/abc123"

Agent:
1. Run fetch script
2. Display metadata (title, channel, duration)
3. Analyze transcript for main points
4. Return summary with key takeaways
