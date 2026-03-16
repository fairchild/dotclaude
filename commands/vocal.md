---
description: Run an automatic turn-based vocal loop (ask aloud, listen, respond, keep listening)
---

Run vocal mode with the `vocal` skill and `vocal-listener` background agent.

## Command behavior

1. Parse optional inline config from the command text:
- `stt=local|elevenlabs` (default: `local`)
- `tts=local|elevenlabs` (default: match `stt`)
- `duration=<seconds>` (default: `8`)
- Remaining text becomes the first spoken prompt.

2. Validate selected providers before starting:
```bash
# STT
uv run ~/.claude/skills/vocal/scripts/stt_local.py --check
uv run ~/.claude/skills/vocal/scripts/stt_elevenlabs.py --check

# TTS
uv run ~/.claude/skills/vocal/scripts/tts_local.py --check
uv run ~/.claude/skills/vocal/scripts/tts_elevenlabs.py --check
```
Run only the checks needed for selected providers.

3. Create or reuse a team named `vocal` and launch `vocal-listener` as a background task with config:
```text
stt_provider=<local|elevenlabs>
duration_seconds=<duration>
continue_token=keep-listening
stop_token=stop-listening
```

4. Speak the first prompt aloud (if provided). If none is provided, speak:
`Vocal mode active. I'm listening.`

5. For every listener message that starts with `[voice-input]`:
- Treat transcript as the user turn.
- Produce a concise assistant response.
- Speak the response with selected TTS provider.
- Send `keep-listening` to the listener agent.

6. Stop conditions:
- If transcript asks to stop (for example: "stop vocal mode", "goodbye", "exit vocal"), speak confirmation and send `stop-listening`.
- If listener reports `[voice-error]`, surface the error and pause vocal mode.

## Runtime Notes

- This is turn-based, not full-duplex realtime.
- Each listen cycle is a separate background agent turn.
- Keep spoken responses short unless user asks for detail.
