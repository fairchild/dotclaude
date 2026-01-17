---
name: image-gen
description: Generate images using AI APIs (OpenAI gpt-image-1, Google Imagen 4, Nano Banana Pro, fal.ai Flux). Use when user asks to generate, create, or make an image.
license: Apache-2.0
---

# Image Generation

Generate images from text prompts using OpenAI, Google Imagen, Nano Banana Pro (Gemini), or fal.ai.

## Usage

### OpenAI (gpt-image-1)
```bash
uv run ~/.claude/skills/image-gen/scripts/generate_openai.py \
  --prompt "a cat wearing a top hat" \
  --output /tmp/cat.png
```

Options:
- `--prompt` (required): Text description of the image
- `--output`, `-o`: Output file path (default: `./generated-{timestamp}.png`)
- `--size`: Image size (default: `1024x1024`, options: `1024x1024`, `1024x1792`, `1792x1024`)
- `--quality`: Image quality (default: `auto`, options: `low`, `medium`, `high`, `auto`)

### Google Imagen 4
```bash
uv run ~/.claude/skills/image-gen/scripts/generate_imagen.py \
  --prompt "a cat wearing a top hat" \
  --output /tmp/cat.png
```

Options:
- `--prompt` (required): Text description of the image
- `--output`, `-o`: Output file path (default: `./generated-{timestamp}.png`)
- `--model`: Model to use (default: `imagen-4.0-generate-001`, options: `imagen-4.0-fast-generate-001`, `imagen-4.0-ultra-generate-001`)

### Nano Banana Pro (Gemini)
```bash
uv run ~/.claude/skills/image-gen/scripts/generate_gemini.py \
  --prompt "a cat wearing a top hat" \
  --output /tmp/cat.png
```

Options:
- `--prompt` (required): Text description of the image
- `--output`, `-o`: Output file path (default: `./generated-{timestamp}.jpg`)
- `--model`: Model to use (default: `gemini-3-pro-image-preview`)
- `--aspect-ratio`, `-a`: Aspect ratio (default: `1:1`, options: `1:1`, `16:9`, `9:16`, `21:9`)
- `--image-size`, `-s`: Output size for Pro model (options: `1K`, `2K`, `4K`)

### fal.ai (Flux)
```bash
uv run ~/.claude/skills/image-gen/scripts/generate_fal.py \
  --prompt "a cat wearing a top hat" \
  --output /tmp/cat.png
```

Options:
- `--prompt` (required): Text description of the image
- `--output`, `-o`: Output file path (default: `./generated-{timestamp}.png`)
- `--model`: Model to use (default: `fal-ai/flux/dev`)

## Provider Comparison

| Provider | Model | Speed | Quality | Cost |
|----------|-------|-------|---------|------|
| OpenAI | gpt-image-1 | Medium | Excellent | ~$0.04/img |
| Google | Imagen 4 | Medium | Excellent | ~$0.04/img |
| Google | Nano Banana Pro | Fast | Excellent | ~$0.13/img (2K) |
| fal.ai | Flux dev | Fast | Very good | Pay-per-compute |

## Environment Variables

| Provider | Variable | Required |
|----------|----------|----------|
| OpenAI | `OPENAI_API_KEY` | Yes |
| Google | `GOOGLE_API_KEY` | Yes |
| fal.ai | `FAL_KEY` | Yes |

Set in `~/.env` or export in shell.
