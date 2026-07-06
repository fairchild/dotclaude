---
name: canon-printer
description: Check status, ink levels, job queue, cancel stuck jobs, print files and rendered documents, track loaded paper, and troubleshoot reachability for the home Canon PIXMA iX6800 printer. Manually invoked only — use `/canon-printer` (optionally `status`, `jobs`, `cancel-job`, `print`, `print-doc`, `paper`, `ink-history`, `discover`, `troubleshoot`).
disable-model-invocation: true
---

# Canon Printer

Manage the home Canon PIXMA iX6800 printer via its native protocols (IPP, nmap) instead of its auth-gated web UI.

## Known Device

| | |
|---|---|
| IP | Local only — `$CANON_PRINTER_IP` in `~/.env`. Reconfirm via `discover` if unreachable (DHCP lease can move it). |
| MAC | Local only — `$CANON_PRINTER_MAC` in `~/.env` (used to pick this device out of `arp -a` during `discover`). |
| Subnet | Local only — `$CANON_PRINTER_SUBNET` in `~/.env` (e.g. `192.168.x.0/24`), used by `discover`'s ping sweep. |
| Model | Canon PIXMA iX6800 series |
| Cartridges | Magenta, Black(BK), Yellow, Black(PGBK), Cyan |
| Print queues | `Canon_iX6800_series` (AirPrint, Letter/A4/etc.) · `Canon_iX6800_series_13x19` (Canon native driver, Super B/A3+) — both local macOS CUPS queues, see `print` below |

IP/MAC/subnet are network-identifying details for a specific home device, so they live in `~/.env` (the same file `$CANON_PRINTER_ADMIN_PASSWORD` lives in) rather than in this repo. Nothing sources `~/.env` into agent shells, so the script extracts exactly these three `CANON_PRINTER_(IP|MAC|SUBNET)` lines from it at startup when they're absent from the environment — parsed without `eval`, and the admin password is deliberately never read.

The script is resilient to all three being missing, stale, or malformed:

- **Malformed** values (non-IPv4 IP, non-CIDR subnet, non-colon MAC) are warned about and ignored rather than acted on.
- **Stale or missing IP** self-heals: before any network subcommand the script pings the configured IP, and on no answer re-finds the printer over Bonjour (`ippfind --txt-ty 'iX6800'` — the printer advertises `ty=Canon iX6800 series` and answers mDNS even while asleep), then proceeds against the mDNS hostname with a note suggesting the `~/.env` update. A DHCP lease move no longer breaks anything.
- **Missing subnet**: `discover` derives the `/24` from the default-route interface.
- An explicitly passed `[ip]` argument is always used as-is, no second-guessing.

So `~/.env` entries are an optimization (skip the Bonjour lookup), not a requirement. The only hard failure is a printer that's fully powered off *and* absent from mDNS.

Runtime state (loaded-paper record, ink-level history) lives outside the repo at `~/.local/state/canon-printer/`.

## Usage

```
/canon-printer                  # full check: reachability + state + jobs + queue health
/canon-printer status           # ink levels + printer-state + error reasons (appends to ink history)
/canon-printer jobs             # CUPS job queue (not-completed)
/canon-printer cancel-job <id>  # cancel a stuck job by job-id (from `jobs` output)
/canon-printer print <file> [size]      # print, auto-picking the right local queue
/canon-printer print-doc <file> [size]  # HTML/PDF documents: render via headless Chrome, then print
/canon-printer paper [size]     # show or record what paper is physically loaded
/canon-printer ink-history      # marker-level log, one row per `status` run
/canon-printer discover         # re-find the IP: Bonjour first, then ping sweep + ARP
/canon-printer troubleshoot     # unreachable / browser-specific errors
```

All read-only checks run via `scripts/canon-printer.sh {discover|reach|status|jobs|queues|all} [ip]`. Bare invocation defaults to `all`.

## Default / `status` / `jobs` / `discover` / `all`

Run the matching subcommand:

```bash
~/code/dotclaude/skills/canon-printer/scripts/canon-printer.sh all
~/code/dotclaude/skills/canon-printer/scripts/canon-printer.sh status
~/code/dotclaude/skills/canon-printer/scripts/canon-printer.sh jobs
~/code/dotclaude/skills/canon-printer/scripts/canon-printer.sh discover
```

(Use the runtime path `~/.claude/skills/canon-printer/scripts/canon-printer.sh` if invoked from `~/.claude`.)

Interpret the `status` output:
- `printer-state: idle` + `printer-state-reasons: none` → healthy.
- Any `marker-levels` entry near 0 → that cartridge is empty; name it by its `marker-names` position (Magenta / Black(BK) / Yellow / Black(PGBK) / Cyan).
- `printer-state: stopped` + `printer-is-accepting-jobs: false` → halted, almost always an empty cartridge (see above) rather than a separate fault.
- `spool-area-full-report` in `printer-state-reasons` is usually a side effect of the halt (queued jobs backing up), not an independent cause.
- If ink levels are all healthy but the printer is still `stopped`, check `jobs` — a stuck job (`job-state: processing-stopped`, `job-state-reasons: job-stopped`, 0 sheets completed) is the usual cause, often a paper/media mismatch (e.g. a photo job waiting on paper stock that isn't loaded) rather than ink.

## `cancel-job`

```bash
scripts/canon-printer.sh cancel-job <job-id> [ip]
```

Sends IPP `Cancel-Job` for the given `job-id` (get it from `jobs` output — `job-id (integer) = N`). This printer's CUPS doesn't appear to enforce `requesting-user-name` ownership — cancellation has succeeded from a different local user than the job's `job-originating-user-name` — so double-check the `job-name` in `jobs` output before cancelling to make sure it's the job you mean to kill, since there's no ownership guard to catch a mistaken job-id. After cancelling, re-run `status`/`jobs` to confirm `printer-state` returns to `idle` and the queue is empty.

## `print`

```bash
scripts/canon-printer.sh print <file> [size]
```

Sends `<file>` to whichever local macOS CUPS queue actually works for the requested `size` (default `letter`):

| `size` | Queue used | `PageSize` sent |
|---|---|---|
| `letter` (default), or omitted | `Canon_iX6800_series` | `Letter` |
| `13x19`, `superb`, `super-b`, `a3+`, `329x483mm` | `Canon_iX6800_series_13x19` | `329x483mm` |
| `borderless`, `13x19-borderless` | `Canon_iX6800_series_13x19` | `329x483mm.FullBleed` (edge-to-edge poster/photo) |
| `letter-borderless`, `a4-borderless`, `a3-borderless`, `tabloid-borderless`, `4x6-borderless`, `5x7-borderless` | `Canon_iX6800_series_13x19` | `<Size>.FullBleed` from the native PPD |
| anything else (`a4`, `legal`, `tabloid`, `4x6`, `8x10`, ...) | `Canon_iX6800_series` | passed through as-is |

Before submitting, `print` (a) checks the loaded-paper record (see `paper` below) and refuses on a physical-size mismatch — the exact condition that halts the printer with Support Code 2100 — overridable with `CANON_PRINTER_FORCE=1` if the record is stale; and (b) auto-heals a CUPS-disabled queue with `cupsenable` (CUPS has silently paused a queue mid-session before and sat on jobs forever, invisible from the printer's side).

Why two queues instead of one: `Canon_iX6800_series` is an auto-generated AirPrint queue (confirmed via `printer-make-and-model='Canon iX6800 series-AirPrint'` in `lpstat -v`, and `*APAirPrint: True` in its PPD) that never advertises a real Super B preset and doesn't correctly negotiate a hand-typed 13×19 custom size with this printer's firmware — jobs sent that way stop with Support Code **2100** (paper size mismatch) even when the numbers are right. Canon's actual driver was separately installed on this Mac (the BJPrinter package) but unused by the default queue; its PPD at `/Library/Printers/PPDs/Contents/Resources/CanonIJiX6800series.ppd.gz` has a proper `329x483mm/A3+ 13"x19" 33x48cm` preset (plus a `.FullBleed` borderless variant) that this printer's firmware accepts correctly. `Canon_iX6800_series_13x19` was created once with:

```bash
lpadmin -p Canon_iX6800_series_13x19 -E \
  -v "$(lpstat -v Canon_iX6800_series | sed 's/^device for [^:]*: //')" \
  -P "/Library/Printers/PPDs/Contents/Resources/CanonIJiX6800series.ppd.gz" \
  -L "Office"
```

That pulls the existing AirPrint queue's own device URI (a per-device `dnssd://` address with a Bonjour UUID) rather than hardcoding it, so the same command works unchanged on a different Mac. Both queue names are **local CUPS config on this specific Mac**, not portable via git — if this skill runs on a different machine, recreate `Canon_iX6800_series_13x19` with the command above before `size=13x19` will work there.

**`size` has to match the paper physically loaded, not just the job.** Neither queue knows what's in the rear tray — that's why the `paper` record exists. Requesting `letter` while 13×19 stock is loaded (or vice versa) halts the printer with the same `other-error` / `processing-stopped` signature as every other stuck-job case — this isn't a script bug, it's the printer's own size-mismatch safety check. If a print sent this way gets stuck, `jobs` will show it as `processing-stopped`; `cancel-job` clears it once the loaded paper and `size` argument actually agree. 13×19 stock also must feed from the **rear tray**, not the front cassette.

## `paper`

```bash
scripts/canon-printer.sh paper          # show what's recorded as loaded
scripts/canon-printer.sh paper 13x19    # record after physically swapping stock
```

Tracks the one thing no queue can see: what sheet is actually in the tray. Stored as the canonical physical size (borderless variants normalize to the same sheet) in `~/.local/state/canon-printer/paper` with the date recorded. When the user says they swapped paper, record it; when `print` warns of a mismatch, ask before forcing.

## `print-doc`

```bash
scripts/canon-printer.sh print-doc <file.html|.pdf> [size]
```

The render path for documents agents produce. Division of labor: **Claude authors the HTML** (layout, typography, an `@page` CSS rule sized to the target paper — e.g. `@page { size: 8.5in 11in; margin: 0.5in }`, or `size: 13in 19in; margin: 0` for posters); the script converts it deterministically via headless Chrome to PDF and sends it through the same paper-guarded `print` path. Markdown is rejected on purpose — render it to styled HTML first rather than printing raw text.

Compositions this enables (each is just "write HTML, then `print-doc`"):

- **Morning agenda** — today's calendar + weather + top of the backlog, printed on a schedule (pair with the `schedule` skill). Paper as an ambient display.
- **Posters / wall art** — `image-gen` output embedded full-bleed, `size=13x19-borderless`.
- **N-up photo imposition** — an HTML page with photos at exact physical dimensions plus cut marks, packed onto one 13×19 sheet; big sheets are where per-page ink/paper cost bites.
- **Notes, recipes, packing lists, kids' mazes/coloring pages** — anything printable becomes one verb.

## `ink-history`

Every `status` run appends a timestamped `marker-levels` row to `~/.local/state/canon-printer/ink-log.tsv` (column order: Magenta, Black(BK), Yellow, Black(PGBK), Cyan). `ink-history` prints the log. Over time this gives consumption curves per cartridge — warn the user when a level drops below ~20% and offer to draft the reorder, since ink-out is the most common cause of a halted printer and it triggers Auto Power Off on top.

## `queues`

Local CUPS queue health for both printer queues; re-enables any queue CUPS silently disabled. Runs automatically as part of `all` and before every `print`.

## `troubleshoot`

Use when the printer seems unreachable, or reachable in one browser but not another.

1. **All ports filtered + ping times out** (`nmap -Pn -p 80,443,631,9100,515 <ip>` shows every port `filtered`, `ping` gets no reply, `arp -a` still shows a MAC entry): this is the printer asleep or fully powered off, not a network fault — Auto Power Off kicks in especially after an ink-out halt. Ask the user to check the panel / press a button / swap the empty cartridge, then re-run `reach`. **Standing fix: enable Auto Power On** (one-time human setup: RUI → Settings, or the Canon IJ Printer Utility → Auto Power settings) so the printer wakes when a job arrives — this is the single biggest blocker to unattended agent printing; without it, a sleeping printer always needs a human at the button.

2. **Works in Safari, fails in Chrome/Firefox** (`ERR_ADDRESS_UNREACHABLE` or similar): almost always Little Snitch filtering those processes specifically, not a real network problem. Confirm with:
   ```bash
   /usr/bin/log show --last 20m --predicate 'process CONTAINS "littlesnitch"' --style compact \
     | grep -iE "<printer-ip>|chrome|firefox"
   ```
   Look for `Socket closed during DPI without data` naming the browser process and the printer's IP — that's Little Snitch's network extension tearing down the connection during inspection, which surfaces to the browser as an unreachable address. Fix: open Little Snitch → Rules, filter by the affected browser process, and add/adjust an Allow rule for the printer's IP (or its `/24` subnet — see `$CANON_PRINTER_SUBNET` in `~/.env`).

   **Gotcha:** always call `/usr/bin/log`, not bare `log` — zsh has a builtin `log` (math function) that shadows the real command and fails with a confusing `too many arguments` error instead of running.

3. **`http://<ip>/` redirects to `/errindex.html`**: this is *not* a device error page. The printer's HTTP root chains `/` → `index.html` → `rui/index.html`, which 401s without admin credentials and redirects to `/errindex.html`, whose JS just renders a login-required message (`ERR_INVALID_PWD`). Don't diagnose printer health from this page — use `status` (IPP) instead, which gives structured, unauthenticated state.

4. **Port 443 always shows `filtered`**: expected — this printer doesn't serve HTTPS at all. If Firefox's HTTPS-only mode is enabled it will retry `:443` and fail before falling back to plain `:80`, which is the only thing this device actually offers.

5. **Loud/grinding noise during a print, then halts, then Power+Alarm lamps blink *alternately* (not a counted number of flashes, ~1s each, pause, repeat)**: this is Canon Support Code **5100** — a carriage obstruction, confirmed via the RUI (`Utilities` → the error detail screen shows `Support Code 5100` / "Service error has occurred"; official per-code detail lives at `https://ij.manual.canon/ij/webmanual/ErrorCode/iX6800%20series/EN/ERR/5100.html`, not fetchable via WebFetch — the domain isn't allowlisted, so read it through the RUI or a search snippet instead). IPP only ever reports the generic `other-error` for this — the numbered Support Code is RUI-only, the one case where checking the web UI actually beats IPP. Canon's fix, verbatim: cancel the print, power off, open the cover, clear whatever's blocking the print head carriage (jammed paper, or leftover protective tape/cap from a cartridge swap — a strong suspect right after replacing a cartridge, since that's exactly when loose tape/caps end up in the carriage's travel path), avoid touching other internals, then power back on. If 5100 recurs after a clean carriage path, it's a hardware fault (bent rail, failed motor, damaged encoder strip) needing service — not something further IPP/software commands can resolve.

6. **After clearing a physical fault (5100 or similar), confirm the printhead itself is undamaged with a Nozzle Check** (RUI → Utilities → Print nozzle check pattern, or the physical button combo if the model has one). Reading the printout: two columns of short vertical bars, one per ink (PGBK, C, M, Y, and — on this printer — 3 density passes each for C/M). Solid, continuous, unbroken bars end-to-end = healthy, no cleaning needed. A faded or missing segment partway down a specific bar = that nozzle/ink channel is clogged, warranting a Cleaning cycle (then Deep Cleaning if that doesn't fix it) before assuming the fault caused lasting damage. A carriage obstruction (5100) typically doesn't clog nozzles — it stops head *movement*, not ink flow — so a clean nozzle check right after clearing 5100 is the expected, good outcome.

   **Claude can read the printout directly**: ask the user to photograph the nozzle-check sheet and share the image (drag into the session, or give a file path to Read). Judge each bar against the criteria above and name the specific clogged channel (PGBK/C/M/Y/BK) and the recommended step (nothing / Cleaning / Deep Cleaning) — this closes the diagnostic loop without the user needing to interpret the pattern themselves. The same photograph-and-Read move works for verifying color-critical prints: print a small test target, photo, compare.

## Notes

- **Unattended printing** = Auto Power On (wake on job, one-time human setup, see `troubleshoot` #1) + `print-doc` (agents author HTML, script renders and prints) + the `paper` record (catches size mismatches before they halt the printer). With those three in place, "print me X at 7am" works with nobody home.
- IPP (port 631) gives real structured state without authentication; the web UI (port 80) requires the admin password and returns HTML, not data — prefer IPP for anything programmatic. Exception: numbered Support Codes (e.g. 5100) only surface in the RUI, not in `printer-state-reasons`.
- DHCP lease changes are the most common cause of a "dead" printer — but the preflight now handles that automatically via Bonjour, so if a network subcommand still can't reach it, the printer is genuinely off the network (powered off, or a real fault). `discover` remains useful for confirming the new address to record in `~/.env`.
- An admin password for the RUI may be present at runtime as `$CANON_PRINTER_ADMIN_PASSWORD` (e.g. sourced from `~/.env`). **Do not read or use it to authenticate** — entering credentials to log into the RUI, whether via browser form-fill or a scripted request (curl, etc.), is out of scope regardless of how the credential is made available. Every subcommand in this skill works fully unauthenticated over IPP; RUI-only actions (e.g. triggering Nozzle Check from the web UI) require the user to log in themselves in their own browser session.
