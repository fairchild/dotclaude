---
name: voice
description: >-
  Speak text aloud (TTS) and transcribe speech (STT). Supports local
  (macOS say, mlx-whisper) and cloud (ElevenLabs) providers. Use when
  user asks to speak, read aloud, listen, transcribe, or use voice.
license: Apache-2.0
metadata:
  status: experimental
---

# Voice

Speak text aloud and transcribe speech with local and cloud providers.

## Usage

### `/voice` command loop
```bash
/voice What should we work on next?
```

Optional inline config:
- `/voice stt=local tts=local duration=8 What should we work on next?`
- `/voice stt=elevenlabs tts=elevenlabs duration=10 Ready when you are.`

### Local TTS (macOS `say`)
```bash
uv run ~/.claude/skills/voice/scripts/tts_local.py --text "Hello Michael"
```

Examples:
```bash
# Save audio to file
uv run ~/.claude/skills/voice/scripts/tts_local.py \
  --text "Build succeeded" \
  --voice Alex \
  --rate 200 \
  --output /tmp/build.aiff

# List macOS voices
uv run ~/.claude/skills/voice/scripts/tts_local.py --list-voices
```

### Local STT (mlx-whisper, Apple Silicon)
```bash
# Record microphone for 5 seconds and transcribe
uv run ~/.claude/skills/voice/scripts/stt_local.py --duration 5

# Transcribe an existing file
uv run ~/.claude/skills/voice/scripts/stt_local.py --file ./meeting.wav

# List input devices
uv run ~/.claude/skills/voice/scripts/stt_local.py --list-devices

# Use a specific device
uv run ~/.claude/skills/voice/scripts/stt_local.py --duration 5 --device 1
```

### ElevenLabs TTS (cloud)
```bash
uv run ~/.claude/skills/voice/scripts/tts_elevenlabs.py \
  --text "Hello Michael" \
  --voice George
```

Examples:
```bash
# Save and play the generated mp3
uv run ~/.claude/skills/voice/scripts/tts_elevenlabs.py \
  --text "Deployment complete" \
  --model eleven_turbo_v2_5 \
  --output /tmp/deploy.mp3 \
  --play
```

### ElevenLabs STT (Scribe v2)
```bash
# Record microphone for 5 seconds and transcribe
uv run ~/.claude/skills/voice/scripts/stt_elevenlabs.py --duration 5

# Transcribe an existing audio file
uv run ~/.claude/skills/voice/scripts/stt_elevenlabs.py --file ./call.wav

# List input devices
uv run ~/.claude/skills/voice/scripts/stt_elevenlabs.py --list-devices

# Use a specific device
uv run ~/.claude/skills/voice/scripts/stt_elevenlabs.py --duration 5 --device 1
```

### Provider checks
```bash
uv run ~/.claude/skills/voice/scripts/tts_local.py --check
uv run ~/.claude/skills/voice/scripts/stt_local.py --check
uv run ~/.claude/skills/voice/scripts/tts_elevenlabs.py --check
uv run ~/.claude/skills/voice/scripts/stt_elevenlabs.py --check
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
uv run ~/.claude/skills/voice/tests/test_voice.py
```

Run file-based ask/listen/respond loop (no microphone required):

```bash
uv run ~/.claude/skills/voice/tests/test_voice_loop.py
```

Include cloud loop validation (requires ElevenLabs key):

```bash
uv run ~/.claude/skills/voice/tests/test_voice_loop.py --cloud
```

Fixture files for loop validation:
- `tests/fixtures/loop_prompt.txt`
- `tests/fixtures/expected_keyword.txt`
