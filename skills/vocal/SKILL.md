---
name: vocal
description: Speak text aloud (TTS) and transcribe speech (STT). Supports local (macOS say, mlx-whisper) and cloud (ElevenLabs) providers. Use when user asks to speak, read aloud, listen, transcribe, or use vocal.
license: Apache-2.0
metadata:
  status: experimental
  experimental_reason: "Voice workflows depend on local audio devices and optional ElevenLabs credentials, so reliability is environment-sensitive."
---

# Vocal

Speak text aloud and transcribe speech with local and cloud providers.

## Usage

### `/vocal` command loop
```bash
/vocal What should we work on next?
```

Optional inline config:
- `/vocal stt=local tts=local duration=8 What should we work on next?`
- `/vocal stt=elevenlabs tts=elevenlabs duration=10 Ready when you are.`

### Web tuning console
```bash
uv run --script ~/.claude/skills/vocal/scripts/web_console.py
```

Open http://127.0.0.1:8765 to tune the skill from a local browser.

The console supports:
- TTS sample playback for local `say` and ElevenLabs
- Local and ElevenLabs voice listing
- Browser microphone recording and audio-file transcription
- Provider checks from the same scripts used by the skill
- Saved local defaults in `skills/vocal/data/preferences.json`

Options:
```bash
# Choose a port
uv run --script ~/.claude/skills/vocal/scripts/web_console.py --port 8799

# Use a private preference directory outside the skill checkout
VOCAL_DATA_DIR=~/Library/Application\ Support/vocal-skill \
  uv run --script ~/.claude/skills/vocal/scripts/web_console.py
```

### Local TTS (macOS `say`)
```bash
uv run --script ~/.claude/skills/vocal/scripts/tts_local.py --text "Hello Michael"
```

Examples:
```bash
# Save audio to file
uv run --script ~/.claude/skills/vocal/scripts/tts_local.py \
  --text "Build succeeded" \
  --voice Alex \
  --rate 200 \
  --output /tmp/build.aiff

# List macOS voices
uv run --script ~/.claude/skills/vocal/scripts/tts_local.py --list-voices
```

### Local STT (mlx-whisper, Apple Silicon)
```bash
# Record microphone for 5 seconds and transcribe
uv run --script ~/.claude/skills/vocal/scripts/stt_local.py --duration 5

# Transcribe an existing file
uv run --script ~/.claude/skills/vocal/scripts/stt_local.py --file ./meeting.wav

# List input devices
uv run --script ~/.claude/skills/vocal/scripts/stt_local.py --list-devices

# Use a specific device
uv run --script ~/.claude/skills/vocal/scripts/stt_local.py --duration 5 --device 1
```

### ElevenLabs TTS (cloud)
```bash
uv run --script ~/.claude/skills/vocal/scripts/tts_elevenlabs.py \
  --text "Hello Michael" \
  --voice George
```

Examples:
```bash
# Save and play the generated mp3
uv run --script ~/.claude/skills/vocal/scripts/tts_elevenlabs.py \
  --text "Deployment complete" \
  --model eleven_turbo_v2_5 \
  --output /tmp/deploy.mp3 \
  --play
```

### ElevenLabs STT (Scribe v2)
```bash
# Record microphone for 5 seconds and transcribe
uv run --script ~/.claude/skills/vocal/scripts/stt_elevenlabs.py --duration 5

# Transcribe an existing audio file
uv run --script ~/.claude/skills/vocal/scripts/stt_elevenlabs.py --file ./call.wav

# List input devices
uv run --script ~/.claude/skills/vocal/scripts/stt_elevenlabs.py --list-devices

# Use a specific device
uv run --script ~/.claude/skills/vocal/scripts/stt_elevenlabs.py --duration 5 --device 1
```

### Provider checks
```bash
uv run --script ~/.claude/skills/vocal/scripts/tts_local.py --check
uv run --script ~/.claude/skills/vocal/scripts/stt_local.py --check
uv run --script ~/.claude/skills/vocal/scripts/tts_elevenlabs.py --check
uv run --script ~/.claude/skills/vocal/scripts/stt_elevenlabs.py --check
```

## Provider Comparison

| Provider | Mode | Latency | Quality | Cost |
|----------|------|---------|---------|------|
| `tts_local.py` | Local | Low | Good | Free |
| `stt_local.py` | Local | Medium (first run downloads model) | Good | Free |
| `tts_elevenlabs.py` | Cloud | Very low with flash model | Very high | Paid API |
| `stt_elevenlabs.py` | Cloud | Low | Very high | Paid API |

## Environment Variables

| Variable | Required | Used by |
|----------|----------|---------|
| `ELEVENLABS_API_KEY` | Yes (cloud only) | `tts_elevenlabs.py`, `stt_elevenlabs.py` |
| `ELEVEN_LABS_API_KEY` | Accepted alias | `tts_elevenlabs.py`, `stt_elevenlabs.py` |

Set via `~/.env` or shell export.

Recommended local setup:

```bash
# Preferred name
ELEVENLABS_API_KEY=your-key-here

# Accepted legacy alias
ELEVEN_LABS_API_KEY=your-key-here
```

Put one of those lines in `~/.env`, then restart `web_console.py`.
The vocal scripts load `~/.env` automatically before checking the process environment.

## Troubleshooting

### Getting an ElevenLabs API key

1. Open https://elevenlabs.io/app/settings/api-keys
2. Create a key
3. Export it:

```bash
export ELEVENLABS_API_KEY=your-key-here
```

### macOS microphone permissions

If transcription fails with permission errors:

1. Open `System Settings -> Privacy & Security -> Microphone`
2. Allow Terminal (or your Claude host app)
3. Re-run the command

### Common issues

- `say: command not found`: install or restore macOS command line tools
- `mlx-whisper import error`: run command via `uv run` so dependencies install
- `API key invalid`: regenerate key and ensure no whitespace

## Self-Validation

Run fast provider checks:

```bash
uv run --script ~/.claude/skills/vocal/tests/test_voice.py
```

Run file-based ask/listen/respond loop (no microphone required):

```bash
uv run --script ~/.claude/skills/vocal/tests/test_voice_loop.py
```

Include cloud loop validation (requires ElevenLabs key):

```bash
uv run --script ~/.claude/skills/vocal/tests/test_voice_loop.py --cloud
```

Run web console helper tests:

```bash
uv run --script ~/.claude/skills/vocal/tests/test_web_console.py
```

Run browser validation for the web console:

```bash
# Starts an isolated console on a free port and validates desktop/mobile flows
uv run --script ~/.claude/skills/vocal/tests/test_web_console_playwright.py

# Validate a console you already have open
uv run --script ~/.claude/skills/vocal/tests/test_web_console_playwright.py \
  --url http://127.0.0.1:8765

# Include the ElevenLabs TTS UI path (uses API credits)
uv run --script ~/.claude/skills/vocal/tests/test_web_console_playwright.py \
  --url http://127.0.0.1:8765 \
  --cloud

# Watch the test in a real browser window
uv run --script ~/.claude/skills/vocal/tests/test_web_console_playwright.py \
  --url http://127.0.0.1:8765 \
  --headed \
  --slow-mo 100
```

Fixture files for loop validation:
- `tests/fixtures/loop_prompt.txt`
- `tests/fixtures/expected_keyword.txt`

## References

- **Architecture & research**: See [references/architecture.md](references/architecture.md) — three-tier design, ElevenLabs API details, Claude Code background communication research, CLI programmatic modes
- **Voice bridge backlog**: See `backlog/voice-bridge-plan.md` — standalone process for continuous voice conversation with self-eval loop
