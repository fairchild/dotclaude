# V1 — stop recording when the speaker stops

First task of the arc in [duplex-milestone.md](duplex-milestone.md). Self-contained: everything
needed to pick this up cold is below.

## Problem

`skills/vocal/scripts/stt_local.py` records a fixed wall-clock window and nothing else:

```python
frames = int(duration * sample_rate)
audio = sd.rec(frames, samplerate=sample_rate, channels=1, dtype="float32", device=device)
sd.wait()
```

`sd.rec` allocates the whole buffer up front and blocks for exactly `--duration` seconds. There is
no callback stream, no voice activity detection, no early termination. Say one sentence under
`--duration 15` and you wait fifteen seconds regardless.

The cost is felt on every turn of the `/vocal` loop. Measured on this machine, a 3-second
utterance under `--duration 8` costs 9.75 s end to end (12.6 s on a cold page cache), of which
5.0 s is dead air. A one-second "yes" costs 9.4 s. Overhead scales with the window, not with what
you said, which is what makes the loop feel mechanical rather than conversational.

This task is independently shippable and blocks nothing — the rest of the arc builds on it, but
shipping endpointing alone is the single biggest improvement to how the loop feels.

## Fix

New `skills/vocal/scripts/vad.py` plus **strictly additive** `--vad` flags on `stt_local.py`.
Target ~170 lines total.

### `vad.py` — new module

Non-executable, no PEP 723 header, relying on its importers' declared deps (`numpy`,
`sounddevice`). Follows the existing `env_helpers.py` sibling-import pattern — `uv run --script`
puts the script's directory on `sys.path`, which `stt_elevenlabs.py:22` already relies on.

Exports: `calibrate()`, the capture state machine, `capture_utterance(**opts) -> CaptureResult`,
and `add_vad_arguments(parser)`.

**Capture** runs `sd.InputStream(samplerate=16000, channels=1, dtype="float32", blocksize=320)`
— 20 ms frames — with the state machine *inside the callback*. The work is one
`np.sqrt(np.mean(x*x))` over 320 floats plus integer counters, so it belongs on the audio thread
where there's no main-thread scheduling jitter.

```
WAITING   loud  → loud_run += 1; at onset_frames: captured = list(preroll) → SPEAKING
          quiet → loud_run = 0; preroll.append(frame)
          elapsed >= max_wait → DONE("no-speech")

SPEAKING  loud  → silence_run = 0; speech_frames += 1
          quiet → silence_run = 1 → TRAILING

TRAILING  loud  → silence_run = 0; speech_frames += 1 → SPEAKING
          quiet → silence_run += 1; at trail_frames:
                    speech long enough → DONE("endpoint")
                    else → captured = []; → WAITING     # cough, door slam

any       elapsed >= max_duration → DONE("max-duration")
```

TRAILING keeps capturing — a mid-sentence pause must not lose audio.

**Three things that will cost an afternoon if missed:**

- `indata[:, 0].copy()` in the callback. PortAudio reuses that buffer; without the copy you get
  one frame repeated N times, which presents as a hardware fault.
- Stop with `sd.CallbackStop`, never `sd.CallbackAbort` — Abort discards queued buffers and
  silently truncates the end of every utterance.
- A ~300 ms pre-roll `deque(maxlen=...)`, copied into `captured` on the WAITING→SPEAKING
  transition, so the first syllable survives onset debounce. Without it you get
  `"…ould you check the build"`.

**Calibration.** Absolute dBFS thresholds don't transfer across this machine's mics (built-in vs
CalDigit line-in differ by >20 dB), so calibrate at stream open: discard `--settle-ms 150` while
CoreAudio ramps up, take the **median** (not mean, so one keyboard click can't poison it) RMS over
`--calibrate-ms 400` → `noise_floor_db`, then

```python
open_db  = max(noise_floor_db + open_margin_db, min_open_dbfs)
close_db = open_db - hysteresis_db          # derive, so ordering holds under every flag combo
```

Compare against `open_db` while WAITING and `close_db` once in SPEAKING/TRAILING — that *is* the
hysteresis. If `noise_floor_db > -35`, warn on stderr and **proceed**; a hard failure here would be
infuriating. `--threshold-dbfs` bypasses calibration for deterministic tests.

Reference numbers: room tone runs −66 to −50 dBFS, conversational speech −34 to −20 dBFS. With a
−60 floor, open = −48 and close = −53.

Deliberately **not** `webrtcvad` (unmaintained since 2017; py3.12/arm64 needs the
`webrtcvad-wheels` fork, a wheel-availability gamble inside a `uv run --script` shebang) and
**not** silero (torch, ~2.5 GB, 2–4 s cold import — would more than double per-turn latency).
Neither helps with echo, which is the hard part and is handled later in the arc by AEC3.

### `stt_local.py` — additive only

Argparse group, delegating to `vad.add_arguments`:

| flag | default | |
|---|---|---|
| `--vad` | off | stop shortly after speech ends |
| `--max-duration` | `--duration` if given, else 30 | hard ceiling |
| `--max-wait` | 10 | give up if speech never starts |
| `--trailing-silence` | 0.8 | silence that ends the turn |
| `--min-utterance` | 0.35 | discard captures with less speech than this |
| `--preroll` | 0.3 | audio kept from before onset |
| `--frame-ms` | 20 | analysis frame size |
| `--onset-frames` | 3 | consecutive loud frames to declare speech |
| `--threshold-dbfs` | none | fixed open threshold, disables calibration |
| `--open-margin-db` | 12 | open threshold above calibrated floor |
| `--hysteresis-db` | 5 | close sits this far below open |
| `--min-open-dbfs` | −52 | clamp so a silent room isn't hair-trigger |
| `--calibrate-ms` | 400 | ambient sample length |
| `--settle-ms` | 150 | discarded while CoreAudio ramps |
| `--vad-debug` | off | log transitions and dBFS to stderr |

`--min-utterance` doubles as the **Whisper-hallucination fix**: Whisper reliably emits
`"Thank you."` or `"you"` on near-silence, and rejecting on measured speech-frame count *before*
invoking it is the actual cure. Also pass `condition_on_previous_text=False` so an early
hallucination can't become sticky.

**Silence exits 0 with empty stdout.** `agents/vocal-listener.md` step 3 already handles empty
transcripts by continuing the loop, while step 2 turns a non-zero exit into `[voice-error]` and
*halts* it. Exiting non-zero on silence would break the loop on every pause.

Three code changes:

1. **Line 186**, the mutual-exclusion check. Currently:
   ```python
   if bool(args.duration is not None) == bool(args.file is not None):
       parser.error("Use exactly one of --duration or --file")
   ```
   Becomes: `--file` rejects `--duration`/`--vad`; `--vad` makes `--duration` optional (and, when
   present, the ceiling); otherwise one of the three is required.

2. **Line 198**, `record_audio(args.duration if args.duration is not None else 10.0, ...)` — that
   `10.0` fallback needs rethinking once `--duration` can legitimately be `None` under `--vad`.
   Route the VAD path separately rather than threading it through this call.

3. `record_audio` returns the ndarray instead of a `Path`, and `transcribe` accepts
   `Path | np.ndarray`. `mlx_whisper.transcribe` accepts an ndarray directly, but the current code
   passes a path (line 124) and the path branch shells out to `ffmpeg`
   (`mlx_whisper/audio.py:46`) — an **undeclared binary dependency** absent from the PEP 723 block
   at line 4. Passing the array drops the dep and saves ~150 ms. Keep the `Path` branch working:
   `--file` needs it, and so does `check_config` at line 151.

`ensure_audio_signal` still applies, to the captured array.

**Do not make `--vad` the default.** It would silently change the timing contract of a script four
callers depend on, to save one flag.

### Backward compatibility

| Caller | Invocation | Impact |
|---|---|---|
| `skills/vocal/scripts/web_console.py:300` | `--file <path>` | none — never touches the record path |
| `agents/vocal-listener.md:29` | `--duration <n>` | none — opts in later |
| `skills/vocal/tests/test_voice.py:95` | `--duration 2` | none |
| `skills/vocal/tests/test_voice_loop.py:81` | `--file <path>` | none |
| `web_console.py:1934` | generates a `--duration N` string for display | none |

### Latency to expect

3-second utterance: 9.75 s → 5.95 s. One-second "yes": 9.4 s → ~3.0 s.

Tempting but **do not** overlap `import mlx_whisper` with an open input stream — the audio
callback is a Python callback and takes the GIL, so a long `dlopen` inside MLX can drop frames
exactly as the user starts speaking. If you try it anyway, count `status.input_overflow` in the
callback and fall back to a serial import if it's ever non-zero. (The arc's V3 hides that import
under TTS playback instead, where no stream is open.)

Also **do not** trim trailing silence before transcribing — 8 s of silence transcribes in 0.13 s,
and trimming risks clipping a final fricative.

## Acceptance

- [ ] `stt_local.py --duration 2` and `--file <fixture>` behave exactly as before; `tests/test_voice.py`
      and `tests/test_voice_loop.py` pass unchanged.
- [ ] `--vad --vad-debug` on a short sentence ends ~0.8 s after speech stops, with a plausible
      noise floor and clean state transitions on stderr.
- [ ] Speaking immediately at launch keeps the first syllable (pre-roll works).
- [ ] Silence produces exit 0 and empty stdout — and in the `/vocal` loop yields `keep-listening`,
      not `[voice-error]`.
- [ ] A cough or door slam alone does not produce a transcript (`--min-utterance` rejects it).
- [ ] `--max-duration` truncates a long monologue at the ceiling.
- [ ] No `ffmpeg` invocation remains on the record path; `--file` and `--check` still work.
- [ ] `status.input_overflow` stays zero across a handful of captures.

## References

- [duplex-milestone.md](duplex-milestone.md) — the six-task arc this opens; read for why
  endpointing comes before barge-in
- `skills/vocal/scripts/stt_local.py` — `record_audio` (97), `transcribe` (120), `check_config`
  (135), mutual exclusion (186), duration fallback (198)
- `skills/vocal/scripts/env_helpers.py` — the non-executable sibling-module pattern to follow
- `skills/vocal/scripts/web_console.py`, `agents/vocal-listener.md`, `skills/vocal/tests/` — the
  callers whose contract must not move
