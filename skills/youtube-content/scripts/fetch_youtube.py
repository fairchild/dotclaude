#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["yt-dlp[default]"]
# ///
"""
Fetch YouTube video transcript and metadata.

Uses yt-dlp exclusively for both metadata and captions (dropped
youtube-transcript-api - it has no JS-challenge handling and fails
against YouTube's current anti-bot/SABR measures far more often than
yt-dlp does). The "[default]" extra pulls in yt-dlp-ejs, which
together with a JS runtime (Deno/Node/Bun already on PATH) lets
yt-dlp solve YouTube's signature/n-challenges. Without a JS runtime,
metadata fetching still generally works, but caption fetching for
some videos may not.

Usage:
    uv run fetch_youtube.py URL [--transcript-only] [--metadata-only]
                                 [--with-segments] [--lang LANG]

Output:
    JSON to stdout with structure:
    {
        "video_id": "...",
        "metadata": {...},
        "transcript": {...},
        "errors": []
    }
"""

import argparse
import glob
import json
import os
import re
import shutil
import sys
import tempfile
import time
from typing import TypedDict

import yt_dlp
from yt_dlp.utils import DownloadError, ExtractorError


class Metadata(TypedDict, total=False):
    title: str
    channel: str
    description: str
    duration_seconds: int
    duration_formatted: str
    view_count: int
    upload_date: str
    tags: list[str]


class TranscriptSegment(TypedDict):
    start: float
    duration: float
    text: str


class Transcript(TypedDict, total=False):
    text: str
    segments: list[TranscriptSegment]
    language: str


class VideoContent(TypedDict, total=False):
    video_id: str
    metadata: Metadata
    transcript: Transcript
    errors: list[str]


def extract_video_id(url: str) -> str | None:
    """Extract video ID from various YouTube URL formats."""
    patterns = [
        r"(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/embed/|youtube\.com/v/)([a-zA-Z0-9_-]{11})",
        r"^([a-zA-Z0-9_-]{11})$",  # bare video ID
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None


def check_environment() -> list[str]:
    """Non-fatal environment warnings (missing JS runtime, stale yt-dlp)."""
    warnings = []
    if not any(shutil.which(rt) for rt in ("deno", "node", "bun")):
        warnings.append(
            "No JS runtime (deno/node/bun) found on PATH - YouTube may force "
            "SABR-only streaming and block format/caption resolution for some "
            "videos. Install Deno (https://deno.land) to fix this."
        )
    return warnings


def _probe(video_id: str, url: str) -> tuple[dict | None, str | None]:
    """Single extract_info call reused by metadata + transcript fetchers."""
    ydl_opts = {"quiet": True, "no_warnings": True, "skip_download": True}
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            return ydl.extract_info(url, download=False), None
    except DownloadError as e:
        return None, f"Video unavailable or download blocked: {e}"
    except ExtractorError as e:
        return None, f"Failed to extract video info: {e}"


def build_metadata(info: dict) -> Metadata:
    duration = info.get("duration", 0) or 0
    minutes, seconds = divmod(duration, 60)
    hours, minutes = divmod(minutes, 60)
    duration_fmt = f"{hours}:{minutes:02d}:{seconds:02d}" if hours else f"{minutes}:{seconds:02d}"

    return {
        "title": info.get("title", ""),
        "channel": info.get("uploader", ""),
        "description": info.get("description", ""),
        "duration_seconds": duration,
        "duration_formatted": duration_fmt,
        "view_count": info.get("view_count", 0),
        "upload_date": info.get("upload_date", ""),
        "tags": info.get("tags") or [],
    }


def pick_subtitle_lang(info: dict, requested: str | None) -> tuple[str | None, bool]:
    """Return (lang_code, is_auto_generated) for the best matching track."""
    subs = info.get("subtitles") or {}
    autos = info.get("automatic_captions") or {}

    if requested:
        if requested in subs:
            return requested, False
        if requested in autos:
            return requested, True
        return None, False

    original = info.get("language")
    if original:
        if original in subs:
            return original, False
        if original in autos:
            return original, True

    if subs:
        return next(iter(subs)), False
    if autos:
        for candidate in ("en", "en-US", "en-orig", "en-GB"):
            if candidate in autos:
                return candidate, True
        return next(iter(autos)), True

    return None, False


def fetch_transcript(
    info: dict,
    video_id: str,
    lang: str | None = None,
    with_segments: bool = False,
    max_retries: int = 4,
    retry_delay: float = 8.0,
) -> tuple[Transcript | None, str | None]:
    """Fetch captions via yt-dlp (json3 format) instead of youtube-transcript-api.

    YouTube's timedtext endpoint intermittently returns HTTP 429 regardless
    of yt-dlp version - this is retried a few times with a short backoff,
    which resolves it in practice almost every time.
    """
    url = f"https://www.youtube.com/watch?v={video_id}"
    lang_code, is_auto = pick_subtitle_lang(info, lang)
    if not lang_code:
        return None, "No transcript available for this video"

    tmpdir = tempfile.mkdtemp(prefix="ytx_")
    try:
        dl_opts = {
            "quiet": True,
            "no_warnings": True,
            "noprogress": True,
            "skip_download": True,
            "writesubtitles": not is_auto,
            "writeautomaticsub": is_auto,
            "subtitleslangs": [lang_code],
            "subtitlesformat": "json3",
            "outtmpl": os.path.join(tmpdir, "%(id)s.%(ext)s"),
        }

        last_err: Exception | None = None
        for attempt in range(1, max_retries + 1):
            try:
                with yt_dlp.YoutubeDL(dl_opts) as ydl:
                    ydl.download([url])
                last_err = None
                break
            except DownloadError as e:
                last_err = e
                if "429" in str(e) and attempt < max_retries:
                    time.sleep(retry_delay)
                    continue
                raise
        if last_err:
            raise last_err

        matches = glob.glob(os.path.join(tmpdir, f"*.{lang_code}.json3")) or glob.glob(
            os.path.join(tmpdir, "*.json3")
        )
        if not matches:
            return None, f"Subtitle file not produced for language '{lang_code}'"

        with open(matches[0], encoding="utf-8") as f:
            data = json.load(f)

        segments: list[TranscriptSegment] = []
        for event in data.get("events", []):
            segs = event.get("segs")
            if not segs:
                continue
            text = "".join(s.get("utf8", "") for s in segs).strip()
            if not text:
                continue
            segments.append(
                {
                    "start": event.get("tStartMs", 0) / 1000,
                    "duration": event.get("dDurationMs", 0) / 1000,
                    "text": text,
                }
            )

        transcript: Transcript = {
            "text": " ".join(s["text"] for s in segments),
            "language": lang_code,
        }
        if with_segments:
            transcript["segments"] = segments

        return transcript, None

    except DownloadError as e:
        msg = str(e)
        if "429" in msg:
            return None, "Rate limited by YouTube while fetching subtitles (HTTP 429) even after retries - try again shortly"
        return None, f"Transcript extraction failed: {msg}"
    except Exception as e:
        return None, f"Transcript extraction failed ({type(e).__name__}): {e}"
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def main():
    parser = argparse.ArgumentParser(description="Fetch YouTube video content")
    parser.add_argument("url", help="YouTube video URL or video ID")
    parser.add_argument(
        "--transcript-only", action="store_true", help="Only fetch transcript, skip metadata"
    )
    parser.add_argument(
        "--metadata-only", action="store_true", help="Only fetch metadata, skip transcript"
    )
    parser.add_argument(
        "--with-segments",
        action="store_true",
        help="Include timestamped segments (increases output size)",
    )
    parser.add_argument(
        "--lang",
        default=None,
        help="Preferred subtitle language code (e.g. 'ar', 'en'). Defaults to the video's original language, falling back to any available track.",
    )
    args = parser.parse_args()

    video_id = extract_video_id(args.url)
    if not video_id:
        print(json.dumps({"errors": ["Invalid YouTube URL or video ID"]}))
        sys.exit(1)

    result: VideoContent = {"video_id": video_id, "errors": check_environment()}

    url = f"https://www.youtube.com/watch?v={video_id}"
    info, probe_error = _probe(video_id, url)
    if probe_error:
        result["errors"].append(probe_error)
        print(json.dumps(result, indent=2))
        sys.exit(1)

    if not args.transcript_only:
        result["metadata"] = build_metadata(info)

    if not args.metadata_only:
        transcript, error = fetch_transcript(
            info, video_id, lang=args.lang, with_segments=args.with_segments
        )
        if transcript:
            result["transcript"] = transcript
        if error:
            result["errors"].append(error)

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
