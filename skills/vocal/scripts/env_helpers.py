"""Shared environment helpers for vocal skill scripts."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path


def load_dotenv(path: Path | None = None) -> None:
    env_path = path or (Path.home() / ".env")
    if not env_path.exists():
        return

    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        key = key.strip()
        if not key or key in os.environ:
            continue
        value = value.strip().strip('"').strip("'")
        os.environ[key] = value


def audio_context_prefix() -> list[str]:
    """Outside the Aqua session (tmux servers started from hooks/daemons), say
    and afplay exit 0 without reaching the speakers and say -o renders
    near-empty files; launchctl asuser crosses back into the GUI session."""
    try:
        r = subprocess.run(["launchctl", "managername"], capture_output=True, text=True, timeout=5)
        if r.returncode == 0 and r.stdout.strip() != "Aqua":
            return ["launchctl", "asuser", str(os.getuid())]
    except Exception:
        pass
    return []


def get_elevenlabs_api_key() -> str | None:
    load_dotenv()
    return os.environ.get("ELEVENLABS_API_KEY") or os.environ.get("ELEVEN_LABS_API_KEY")
