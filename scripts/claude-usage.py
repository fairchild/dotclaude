#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx"]
# ///
"""Check Claude usage limits from the command line."""

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone

import httpx

API_URL = "https://api.anthropic.com/api/oauth/usage"
KEYCHAIN_SERVICE = "Claude Code-credentials"


def get_oauth_token() -> str | None:
    """Read OAuth token from macOS Keychain."""
    try:
        result = subprocess.run(
            ["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
            capture_output=True,
            text=True,
            check=True,
        )
        creds = json.loads(result.stdout.strip())
        return creds.get("claudeAiOauth", {}).get("accessToken")
    except (subprocess.CalledProcessError, json.JSONDecodeError, KeyError):
        return None


def fetch_usage(token: str) -> dict | None:
    """Fetch usage data from Claude API."""
    headers = {
        "Authorization": f"Bearer {token}",
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": "claude-code/2.0.37",
    }
    try:
        resp = httpx.get(API_URL, headers=headers, timeout=10)
        resp.raise_for_status()
        return resp.json()
    except httpx.HTTPError as e:
        print(f"API error: {e}", file=sys.stderr)
        return None


def format_duration(reset_time: str) -> str:
    """Format time until reset as human-readable duration."""
    reset_dt = datetime.fromisoformat(reset_time.replace("Z", "+00:00"))
    now = datetime.now(timezone.utc)
    delta = reset_dt - now

    if delta.total_seconds() <= 0:
        return "now"

    hours, remainder = divmod(int(delta.total_seconds()), 3600)
    minutes = remainder // 60

    if hours > 0:
        return f"{hours}h{minutes}m"
    return f"{minutes}m"


def format_reset_time(reset_time: str) -> str:
    """Format reset time as day + time."""
    reset_dt = datetime.fromisoformat(reset_time.replace("Z", "+00:00"))
    local_dt = reset_dt.astimezone()
    return local_dt.strftime("%a %-I:%M %p")


def format_reset_short(reset_time: str) -> str:
    """Format reset time compactly for one-liner."""
    reset_dt = datetime.fromisoformat(reset_time.replace("Z", "+00:00"))
    now = datetime.now(timezone.utc)
    delta = reset_dt - now
    hours = int(delta.total_seconds()) // 3600

    if hours < 24:
        minutes = (int(delta.total_seconds()) % 3600) // 60
        return f"{hours}h{minutes}m" if hours > 0 else f"{minutes}m"

    local_dt = reset_dt.astimezone()
    return local_dt.strftime("%a")


def format_oneline(usage: dict) -> str:
    """One-liner for status bars: 5h:90%:1h34m 7d:30%:Thu"""
    five = usage.get("five_hour", {})
    seven = usage.get("seven_day", {})
    five_reset = format_duration(five.get("resets_at", ""))
    seven_reset = format_reset_short(seven.get("resets_at", ""))
    return f"5h:{five.get('utilization', 0):.0f}%:{five_reset} 7d:{seven.get('utilization', 0):.0f}%:{seven_reset}"


def format_human(usage: dict) -> str:
    """Human-readable format with reset times."""
    five = usage.get("five_hour", {})
    seven = usage.get("seven_day", {})
    sonnet = usage.get("seven_day_sonnet")

    five_pct = five.get("utilization", 0)
    five_reset = format_duration(five.get("resets_at", ""))
    seven_pct = seven.get("utilization", 0)
    seven_reset = format_reset_time(seven.get("resets_at", ""))

    lines = [
        "Claude Usage",
        f"Session (5h):  {five_pct:.0f}% | resets in {five_reset}",
        f"All models:    {seven_pct:.0f}% | resets {seven_reset}",
    ]

    if sonnet:
        sonnet_pct = sonnet.get("utilization", 0)
        sonnet_reset = format_reset_time(sonnet.get("resets_at", ""))
        lines.append(f"Sonnet only:   {sonnet_pct:.0f}% | resets {sonnet_reset}")

    return "\n".join(lines)


def format_json(usage: dict) -> str:
    """JSON output for programmatic use."""
    five = usage.get("five_hour", {})
    seven = usage.get("seven_day", {})

    output = {
        "session": {
            "used": five.get("utilization", 0),
            "resets_in": format_duration(five.get("resets_at", "")),
        },
        "weekly": {
            "used": seven.get("utilization", 0),
            "resets_at": format_reset_time(seven.get("resets_at", "")),
        },
        "raw": usage,
    }
    return json.dumps(output, indent=2)


def main():
    parser = argparse.ArgumentParser(
        description="Check Claude usage limits",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""\
examples:
  claude-usage.py          # compact: 5h:42%:3h12m 7d:15%:Thu
  claude-usage.py --human  # readable summary
  claude-usage.py --json   # full data for scripting
""",
    )
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--json", action="store_true", help="JSON output")
    group.add_argument("--human", action="store_true", help="Human-readable output")
    args = parser.parse_args()

    token = get_oauth_token()
    if not token:
        print("No Claude credentials found. Run 'claude' to authenticate.", file=sys.stderr)
        sys.exit(1)

    usage = fetch_usage(token)
    if not usage:
        sys.exit(1)

    if args.json:
        print(format_json(usage))
    elif args.human:
        print(format_human(usage))
    else:
        print(format_oneline(usage))


if __name__ == "__main__":
    main()
