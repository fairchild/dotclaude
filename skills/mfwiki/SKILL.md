---
name: mfwiki
description: >
  Read and cite Michael's personal wiki, or deliver new source material into
  its inbox. Trigger on: "check the wiki", "mfwiki", "what does my wiki say
  about X", "save this to my wiki", "add this to the wiki", "look up in the
  wiki", "wiki says", "wiki page".
---

# MFWiki

Michael's personal knowledge wiki — a local-first, source-backed, LLM-maintained
markdown knowledge base at `/Users/fairchild/code/mfwiki`.

Architecture: three layers — immutable `raw/` sources, LLM-maintained `wiki/`
pages, and an ingestion pipeline that moves sources from inbox to permanent
archive. External agents read and deliver; they do not mutate the wiki directly.

## Reading and Searching

Two paths for lookup:

**Structured lookup (prefer this for broad discovery):**

`/Users/fairchild/code/mfwiki/web/data/pages.json` is the machine-readable
index — all 30+ wiki pages as a JSON object keyed by wiki path. Each entry
has `id`, `title`, `type`, `summary`, `sections`, `tags`, and `chips`.

```bash
# List all page IDs and titles
python3 -c "
import json, pathlib
data = json.loads(pathlib.Path('/Users/fairchild/code/mfwiki/web/data/pages.json').read_text())
for k, v in data['pages'].items():
    print(k, '—', v.get('title',''))
"
```

If `pages.json` is stale, rebuild it first:

```bash
python3 /Users/fairchild/code/mfwiki/scripts/build_web_data.py
```

**Direct file reads (for full page content):**

```
/Users/fairchild/code/mfwiki/index.md           — navigation index, read first
/Users/fairchild/code/mfwiki/wiki/concepts/      — concept/theme pages
/Users/fairchild/code/mfwiki/wiki/notes/         — synthesis and overview pages
/Users/fairchild/code/mfwiki/wiki/repos/         — per-project pages
/Users/fairchild/code/mfwiki/wiki/sources/       — source summary pages
/Users/fairchild/code/mfwiki/wiki/queries/       — reusable answer pages
```

Workflow: read `index.md` to find the relevant page path, then read that page.

## Citing Pages

Always cite by wiki path, not absolute filesystem path:

```
See [[wiki/concepts/persistent-wiki-vs-rag]] for the wiki-vs-RAG distinction.
See [[wiki/repos/workspaces]] for the Workspaces project page.
```

These paths are stable identifiers — they survive file moves as long as
`index.md` is updated.

## Delivering a New Source

External agents may deliver new source material into the wiki inbox. The
wiki's own ingest session then scaffolds, reviews, and accepts it.

**Step 1 — write the source file anywhere reachable:**

```bash
# Good: write to a tmp path in the wiki itself
cat > /Users/fairchild/code/mfwiki/raw/tmp/my-source.md << 'EOF'
# My Source Title

Source content here.
EOF
```

Or write to any other temporary path — `deliver` accepts an absolute path.

**Step 2 — deliver atomically into `raw/new/`:**

```bash
python3 /Users/fairchild/code/mfwiki/scripts/inbox.py deliver /Users/fairchild/code/mfwiki/raw/tmp/my-source.md
```

With an optional name override:

```bash
python3 /Users/fairchild/code/mfwiki/scripts/inbox.py deliver /path/to/file.md --name 2026-06-12-my-topic.md
```

From stdin (requires `--name`):

```bash
echo "content" | python3 /Users/fairchild/code/mfwiki/scripts/inbox.py deliver - --name 2026-06-12-my-topic.md
```

A successful deliver prints `Delivered: new/<filename>` and exits 0.

**Step 3 — check delivery:**

```bash
python3 /Users/fairchild/code/mfwiki/scripts/inbox.py status
```

After delivery, the wiki's own session handles scaffold → ingest → accept.
External agents do not call `scaffold` or `accept`.

## Inbox Status

```bash
# Check all inbox dirs (tmp/, new/, cur/)
python3 /Users/fairchild/code/mfwiki/scripts/inbox.py status

# Full session-start view: inbox + wiki health
python3 /Users/fairchild/code/mfwiki/scripts/ingest.py status
```

## Hard Prohibitions

Never do these from an external session:

- **No writes to `wiki/`** — only the wiki's own ingest session writes pages.
- **No edits to `raw/cur/`** — ingested sources are immutable.
- **No edits to `raw/new/`** — files there are owned by the inbox pipeline.
- **No direct edits to `index.md` or `log.md`** — these are managed inside a wiki session.
- **No edits to `CHANGELOG.md`** — owned by the wiki coordinator.

## What Belongs in the Wiki

The wiki stores durable knowledge: what projects are, why they exist, how
they relate, strategic direction, deferred ideas, and cross-project themes.
It does not store concrete task lists, sprint priorities, or ephemeral status.
That distinction lives in [[wiki/concepts/knowledge-layer-vs-action-layer]].

## References

- External-agent contract (wiki side): `wiki/notes/external-agent-contract.md`
- Raw inbox protocol: `raw/AGENTS.md`
- Ingest workflow: `AGENTS.md` § Standard workflow
