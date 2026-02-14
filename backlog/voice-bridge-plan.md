---
status: pending
category: plan
pr: null
branch: null
score: null
retro_summary: null
completed: null
---

# Voice Bridge: SDK-Driven Voice Conversation Loop

## Problem Statement

The voice skill (`~/.claude/skills/voice/`) provides TTS and STT as tools Claude can call on demand, but the interaction is always user-initiated — you type "listen to me" or "speak this." There's no way to have a continuous voice conversation where Claude listens, responds verbally, and keeps listening.

Claude Code's architecture is session-centric with no native mechanism for external processes to inject messages into a running interactive session. The Voice Bridge solves this by running Claude in **programmatic mode** (`--print --input-format stream-json --output-format stream-json`) wrapped by a standalone process that manages the mic/speaker loop.

## Prerequisites

- Voice skill Phase 1 complete (`~/.claude/skills/voice/scripts/tts_*.py`, `stt_*.py` all working)
- `ELEVENLABS_API_KEY` configured (for cloud providers) or local providers validated

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Runtime | Python with uv | Consistent with existing voice scripts, async support via asyncio |
| Claude interface | `claude` CLI stream-json mode | No SDK dependency, uses installed CLI, bidirectional streaming |
| STT provider | ElevenLabs Scribe v2 WebSocket | ~150ms latency, streaming, handles silence detection |
| TTS provider | ElevenLabs Flash v2.5 | ~75ms latency, streaming chunks for fast playback start |
| Local fallback | mlx-whisper + macOS `say` | Zero-cost dev/testing without API key |
| Audio I/O | `sounddevice` (PortAudio) | Cross-platform, low-latency, already used in stt scripts |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    voice_bridge.py                       │
│                                                         │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │  Mic      │───▶│  STT Engine  │───▶│  Transcript  │  │
│  │  Capture  │    │  (stream)    │    │  Buffer      │  │
│  └──────────┘    └──────────────┘    └──────┬───────┘  │
│                                             │          │
│                                             ▼          │
│                                    ┌────────────────┐  │
│                                    │  Claude CLI     │  │
│                                    │  (stream-json)  │  │
│                                    │  stdin ◀─ JSON  │  │
│                                    │  stdout ─▶ JSON │  │
│                                    └────────┬───────┘  │
│                                             │          │
│                                             ▼          │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │  Speaker  │◀───│  TTS Engine  │◀───│  Response    │  │
│  │  Playback │    │  (stream)    │    │  Text        │  │
│  └──────────┘    └──────────────┘    └──────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Stream-JSON Protocol

Claude CLI supports bidirectional streaming JSON (discovered via `claude --help`):

```bash
# Launch Claude in programmatic streaming mode
claude --print \
  --input-format stream-json \
  --output-format stream-json \
  --include-partial-messages \
  --resume SESSION_ID  # optional: continue conversation
```

**Input** (write JSON lines to stdin):
```json
{"type": "user_message", "content": "Hello, how are you?"}
```

**Output** (read JSON lines from stdout):
```json
{"type": "assistant_message", "content": "I'm doing well!", "partial": false}
```

Key flags:
- `--replay-user-messages` — echoes user messages back on stdout for acknowledgment
- `--include-partial-messages` — stream partial response chunks as they arrive
- `-r SESSION_ID` — resume existing conversation for continuity
- `--allowedTools` — restrict which tools Claude can use in this mode

### Voice Activity Detection (VAD)

For knowing when the user starts/stops speaking:

- **ElevenLabs STT WebSocket** handles VAD server-side — sends transcript when silence detected
- **Local fallback**: use `webrtcvad` (pip) or energy-based detection with `sounddevice`
- Key parameters: silence threshold (~1.5s), min speech duration (~0.5s)

### Conversation Flow

```python
async def voice_loop():
    # 1. Start Claude CLI subprocess
    claude = await asyncio.create_subprocess_exec(
        "claude", "--print",
        "--input-format", "stream-json",
        "--output-format", "stream-json",
        "--include-partial-messages",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
    )

    while True:
        # 2. Listen — blocks until speech detected + silence
        transcript = await stt_engine.listen()
        if not transcript.strip():
            continue

        # 3. Send to Claude
        msg = json.dumps({"type": "user_message", "content": transcript})
        claude.stdin.write(f"{msg}\n".encode())
        await claude.stdin.drain()

        # 4. Stream response — collect text, start TTS as chunks arrive
        response_text = ""
        async for chunk in read_stream(claude.stdout):
            if chunk.get("partial"):
                # Could start TTS on sentence boundaries for lower latency
                pass
            else:
                response_text = chunk["content"]

        # 5. Speak response
        await tts_engine.speak(response_text)

        # 6. Loop back to listening
```

### Latency Budget

| Stage | ElevenLabs | Local | Notes |
|-------|-----------|-------|-------|
| Mic → STT | ~150ms | ~500-2000ms | Scribe v2 vs mlx-whisper |
| STT → Claude stdin | <5ms | <5ms | Local pipe |
| Claude thinking | 500-3000ms | 500-3000ms | Depends on complexity |
| Claude → TTS | <5ms | <5ms | Local pipe |
| TTS → Speaker | ~75ms | <50ms | Flash v2.5 vs macOS `say` |
| **Total** | **~750ms-3.2s** | **~1-5s** | End-to-end |

Optimization: start TTS on sentence boundaries while Claude is still generating (reduces perceived latency by ~30-50%).

## Implementation Phases

### Phase 1: Basic Voice Loop

**Files to create:**
- `~/.claude/skills/voice/scripts/voice_bridge.py` — main bridge process
- `~/.claude/skills/voice/scripts/engines.py` — STT/TTS engine abstractions (or inline)

**Implementation:**
```python
#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["sounddevice", "numpy", "elevenlabs", "httpx"]
# ///
```

CLI interface:
- `--provider elevenlabs|local` — which STT/TTS engines to use
- `--session SESSION_ID` — resume a Claude conversation
- `--system "You are a helpful voice assistant"` — system prompt
- `--voice George` — TTS voice selection
- `--check` — verify all components work

**Acceptance criteria:**
- [ ] Speaks a greeting on startup
- [ ] Listens to mic, detects speech, transcribes
- [ ] Sends transcript to Claude via stream-json
- [ ] Receives response, speaks it aloud
- [ ] Loops back to listening automatically
- [ ] Ctrl+C gracefully shuts down

### Phase 2: Streaming & Sentence-Level TTS

**Enhancement:** Don't wait for full Claude response — start speaking as sentences complete.

- Buffer Claude's streaming output
- Detect sentence boundaries (`.`, `!`, `?` followed by space/newline)
- Fire off TTS for each sentence independently
- Queue audio playback so sentences play in order

**Acceptance criteria:**
- [ ] First sentence starts playing before full response is generated
- [ ] Perceived latency reduced by 30%+

### Phase 3: Session Continuity & Context

**Enhancement:** Maintain conversation history across voice bridge restarts.

- Use `--resume SESSION_ID` to continue conversations
- Store session ID in a state file (`~/.claude/voice-sessions/`)
- `/voice continue` resumes last conversation
- `/voice new` starts fresh

**Acceptance criteria:**
- [ ] `voice_bridge.py --session last` resumes previous conversation
- [ ] Conversation context preserved across bridge restarts

### Phase 4: Interrupt Handling (barge-in)

**Enhancement:** Allow user to interrupt Claude mid-speech.

- While TTS is playing, keep mic partially active
- If speech energy detected during playback, stop TTS immediately
- Send new transcript to Claude (with context that user interrupted)

**Acceptance criteria:**
- [ ] User can say "stop" or start talking to interrupt playback
- [ ] Claude receives context about the interruption

## Alternative: Agent SDK Approach

Instead of CLI stream-json, could use the Agent SDK directly:

```python
# pip install claude-agent-sdk
from claude_agent_sdk import ClaudeAgent, ClaudeAgentOptions

agent = ClaudeAgent(options=ClaudeAgentOptions(
    model="claude-sonnet-4-5-20250929",
    allowed_tools=["Bash"],  # for voice scripts
))

async for message in agent.query(transcript):
    # Process streaming response
    pass
```

**Tradeoffs vs CLI stream-json:**

| Aspect | CLI stream-json | Agent SDK |
|--------|----------------|-----------|
| Dependencies | Just `claude` CLI | `claude-agent-sdk` package |
| Auth | Uses existing CLI auth | Needs API key directly |
| Tools | Full Claude Code toolset | Configurable subset |
| Session mgmt | Built-in resume | Manual conversation history |
| Overhead | Subprocess + pipes | Direct API calls |
| Flexibility | Limited to CLI features | Full programmatic control |

**Recommendation**: Start with CLI stream-json (simpler, uses existing auth), evaluate SDK if we need more control.

## Verification Commands

```bash
# Check all dependencies
uv run ~/.claude/skills/voice/scripts/voice_bridge.py --check

# Start voice bridge with local providers (free)
uv run ~/.claude/skills/voice/scripts/voice_bridge.py --provider local

# Start with ElevenLabs (needs API key)
uv run ~/.claude/skills/voice/scripts/voice_bridge.py --provider elevenlabs --voice George

# Resume previous session
uv run ~/.claude/skills/voice/scripts/voice_bridge.py --session last

# Test stream-json protocol manually
echo '{"type":"user_message","content":"Say hello"}' | \
  claude --print --input-format stream-json --output-format stream-json
```

## Rollback Plan

The voice bridge is a standalone script — no changes to existing skill scripts or Claude Code config. To remove: delete `voice_bridge.py`. No other files affected.

## References

### Research (from this session)

- **Claude CLI stream-json**: `claude --help` shows `--input-format stream-json`, `--output-format stream-json`, `--replay-user-messages`, `--include-partial-messages` flags
- **Claude Code cannot be interrupted by background processes**: Hooks are reactive-only, MCP servers are passive, agents must be invoked. Only Team+SendMessage delivers messages when idle. See plan at `~/.claude/plans/fluttering-marinating-papert.md`
- **ElevenLabs Flash v2.5**: ~75ms TTS latency, WebSocket streaming, 32 languages
- **ElevenLabs Scribe v2**: ~150ms STT latency, 90+ languages, handles VAD server-side
- **Agent SDK**: `@anthropic-ai/claude-agent-sdk` (TS) / `claude-agent-sdk` (Python) for programmatic control

### External Documentation

- ElevenLabs TTS API: https://elevenlabs.io/docs/overview/capabilities/text-to-speech
- ElevenLabs STT/Scribe: https://elevenlabs.io/realtime-speech-to-text
- ElevenLabs WebSocket streaming: https://elevenlabs.io/docs/developers/websockets
- ElevenLabs latency optimization: https://elevenlabs.io/docs/developers/best-practices/latency-optimization
- ElevenLabs skills repo: https://github.com/elevenlabs/skills
- ElevenLabs JS SDK: https://github.com/elevenlabs/elevenlabs-js
- Claude Code CLI reference: https://code.claude.com/docs/en/cli-reference
- Claude Agent SDK: https://platform.claude.com/docs/en/agent-sdk/overview

### Codebase References

- Voice skill (prerequisite): `~/.claude/skills/voice/`
- Image-gen pattern reference: `~/.claude/skills/image-gen/`
- Research plan: `~/.claude/plans/fluttering-marinating-papert.md`
- Hooks reference: `~/.claude/skills/dotclaude-config/references/settings-json.md`
- Extensibility docs: `~/.claude/skills/dotclaude-config/references/extensibility.md`
