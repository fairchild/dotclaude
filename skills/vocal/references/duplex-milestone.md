# Milestone: the vocal loop becomes conversational

Standing reference for the six-task arc that takes `/vocal` from fixed-window ping-pong to
something you can talk over. Supersedes the Tier 3 `voice_bridge.py` proposal in
`architecture.md`.

**Done when:** you speak without a timer running out on you, hear a reply, and can cut in over it
on the built-in speakers without the agent hearing itself.

## Why it isn't duplex — two reasons, different fixes

The harness delivers messages at turn boundaries, so an agent blocked inside a 15-second `sd.rec`
cannot be reached. `architecture.md` already tested this and found Claude Code *"session-centric
and event-driven, not event-push."* **Not fixable within the agent model.**

Separately, the scripts run a fixed wall-clock window (`sd.rec(); sd.wait()`) and playback has no
kill handle (`subprocess.run(["say", ...])`). **Fixable today** — that's this milestone.

Two concurrent agents don't solve it. They genuinely run at once, so the mic really is open while
audio plays — but talk over the speaker and the listener's `SendMessage` sits in the speaker's
queue until `say` returns; the interruption lands after the sentence it meant to interrupt.
Concurrency across agents buys simultaneity, not interruptibility. Worse for barge-in
specifically: the frames that detect the interruption and the frames carrying the user's first
word are the *same audio*. One process already has them in a pre-roll buffer; two processes either
lose the onset or capture it twice.

**The whole milestone is one move:** push the fast loop below the agent layer. Agents decide what
to say — their unit of reaction is an API call. A script's unit of reaction is a 20 ms audio
callback. Endpointing, echo cancellation, and barge-in all belong there.

## Decision: WebRTC AEC3, not Apple VPIO

| | **WebRTC AEC3** (chosen) | **Apple VPIO** (rejected) |
|---|---|---|
| Mechanism | `livekit.rtc.apm.AudioProcessingModule`, pure FFI — no room, token, or network | `AVAudioEngine.setVoiceProcessingEnabled(true)` via pyobjc |
| Needs reference PCM | Yes — must own playback | No — cancels against the output *device*, so subprocess `say`/`afplay` is covered |
| Measured | ERLE ~32 dB, echo bleed 6 → 0 lines | ~70–75% bleed reduction; 25–33% residual |
| Ducks other system audio | No | **Yes, unavoidably, device-globally** |
| Coexists with `sounddevice` capture | Yes | **No** — attenuates a concurrent stream on the same mic by ~31 dB |

The near-miss worth recording: VPIO's reference is the **output device, not its own render bus**,
so it cancels `say` in a subprocess with no reference plumbing at all — about 30 lines total. It
loses on two things that only show up in use. The system-wide ducking can't be turned off (macOS
14+ `.min` ducking level is still audible), and enabling it blocks the existing `sounddevice`
capture path. `dave-schmidt-dev/scarecrow` measured both and reached the same conclusion.

Alignment turned out not to be the worry it looked like. AEC3 runs its own delay estimator across
roughly a 600 ms search window, so the reference only needs to be within a frame.
`TrelisResearch/voice-loop` never calls `set_stream_delay_ms`; LiveKit's own console code wraps it
in `try/except: pass`. What actually kills AEC is **clock drift, not offset** — an argument for
staying on built-in mic + built-in speakers and avoiding Bluetooth, not for building anything.

**Not building:** loopback drivers (BlackHole/Loopback/ScreenCaptureKit each add a second clock
domain to recover a reference we already have in memory, and ScreenCaptureKit wants a Screen
Recording prompt); speexdsp (no delay estimator, no drift tolerance — its manual says separate
capture/playback cards *"will not work"*); hand-rolled NLMS (near-zero ERLE during double-talk,
which is exactly the barge-in moment); pitch or spectral separation of synthetic vs. human voice
(no credible prior art, and neural TTS is optimised against it); speaker embeddings as a barge-in
gate (real prior art, but as auxiliary input to a neural AEC, never instead of a reference — and
tens of ms per window is hopeless at a 32 ms VAD cadence).

## The arc

```
V1 endpointing ──────────────┐
                             ├──► V3 converse.py ──┐
V2 own the audio path ───┬───┘                     ├──► V5 barge-in ──► V6 wire-up
                         └───► V4 AEC3 ────────────┘
```

| | Task | Depends on | Size | Ships alone? |
|---|---|---|---|---|
| **V1** | VAD endpointing | — | ~170 lines, 1 new file | Yes — biggest felt win |
| **V2** | Own the audio path | — | ~80 lines | Yes — gives a kill handle |
| **V3** | `converse.py`, half-duplex | V1, V2 | ~120 lines | Yes |
| **V4** | AEC3 via `livekit` | V2 | ~60 lines | No — needs V3 to be useful |
| **V5** | Barge-in | V3, V4 | ~80 lines | Yes — the milestone |
| **V6** | Wire-up, retire Tier 2 | V5 | docs + small edits | Yes |

For a dynamic workflow: fan out V1 ∥ V2, join, fan out V3 ∥ V4, join, then V5 → V6.

Each task gets a spec beside this file as its dependencies land — V1 is
[duplex-v1-endpointing.md](duplex-v1-endpointing.md). They live here rather than in
`backlog/todo/` on purpose: `backlog take` with no slug auto-picks across the whole queue by
priority, so an entry here would jump ahead of the `backlog-roadmap-dogfood` and
`memory-loop-quality` arcs that ROADMAP puts first. This is `prototype-surface` work, driven
deliberately, not unowned work waiting to be discovered. Point a session at this directory.

### V2 — own the audio path

Subprocess playback is the root cause of both remaining problems: no kill handle, no reference
PCM. Render with `say -o /tmp/x.wav --data-format=LEI16@16000`, load, play through
`sd.OutputStream`, and keep a monotonic reference buffer of every sample queued.

**Don't set `sd.default.blocksize` globally** — a large blocksize on the TTS output stream
introduces mic-to-reference delay that misaligns AEC in a way that looks like "AEC just doesn't
work." Set `sd.default.latency = 'high'`, leave blocksize alone.

Headphone detection: CoreAudio `kAudioDevicePropertyDataSource` returns `'ispk'` for internal
speakers vs `'hdpn'` for headphones. Lift the property query rather than depending on the ancient
`mac-headphones` package. Headphones mean AEC is unnecessary.

`tts_elevenlabs.py:201` already synthesises-without-playing when `--output` is set and `--play`
isn't, so the cloud path gives us the file and we play it ourselves.

### V3 — `converse.py`

One agent turn = one call, collapsing the speak→listen round-trip that currently buys nothing.
Half-duplex to start: mic opens only after playback ends, plus ~200 ms for room reverb. **This is
the correct default, not a compromise** — V5 softens the gate rather than removing it.

Resolves the one real latency risk: **import `mlx_whisper` during playback.** Doing that import
with an input stream open is subtly dangerous — the audio callback is a Python callback and takes
the GIL, so a long `dlopen` inside MLX can drop frames exactly as the user starts speaking. During
playback no stream is open, so the ~1.0 s hides at zero risk.

Kill handle is a local variable: `Popen(start_new_session=True)` → `os.killpg` SIGTERM → 250 ms →
SIGKILL.

### V4 — AEC3

`livekit` for the APM only — a pure FFI handle, no room, no token, no network. Port the shape from
`voice-loop`; these are its hard-won invariants, worth copying rather than rediscovering:

- **One APM for the whole session.** Recreating it discards the learned room impulse response.
- 10 ms frames exactly — 160 samples at 16 kHz. The FFI aborts the process on anything else.
- **Never let the reference buffer skip.** Pad silence during inter-sentence gaps so the mic
  sample counter stays aligned. Alignment drift is silent and fatal.
- 150 ms blanking after each sentence — during the reverb tail, a zero reference makes AEC3 pass
  residual echo through as "speech."
- 0.5 s inhibit at *every* sentence start, not just the first.
- Skip `set_stream_delay_ms`; the internal estimator handles it.

Run the V1 VAD on the cleaned signal, not the raw mic.

### V5 — barge-in

Speech during playback kills playback, gated on N consecutive VAD-positive chunks (voice-loop uses
5). The triggering frames are already in V1's pre-roll deque, so the interrupting word survives
into the transcript — the whole reason V3 put listen and speak in one process. Full duplex on
headphones needs no AEC; built-in speakers get AEC3 plus conservative thresholds.

### V6 — wire-up

`vocal-listener.md` moves to `--vad --max-duration`, `duration_seconds` → `max_seconds`. `SKILL.md`
Tier 2 points at `converse.py`; `vocal-listener` becomes a thin wrapper or goes away. Mark Tier 3
resolved in `architecture.md` and note in `backlog/todo/voxcode-swift-plan.md` that its barge-in
section is answered.

## Latency

Measured on this machine, for a 3-second utterance:

| | now (`--duration 8`) | after V1 | after V3 |
|---|---|---|---|
| total | 9.75 s (12.6 s cold cache) | 5.95 s | ~4.9 s |

The structural change matters more than the number: overhead stops scaling with how *briefly* you
spoke. A one-second "yes" goes from 9.4 s to ~3.0 s.

Fixed per-invocation cost after V3 is ~0.40 s (`uv` spawn + `sounddevice` import), since the 1.0 s
mlx import hides under playback. That sits below the threshold where a persistent worker would pay
for its lifecycle, stale-socket story, and mic-ownership story — **so no daemon.** The trigger that
would reopen it is `whisper-large-v3-turbo`, where model load (~2–3 s) and transcribe (1–2 s) stop
hiding under an utterance.

## Scope

Two designs already pointed at this and neither was built: Tier 3 `voice_bridge.py` here in
`architecture.md`, whose referenced `backlog/voice-bridge-plan.md` does not exist; and
`backlog/todo/voxcode-swift-plan.md`, 727 lines covering PTT, wake word, and barge-in via an ACP
client. The failure mode is becoming the third.

This arc **supersedes Tier 3** — V1–V5 deliver what `voice_bridge.py` was for, without leaving the
agent model. Voxcode stays a separate and later question: a native menu-bar app is a product
decision, not a fix to this loop.

No new gates, CI, or checking apparatus. Every task's evidence is the existing test scripts plus
listening to it.

## Sources

- [`TrelisResearch/voice-loop`](https://github.com/TrelisResearch/voice-loop) — local voice agent
  on Apple Silicon with working barge-in; the AEC3 integration to copy
- [`dave-schmidt-dev/scarecrow`](https://github.com/dave-schmidt-dev/scarecrow) `benchmarks/aec_spike/`
  — measured VPIO vs AEC3 with kill criteria
- [`livekit/python-sdks` `apm.py`](https://github.com/livekit/python-sdks/blob/main/livekit-rtc/livekit/rtc/apm.py)
  — the APM is a pure FFI handle
- [Chromium `audio_low_latency_input.cc`](https://github.com/chromium/chromium/blob/main/media/audio/apple/audio_low_latency_input.cc),
  [Mumble `CoreAudio.mm`](https://github.com/mumble-voip/mumble/blob/master/src/mumble/CoreAudio.mm)
  — evidence that VPIO's reference is the output device
- [How WebRTC AEC3 Works](https://switchboard.audio/hub/how-webrtc-aec3-works/)
