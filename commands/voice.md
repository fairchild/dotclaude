---
description: Start turn-based voice mode using a background listener agent plus TTS responses
---

Start voice mode using the `voice-listener` background agent and the `voice` skill.

## Workflow

1. Choose STT provider:
- `local` -> `stt_local.py`
- `elevenlabs` -> `stt_elevenlabs.py`

2. Create or reuse a team named `voice`.
3. Launch background task with agent `voice-listener`.
4. Listener captures speech and sends transcript turns prefixed with:
```
[voice-input]
```
5. For each received voice turn:
- Process it as user input
- Generate assistant response
- Speak response with TTS:
```bash
# Local playback
uv run ~/.claude/skills/voice/scripts/tts_local.py --text "<assistant response>"

# Cloud playback
uv run ~/.claude/skills/voice/scripts/tts_elevenlabs.py --text "<assistant response>"
```
- Send `keep-listening` back to the listener agent

## Notes

- This is turn-based voice mode, not full duplex.
- Each listen cycle is a separate agent turn.
- If a provider check fails, run the script `--check` command and resolve setup before retrying.
