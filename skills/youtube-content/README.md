# YouTube Content Skill

Extract transcripts and metadata from YouTube videos for AI-assisted analysis.

## What It Does

When you share a YouTube URL and ask Claude to analyze it, this skill:

1. Fetches the video transcript (captions/subtitles)
2. Fetches metadata (title, channel, description, duration, view count, etc.)
3. Analyzes the content based on your request

## How to Trigger It

The skill activates when you explicitly request analysis of a YouTube video. Examples:

```
"Summarize this video: https://youtube.com/watch?v=abc123"

"Extract the key insights from https://youtu.be/xyz789"

"What are the main points in this video? https://youtube.com/watch?v=def456"

"Get me the transcript from this YouTube video and highlight notable quotes"
```

The skill does **not** auto-trigger when you simply paste a YouTube URL. You need to ask for analysis.

## Analysis Modes

| Mode | Trigger Phrases |
|------|-----------------|
| **Wisdom** | "extract wisdom", "key insights", "what can I learn" |
| **Summary** | "summarize", "TLDR", "overview", "main points" |
| **Q&A** | "questions", "discussion topics", "what to ask" |
| **Quotes** | "notable quotes", "key statements" |
| **Custom** | Any specific request ("list the tools mentioned", "find statistics") |

## Supported URL Formats

- `https://youtube.com/watch?v=VIDEO_ID`
- `https://youtu.be/VIDEO_ID`
- `https://youtube.com/embed/VIDEO_ID`
- URLs with timestamps (`?t=30`)

## Requirements

The skill uses one Python library, installed automatically via `uv`:

- `yt-dlp[default]` - fetches both video metadata and captions. The `[default]` extra installs `yt-dlp-ejs`, which combined with a JS runtime already on your PATH (Deno, Node, or Bun) lets yt-dlp solve YouTube's signature/n-challenges. Without one, metadata generally still works but captions may fail on some videos with a "SABR streaming" error - install Deno (https://deno.land) to fix this.

(An earlier version of this skill also used `youtube-transcript-api` for captions; that's been dropped in favor of fetching captions through yt-dlp itself, which handles YouTube's current anti-bot measures far more reliably.)

## Limitations

- **No transcript available**: Some videos have captions disabled. The skill will still return metadata.
- **Private/unlisted videos**: Cannot access these without authentication.
- **Age-restricted content**: May fail to fetch metadata.
- **Rate limiting**: The caption endpoint intermittently returns HTTP 429 regardless of how many videos you've fetched; the script retries this automatically a few times before giving up.

## Testing

Run the test suite to verify the skill works:

```bash
uv run scripts/test_fetch.py
```

## Manual Usage

You can also run the fetch script directly:

```bash
# Full fetch (transcript + metadata)
uv run scripts/fetch_youtube.py "https://youtube.com/watch?v=dQw4w9WgXcQ"

# Metadata only
uv run scripts/fetch_youtube.py "https://youtube.com/watch?v=dQw4w9WgXcQ" --metadata-only

# Transcript only
uv run scripts/fetch_youtube.py "https://youtube.com/watch?v=dQw4w9WgXcQ" --transcript-only

# Include timestamped segments (for quote extraction)
uv run scripts/fetch_youtube.py "https://youtube.com/watch?v=dQw4w9WgXcQ" --with-segments

# Prefer a specific subtitle language (falls back to original/auto if unavailable)
uv run scripts/fetch_youtube.py "https://youtube.com/watch?v=dQw4w9WgXcQ" --lang ar
```

Output is JSON with `video_id`, `metadata`, `transcript`, and `errors` fields.

By default, the transcript only includes concatenated text (saves ~70% tokens). Use `--with-segments` when you need timestamps for quote attribution.
