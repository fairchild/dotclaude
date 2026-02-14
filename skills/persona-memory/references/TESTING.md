# Testing Persona-Memory

## Test Harness Commands

Deterministic suite (required gate):
```bash
bun /Users/fairchild/.claude/skills/persona-memory/tests/harness.ts --suite deterministic
```

Synthetic evaluation only:
```bash
bun /Users/fairchild/.claude/skills/persona-memory/tests/eval.ts --report text
```

Rebuild compiled evalset from base + hand labels:
```bash
bun /Users/fairchild/.claude/skills/persona-memory/scripts/evalset-rebuild.ts --report json
```

Live smoke suite (Anthropic):
```bash
AI_MEMORY_TEST_LIVE=1 \
AI_MEMORY_TEST_PROVIDER=anthropic \
ANTHROPIC_API_KEY=... \
bun /Users/fairchild/.claude/skills/persona-memory/tests/harness.ts --suite live
```

All suites:
```bash
AI_MEMORY_TEST_LIVE=1 \
AI_MEMORY_TEST_PROVIDER=anthropic \
ANTHROPIC_API_KEY=... \
bun /Users/fairchild/.claude/skills/persona-memory/tests/harness.ts --suite all --report json
```

Eval dashboard:
```bash
cd /Users/fairchild/.claude/skills/persona-memory
bun scripts/serve-eval-dashboard.ts
# open http://127.0.0.1:8787/assets/eval-dashboard/
```

Automated dashboard screenshots (desktop/mobile, light/dark):
```bash
cd /Users/fairchild/.claude/skills/persona-memory
bun scripts/capture-dashboard.ts
```

Theme control for screenshots:
```bash
# time-aware default (auto): dark at night, light in daytime, plus opposite-theme sanity capture
bun scripts/capture-dashboard.ts --theme auto

# force one theme only
bun scripts/capture-dashboard.ts --theme dark
bun scripts/capture-dashboard.ts --theme light

# force full matrix
bun scripts/capture-dashboard.ts --theme both
```

Optional port override:
```bash
bun scripts/serve-eval-dashboard.ts --port 9090
```

API endpoints exposed by the dashboard server:
- `POST /api/run/eval` runs synthetic eval and refreshes `tests/.artifacts/eval-report.json`.
- `POST /api/run/live` runs live smoke and refreshes `tests/.artifacts/live-report.json`.
- `POST /api/run/deterministic` runs deterministic gate + synthetic eval.
- `GET /api/evalset/base?kind=events|queries` returns base rows and current label status.
- `GET /api/evalset/compiled?kind=events|queries` returns compiled/effective rows.
- `POST /api/evalset/annotate` appends hand labels (`good` or `bad` with required correction) and optional `score` (1-5).
- `POST /api/evalset/edit` edits base synthetic rows by `row_id` for event/query fixtures.
- `POST /api/evalset/rebuild` recompiles effective evalset from base + labels.
- `GET /api/evalset/stats` returns curation counts, HQ coverage, and score aggregates.

## Isolation Guarantees

- Deterministic tests always run against isolated temp memory homes.
- Tests pass `--memory-home` and `--now` to avoid touching real `~/.ai-memory`.
- Launcher integration tests use a stub `claude` binary.
- Synthetic eval replay uses fixtures in `tests/fixtures/eval/` and isolated temp dirs.
- Effective eval uses `tests/fixtures/eval/compiled/` by default.
- Base curation source of truth is `tests/fixtures/eval/base/`.
- Hand labels are append-only logs in `tests/fixtures/eval/annotations/*.labels.jsonl`.

## Live Test Contract

Environment flags:
- `AI_MEMORY_TEST_LIVE=1`
- `AI_MEMORY_TEST_PROVIDER=anthropic`
- `ANTHROPIC_API_KEY=<key>`

If these are missing, live suite exits with `skipped` status and exit code 0.

Dashboard server env fallback:
- `scripts/serve-eval-dashboard.ts` reads `ANTHROPIC_API_KEY` from `process.env` first.
- If missing, it falls back to parsing `~/.env`, then `~/.zprofile` for `ANTHROPIC_API_KEY`.
- Check `GET /api/health` for `anthropic_key_present` and `anthropic_key_source`.

## CI

Workflow:
- `.github/workflows/persona-memory-tests.yml`

Jobs:
- `persona-memory-deterministic`: PR and manual deterministic gate (includes synthetic eval).
- `persona-memory-live-smoke`: nightly/manual non-blocking live smoke.

Live artifacts:
- `tests/.artifacts/live-report.json`
