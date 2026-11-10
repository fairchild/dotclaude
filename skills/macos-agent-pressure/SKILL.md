---
name: macos-agent-pressure
description: Diagnose live macOS memory, swap, load, and concurrent AI-agent process pressure. Use when the user asks for a Mac or agent-resource checkup, reports queued or stalled Codex/Claude work, suspects heavy swap or too many concurrent agents, asks whether to reboot, or wants a before-and-after reassessment after closing apps or processes.
license: Apache-2.0
disable-model-invocation: true
---

# macOS Agent Pressure

Run a repeatable, read-only host check before recommending cleanup or rebooting.

## Workflow

1. Capture a live snapshot:

   ```bash
   uv run --script scripts/agent_pressure.py
   ```

2. If macOS blocks process inspection, rerun the same read-only command with the required host authorization. Do not omit the process-family pass.
3. Read `references/interpretation.md` when assigning severity, interpreting swap history, or deciding whether a reboot is warranted.
4. Report:
   - overall status and whether pressure is active now,
   - memory free/reclaimable percentage, compressor use, swap-in/out rate, and normalized load,
   - largest process families and detached long-lived tool/development processes,
   - immediate operating tactics,
   - whether a reboot is warranted now.
5. Do not kill processes, restart apps, or reboot unless the user explicitly asks. Prefer identifying exact processes and letting the user choose.
6. After the user changes anything, take a fresh snapshot and compare it rather than relying on the first result.

## Before/after checks

Save the baseline explicitly:

```bash
uv run --script scripts/agent_pressure.py --save /tmp/agent-pressure-before.json
```

After cleanup or reboot:

```bash
uv run --script scripts/agent_pressure.py \
  --compare /tmp/agent-pressure-before.json
```

For automation or further processing, use `--json`. Add `--strict` only when yellow/red status should produce a non-zero exit code.

## Interpretation rules

- Treat cumulative swap totals as historical evidence, not proof of current thrashing. Prioritize the sampled swap-out rate.
- Prefer resident memory aggregated by process family over virtual memory size.
- Treat high load independently from memory pressure; builds can saturate CPU while memory remains acceptable.
- Consider rebooting only when red pressure persists after obvious stale workloads are stopped, the UI remains impaired, or the user needs a clean baseline.
- Never automate broad cleanup such as `killall`, `pkill`, or `kill -9` from this skill.

## Resources

- `scripts/agent_pressure.py`: deterministic macOS snapshot, assessment, JSON output, and comparison command.
- `references/interpretation.md`: thresholds, caveats, and operating guidance.
- `tests/test_agent_pressure.py`: parser, classification, assessment, and comparison tests.
