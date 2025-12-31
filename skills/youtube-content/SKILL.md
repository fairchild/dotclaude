---
name: youtube-content
description: Extract and analyze YouTube video content (transcripts + metadata). Use when the user explicitly requests to analyze, summarize, extract wisdom from, or get context from a YouTube video. Supports wisdom extraction, summary, Q&A prep, key quotes, and custom analysis. Does NOT auto-trigger on YouTube URLs - only when analysis is explicitly requested.
---

# YouTube Content

Extract transcripts and metadata from YouTube videos for analysis.

## Workflow

1. Extract video ID from URL
2. Run fetch script from skill directory
3. Present metadata summary to user
4. Apply requested analysis mode to transcript

## Fetch Script

Run from the skill directory (`~/.claude/skills/youtube-content/`):

```bash
uv run ~/.claude/skills/youtube-content/scripts/fetch_youtube.py "https://youtube.com/watch?v=VIDEO_ID"
```

Options:
- `--metadata-only` - Skip transcript extraction
- `--transcript-only` - Skip metadata extraction
- `--with-segments` - Include timestamped segments (for quote extraction)

Output: JSON with `{video_id, metadata, transcript, errors}`

By default, transcript contains only `text` and `language`. Use `--with-segments` when timestamps are needed (e.g., Quotes mode).

## Supported URL Formats

- `youtube.com/watch?v=VIDEO_ID`
- `youtu.be/VIDEO_ID`
- `youtube.com/embed/VIDEO_ID`
- `youtube.com/v/VIDEO_ID`
- Bare video ID (11 characters)

## Analysis Modes

Select based on user request:

| User Says | Mode | Action |
|-----------|------|--------|
| "extract wisdom", "key insights" | Wisdom | See [analysis-modes.md](references/analysis-modes.md#wisdom) |
| "summarize", "TLDR", "overview" | Summary | See [analysis-modes.md](references/analysis-modes.md#summary) |
| "questions", "Q&A", "discussion" | Q&A | See [analysis-modes.md](references/analysis-modes.md#qa) |
| "quotes", "notable statements" | Quotes | Use `--with-segments`, see [analysis-modes.md](references/analysis-modes.md#quotes) |
| Other specific requests | Custom | Apply user's instructions directly |

## Error Handling

The script returns partial results when possible:

- **Transcripts disabled**: Returns metadata only, notes error
- **Private video**: Clear error message with video ID
- **No transcript found**: Returns metadata, suggests alternatives
- **Rate limiting**: Retry after 30-60 seconds

Check the `errors` array in output for any issues.
