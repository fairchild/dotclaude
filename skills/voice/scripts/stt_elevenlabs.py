#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["elevenlabs", "sounddevice", "numpy"]
# ///
"""Transcribe speech with ElevenLabs Scribe."""

import argparse
import json
import os
import sys
import tempfile
import urllib.error
import urllib.request
import wave
from pathlib import Path
from typing import Any

import numpy as np
import sounddevice as sd
from elevenlabs.client import ElevenLabs

API_BASE = "https://api.elevenlabs.io/v1"


def error_exit(msg: str, hint: str | None = None) -> None:
    print(f"Error: {msg}", file=sys.stderr)
    if hint:
        print(f"\n{hint}", file=sys.stderr)
    sys.exit(1)


def get_api_key() -> str:
    api_key = os.environ.get("ELEVENLABS_API_KEY") or os.environ.get("ELEVEN_LABS_API_KEY")
    if not api_key:
        error_exit(
            "ELEVENLABS_API_KEY (or ELEVEN_LABS_API_KEY) environment variable not set",
            "To fix, either:\n"
            "  1. Add to ~/.env:      ELEVENLABS_API_KEY=your-key-here\n"
            "  2. Or export in shell: export ELEVENLABS_API_KEY=your-key-here\n"
            "  3. Or legacy alias:    export ELEVEN_LABS_API_KEY=your-key-here\n\n"
            "Get your API key at: https://elevenlabs.io/app/settings/api-keys",
        )
    return api_key


def check_api_key(api_key: str) -> None:
    request = urllib.request.Request(
        f"{API_BASE}/user",
        headers={"xi-api-key": api_key, "accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            if response.status != 200:
                error_exit(f"ElevenLabs API check failed with status {response.status}")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        if exc.code in {401, 403}:
            error_exit(
                "ELEVENLABS_API_KEY is invalid or unauthorized",
                "Get a valid key at: https://elevenlabs.io/app/settings/api-keys",
            )
        error_exit(f"ElevenLabs API check failed ({exc.code}): {detail}")
    except urllib.error.URLError as exc:
        error_exit(f"Cannot connect to ElevenLabs API: {exc}")


def ensure_microphone() -> None:
    try:
        sd.check_input_settings(samplerate=16000, channels=1)
    except Exception as exc:
        error_exit(
            f"Microphone input check failed: {exc}",
            "Grant microphone access in System Settings -> Privacy & Security -> Microphone.",
        )


def write_wav(path: Path, audio: np.ndarray, sample_rate: int) -> None:
    clipped = np.clip(audio, -1.0, 1.0)
    pcm = (clipped * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm.tobytes())


def record_audio(duration: float, sample_rate: int = 16000) -> Path:
    if duration <= 0:
        error_exit("--duration must be greater than 0")

    ensure_microphone()
    frames = int(duration * sample_rate)
    try:
        audio = sd.rec(frames, samplerate=sample_rate, channels=1, dtype="float32")
        sd.wait()
    except Exception as exc:
        error_exit(
            f"Unable to access microphone: {exc}",
            "Grant microphone access in System Settings -> Privacy & Security -> Microphone.",
        )

    mono = np.squeeze(audio)
    temp = tempfile.NamedTemporaryFile(prefix="voice-stt-elevenlabs-", suffix=".wav", delete=False)
    temp_path = Path(temp.name)
    temp.close()
    write_wav(temp_path, mono, sample_rate)
    return temp_path


def extract_text(result: Any) -> str:
    if hasattr(result, "text"):
        return str(getattr(result, "text", "")).strip()
    if isinstance(result, dict):
        return str(result.get("text", "")).strip()
    try:
        as_dict = json.loads(str(result))
        if isinstance(as_dict, dict):
            return str(as_dict.get("text", "")).strip()
    except Exception:
        pass
    return str(result).strip()


def transcribe(audio_path: Path, model: str, api_key: str) -> str:
    client = ElevenLabs(api_key=api_key)

    try:
        with audio_path.open("rb") as f:
            result = client.speech_to_text.convert(file=f, model_id=model)
    except Exception as exc:
        error_exit(
            f"ElevenLabs transcription failed: {exc}",
            "Check audio format, API key validity, and network connectivity.",
        )

    return extract_text(result)


def check_config() -> None:
    api_key = get_api_key()
    check_api_key(api_key)
    ensure_microphone()
    print("OK: ElevenLabs STT configuration is valid")


def main() -> None:
    parser = argparse.ArgumentParser(description="Transcribe speech with ElevenLabs Scribe")
    parser.add_argument("--duration", "-d", type=float, help="Record from microphone for N seconds")
    parser.add_argument("--file", "-f", type=Path, help="Transcribe existing audio file")
    parser.add_argument(
        "--model",
        default="scribe_v2",
        help="Model ID (default: scribe_v2)",
    )
    parser.add_argument("--check", action="store_true", help="Validate API key and microphone access")
    args = parser.parse_args()

    if args.check:
        check_config()
        return

    if bool(args.duration is not None) == bool(args.file is not None):
        parser.error("Use exactly one of --duration or --file")

    api_key = get_api_key()

    temp_path: Path | None = None
    audio_path: Path
    if args.file is not None:
        audio_path = args.file.expanduser().resolve()
        if not audio_path.exists():
            error_exit(f"Audio file does not exist: {audio_path}")
    else:
        temp_path = record_audio(args.duration if args.duration is not None else 10.0)
        audio_path = temp_path

    try:
        text = transcribe(audio_path, args.model, api_key)
        print(text)
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
