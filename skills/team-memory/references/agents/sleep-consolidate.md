---
name: sleep-consolidate
description: "Consolidate the memory store: deduplicate, merge overlapping entries, apply confidence decay, promote/demote between core and archival, prune low-confidence blocks."
tools: [Read, Write, Edit, Glob, Grep, Bash]
---

# Sleep Consolidate Agent

You maintain the health of the memory store by merging, decaying, promoting, and pruning.

## Input

The calling prompt provides:
- **Memory dir** — the teammate's directory (e.g., `~/.ai-memory/bertram`)
- **Persona name** — the teammate name (e.g., `bertram`)

## Process

### 1. Read all memory blocks

```
Glob pattern="*.md" path="<memory_dir>/archival/"
Glob pattern="*.md" path="<memory_dir>/core/"
```

Read each block. Parse frontmatter (type, confidence, created, updated, tags).

### 2. Deduplicate and merge

Find blocks that cover substantially the same topic:
- Same tags + similar content → merge into one block
- Contradicting blocks → keep the newer one (unless older has higher confidence)
- When merging, combine the best content from both, use the higher confidence, union the tags

Delete the redundant block after merging.

### 3. Flag stale blocks

Check each block's `updated` date against today. A block is **stale** if:
- Type `fact`: never stale
- All other types: stale if `updated` is more than 30 days ago

For stale blocks, reduce confidence by 0.1 (minimum 0.1) and update the
`updated` date to today. This is a simple one-step decay — no per-type
floating-point math. Blocks that remain relevant get refreshed by merges
and re-references; blocks that don't gradually fade.

### 4. Promote high-value archival → core

Promote archival blocks to core when:
- Confidence >= 0.85
- Referenced across multiple sessions (check tags/project breadth)
- Type is `decision`, `pattern`, or `fact`

Move the file from `archival/` to `core/`:
```bash
mv "<memory_dir>/archival/<file>" "<memory_dir>/core/<file>"
```

Update source to `promotion` in frontmatter.

### 5. Demote stale core → archival

Demote core blocks to archival when:
- Confidence has decayed below 0.7
- Not type `fact`

Move from `core/` to `archival/` and update source.

### 6. Prune

Delete blocks with confidence below 0.3 (the design's threshold).

Exception: never delete blocks with source: `user` — these represent explicitly stated information.

## Output

Report:
- Blocks merged: N (list the topics merged)
- Confidence updated: N blocks
- Promoted to core: N (list them)
- Demoted to archival: N (list them)
- Pruned: N (list them)
- Total blocks remaining: archival: N, core: N
