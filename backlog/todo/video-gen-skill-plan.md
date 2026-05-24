---
status: pending
category: plan
pr: null
branch: null
score: null
retro_summary: null
completed: null
---

# video-gen Skill

Create a video generation skill following patterns from `image-gen`, supporting text-to-video with Google Veo and fal.ai providers.

## Problem Statement

The `image-gen` skill provides a clean pattern for AI image generation with multiple providers. Video generation APIs have matured (Veo 3.1, Kling 2.5, Hunyuan) and follow similar patterns. A `video-gen` skill would enable quick video creation from prompts using the same ergonomic CLI interface.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Providers | fal.ai + Google Veo | Matches image-gen pattern; same SDKs |
| Scope (v1) | Text-to-video only | Simpler; image-to-video can come later |
| Priority model | Google Veo 3.1 | Best overall quality, native audio |
| Default fal.ai model | Hunyuan Video | Open source, good quality |

## API Landscape (2025)

| Provider | Models | SDK | Pricing |
|----------|--------|-----|---------|
| **Google Veo** | Veo 3.1 (720p-4K, 8s, native audio) | `google-genai` | ~$0.03/sec |
| **fal.ai** | Kling 2.5, Hunyuan, LTX 2.0, Mochi | `fal-client` | ~$0.08/sec |

## Implementation Phases

### Phase 1: Google Veo Provider

**Files to create:**
- `skills/video-gen/scripts/generate_veo.py` - Veo 3.1 via Gemini API

**CLI interface:**
```bash
uv run generate_veo.py --prompt "A sunset over mountains" --output video.mp4
uv run generate_veo.py --check  # validate GOOGLE_API_KEY
```

**Options:**
- `--model veo-3.1` (default) / `veo-3` / `veo-2`
- `--resolution 720p` / `1080p` / `4k`
- `--aspect-ratio 16:9` / `9:16`

**Pattern reference:** `skills/image-gen/scripts/generate_imagen.py`

**Acceptance criteria:**
- [ ] `--check` validates API key without generating
- [ ] Generates 8s MP4 video from text prompt
- [ ] Prints absolute path to stdout on success
- [ ] Structured error handling with actionable hints

### Phase 2: fal.ai Provider

**Files to create:**
- `skills/video-gen/scripts/generate_fal.py` - Multiple fal.ai models

**CLI interface:**
```bash
uv run generate_fal.py --prompt "A cat skateboarding" --output video.mp4
uv run generate_fal.py --model fal-ai/kling-video/v2.5/turbo/text-to-video --prompt "..."
```

**Options:**
- `--model fal-ai/hunyuan-video` (default)
- `--model fal-ai/kling-video/v2.5/turbo/text-to-video`
- `--model fal-ai/ltx-2/text-to-video/fast`
- `--aspect-ratio 16:9` / `9:16`
- `--duration 5` (seconds, model-dependent)

**Pattern reference:** `skills/image-gen/scripts/generate_fal.py`

**Acceptance criteria:**
- [ ] `--check` validates FAL_KEY without generating
- [ ] Downloads video from returned URL to local file
- [ ] Model switching works across Hunyuan/Kling/LTX
- [ ] 300s timeout for video generation

### Phase 3: Documentation & Tests

**Files to create:**
- `skills/video-gen/SKILL.md` - Usage documentation
- `skills/video-gen/tests/test_video_gen.py` - Test suite

**SKILL.md content:**
- Provider comparison table
- Setup instructions (API keys in `~/.env`)
- Usage examples for each provider
- Model selection guidance
- Troubleshooting common errors

**Test structure:**
```bash
uv run test_video_gen.py              # Check env only (free)
uv run test_video_gen.py --generate   # Full generation test
uv run test_video_gen.py --provider veo  # Test one provider
```

**Pattern reference:** `skills/image-gen/tests/test_image_gen.py`

## Error Handling Pattern

```python
def error_exit(msg: str, hint: str | None = None) -> None:
    print(f"Error: {msg}", file=sys.stderr)
    if hint:
        print(f"\n{hint}", file=sys.stderr)
    sys.exit(1)
```

Error categories to handle:
- **401/Unauthorized**: Invalid API key → link to dashboard
- **429/Rate limit**: Too many requests → wait and retry
- **402/Payment**: Insufficient credits → billing link
- **Content policy**: Prompt blocked → rephrase suggestion
- **Timeout**: Generation took too long → suggest shorter duration

## Directory Structure

```
skills/video-gen/
├── SKILL.md
├── scripts/
│   ├── generate_veo.py
│   └── generate_fal.py
└── tests/
    └── test_video_gen.py
```

## Verification Commands

```bash
# Validate API keys (free)
uv run skills/video-gen/scripts/generate_veo.py --check
uv run skills/video-gen/scripts/generate_fal.py --check

# Test generation
uv run skills/video-gen/scripts/generate_veo.py --prompt "A sunset over mountains" --output test-veo.mp4
uv run skills/video-gen/scripts/generate_fal.py --prompt "A sunset over mountains" --output test-fal.mp4

# Verify output
file test-veo.mp4  # Should show: MP4 video
ffprobe test-veo.mp4  # Check duration, resolution

# Run test suite
uv run skills/video-gen/tests/test_video_gen.py --generate
```

## References

- `skills/image-gen/` - Pattern reference for entire skill structure
- `skills/image-gen/scripts/generate_imagen.py` - Google SDK patterns (lines 1-150)
- `skills/image-gen/scripts/generate_fal.py` - fal.ai SDK patterns (lines 1-120)
- `skills/image-gen/tests/test_image_gen.py` - Test structure
- [Google Veo API Docs](https://ai.google.dev/gemini-api/docs/video)
- [fal.ai Video APIs](https://fal.ai/video)
- [fal.ai Hunyuan Video](https://fal.ai/models/fal-ai/hunyuan-video)
