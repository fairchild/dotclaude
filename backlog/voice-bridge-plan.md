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

**Required test-support flags** (for self-eval, see eval loop below):
- `--check` — validate all components, report per-component status, exit 0/1
- `--input-file FILE` — use audio file instead of mic (enables automated testing)
- `--single-shot` — process one utterance then exit (no loop)
- `--no-play` — print response text to stdout instead of TTS playback

**Acceptance criteria** (verified by self-eval Layers 1-5):
- [ ] `--check` passes (Layer 4) — all components report ok
- [ ] e2e test with `--input-file --single-shot --no-play` returns correct response (Layer 5)
- [ ] Interactive mode: listens → transcribes → sends to Claude → speaks response → loops (Layer 6, human)
- [ ] Ctrl+C gracefully shuts down (kills Claude subprocess, closes audio streams)

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

## Self-Eval Loop

The implementing agent should verify each layer **bottom-up** before moving to the next. Each step has a concrete command and expected output the agent can check programmatically. Do not move to the next step until the current one passes.

### Layer 1: stream-json protocol works

Verify Claude CLI accepts stream-json input and returns structured output.

```bash
# Send a simple message, capture output
OUTPUT=$(echo '{"type":"user_message","content":"Reply with exactly: VOICE_TEST_OK"}' | \
  claude --print --input-format stream-json --output-format stream-json 2>/dev/null)

# Verify we got JSON back containing the expected response
echo "$OUTPUT" | python3 -c "
import sys, json
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    msg = json.loads(line)
    if 'VOICE_TEST_OK' in msg.get('content', '') or 'VOICE_TEST_OK' in json.dumps(msg):
        print('PASS: stream-json round-trip works')
        sys.exit(0)
print('FAIL: did not find expected response')
sys.exit(1)
"
```

**Pass**: prints `PASS: stream-json round-trip works`, exit 0
**Fail**: the stream-json protocol format may have changed — read `claude --help` output and adjust message format

### Layer 2: mic capture produces valid audio

Verify the STT prerequisite scripts capture audio that can be read back.

```bash
# Record 2 seconds of silence to a file (non-interactive, no transcription)
uv run ~/.claude/skills/voice/scripts/stt_local.py --duration 2 --file /tmp/voice_bridge_test.wav 2>/dev/null

# Verify the file exists and has audio data (>1KB means real audio, not empty)
python3 -c "
import os, sys
f = '/tmp/voice_bridge_test.wav'
if not os.path.exists(f):
    print('FAIL: audio file not created'); sys.exit(1)
size = os.path.getsize(f)
if size < 1000:
    print(f'FAIL: audio file too small ({size} bytes)'); sys.exit(1)
print(f'PASS: audio capture works ({size} bytes)')
" && rm -f /tmp/voice_bridge_test.wav
```

**Pass**: file exists, >1KB
**Fail**: mic permissions issue — check System Settings > Privacy > Microphone

### Layer 3: TTS playback completes without error

Verify TTS scripts produce audio and `afplay` returns exit 0.

```bash
# Local TTS — should complete in <2 seconds
timeout 5 uv run ~/.claude/skills/voice/scripts/tts_local.py --text "test" --output /tmp/voice_bridge_tts.aiff 2>/dev/null
EXIT=$?
[ $EXIT -eq 0 ] && [ -f /tmp/voice_bridge_tts.aiff ] && echo "PASS: local TTS works" || echo "FAIL: local TTS exit=$EXIT"
rm -f /tmp/voice_bridge_tts.aiff

# Verify afplay works (macOS audio subsystem)
echo -n "." | say -o /tmp/voice_bridge_afplay.aiff 2>/dev/null
timeout 5 afplay /tmp/voice_bridge_afplay.aiff 2>/dev/null
[ $? -eq 0 ] && echo "PASS: afplay works" || echo "FAIL: afplay broken"
rm -f /tmp/voice_bridge_afplay.aiff
```

### Layer 4: voice_bridge.py --check passes

The bridge script itself should have a `--check` that validates all components:

```bash
uv run ~/.claude/skills/voice/scripts/voice_bridge.py --check
```

**Expected output** (one line per component):
```
stream-json: ok
mic-capture: ok
tts-local: ok
stt-local: ok
tts-elevenlabs: ok (or: skip — ELEVENLABS_API_KEY not set)
stt-elevenlabs: ok (or: skip — ELEVENLABS_API_KEY not set)
```

**Implementation requirement**: `--check` must run each of Layers 1-3 above internally and report per-component status. Exit 0 only if all non-skip components pass. This is the agent's single command to validate the full stack.

### Layer 5: end-to-end non-interactive test

Test the full pipeline without a real mic by feeding a pre-recorded audio file:

```bash
# Create a test audio file with macOS say
say -o /tmp/voice_bridge_e2e.aiff "What is two plus two"

# Run bridge in single-shot mode (process one utterance, then exit)
OUTPUT=$(uv run ~/.claude/skills/voice/scripts/voice_bridge.py \
  --provider local \
  --input-file /tmp/voice_bridge_e2e.aiff \
  --single-shot \
  --no-play 2>/dev/null)

# Verify Claude responded with something containing "four" or "4"
echo "$OUTPUT" | python3 -c "
import sys
text = sys.stdin.read().lower()
if 'four' in text or '4' in text:
    print('PASS: end-to-end pipeline works')
    sys.exit(0)
print(f'FAIL: unexpected response: {text[:200]}')
sys.exit(1)
"
rm -f /tmp/voice_bridge_e2e.aiff
```

**Implementation requirement**: The bridge must support `--input-file` (use audio file instead of mic), `--single-shot` (process one utterance then exit), and `--no-play` (print response text to stdout instead of speaking). These flags exist specifically for automated testing.

### Layer 6: interactive smoke test (human required)

Only after Layers 1-5 pass. This cannot be automated.

```bash
uv run ~/.claude/skills/voice/scripts/voice_bridge.py --provider local
# Say "Hello" into mic
# Expected: Claude responds verbally
# Ctrl+C to exit
```

### Eval Summary

| Layer | What | Automated? | Gate for |
|-------|------|-----------|----------|
| 1 | stream-json protocol | Yes | Everything |
| 2 | Mic capture | Yes | STT, e2e |
| 3 | TTS playback | Yes | Speaking |
| 4 | `--check` (all components) | Yes | Phase 1 complete |
| 5 | e2e with test audio file | Yes | Phase 1 merge |
| 6 | Interactive smoke test | No (human) | Phase 1 ship |

**The implementing agent must pass Layers 1-5 before claiming Phase 1 is complete.** Layer 6 requires the user.

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
