# Interpreting macOS agent pressure

Use these thresholds as operating signals, not absolute diagnoses. Always report the measured values.

| Dimension | Green | Yellow | Red |
| --- | --- | --- | --- |
| `memory_pressure` free/reclaimable | at least 30% | 20–29.9% | below 20% |
| Sampled swap-out | below 5 MiB/min | 5–49.9 MiB/min | at least 50 MiB/min |
| Compressor share of physical pages | below 30% | 30–44.9% | at least 45% |
| Five-minute load / logical CPUs | below 1x | 1–1.99x | at least 2x |

The overall status is the worst known dimension. A single yellow dimension warrants observation and workload adjustment; red warrants prompt investigation.

## Important caveats

- `vm_stat` swap-in and swap-out totals are cumulative since boot. A large total can describe an old incident. Use the sampled rate to decide whether swapping is active now.
- Compressor occupancy can remain high after pressure subsides. Pair it with free/reclaimable memory and the swap-out rate.
- RSS family totals are approximate because process command lines vary and helpers may be short-lived.
- Load average counts runnable and uninterruptible work. High load without swap activity often means build or test saturation rather than a memory incident.
- A process with parent PID 1 is detached, not automatically stale. Age, command path, active project work, CPU use, and user intent still matter.

## Operating guidance

### Green

- Continue normally.
- Keep heavy build/browser concurrency bounded if many agent lanes remain open.
- Do not recommend rebooting solely because cumulative swap totals are large.

### Yellow

- Pause starting new heavy agents, builds, or browser automation.
- Finish or stop an unused build first, then close costly browser windows and stale development servers.
- Recheck after each meaningful reduction.
- Reboot only if interactive symptoms persist or the user wants a clean baseline.

### Red

- Stop adding work and identify the largest reclaimable families.
- Ask before stopping exact processes; never apply broad process-name cleanup automatically.
- Recheck after cleanup. Recommend rebooting if red pressure or serious UI impairment persists, or if process ownership is too tangled to unwind safely.

## Suggested concurrency tactics

- Treat interactive agent conversations as lighter than simultaneous builds, browser suites, dev servers, and VMs.
- Keep no more than two heavy build/browser/VM jobs active at once unless the check remains green.
- Prefer finishing or pausing lanes over leaving many partially active agents with child processes.
- Stop repo-local development servers when their task is complete; detached `workerd`, Wrangler, Node, and Bun processes deserve explicit review.
