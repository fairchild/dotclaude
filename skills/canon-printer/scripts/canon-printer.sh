#!/usr/bin/env bash
# Deterministic checks and actions for the home Canon PIXMA printer:
# reachability, IPP printer state (ink levels + error reasons), CUPS job
# queue, printing (with paper-state guard and queue auto-heal), and
# HTML/PDF document printing via headless Chrome.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/canon-printer"
PAPER_FILE="$STATE_DIR/paper"
INK_LOG="$STATE_DIR/ink-log.tsv"

warn() { echo "$*" >&2; }

# Device details are local, not tracked here — they live in ~/.env (same file
# CANON_PRINTER_ADMIN_PASSWORD lives in). Nothing sources ~/.env into agent
# shells, so extract exactly the three network identifiers ourselves; the
# admin password is deliberately never read. Parsed without eval so a
# malformed ~/.env line can't execute anything.
env_get() {
  local line
  line="$(grep -E "^(export )?$1=" "$HOME/.env" 2>/dev/null | tail -1 || true)"
  [ -n "$line" ] || return 0
  line="${line#*=}"
  case "$line" in
    \"*) line="${line#\"}"; line="${line%%\"*}" ;;
    \'*) line="${line#\'}"; line="${line%%\'*}" ;;
    *)   line="${line%%[[:space:]]*}" ;;
  esac
  printf '%s' "$line"
}

if [ -r "$HOME/.env" ]; then
  : "${CANON_PRINTER_IP:=$(env_get CANON_PRINTER_IP)}"
  : "${CANON_PRINTER_MAC:=$(env_get CANON_PRINTER_MAC)}"
  : "${CANON_PRINTER_SUBNET:=$(env_get CANON_PRINTER_SUBNET)}"
fi

# A wrong-shaped value is worse than a missing one — it gets used. Validate
# each and fall back to unset (with a warning) rather than acting on garbage.
valid_ip()   { [[ "$1" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; }
valid_mac()  { [[ "$1" =~ ^([0-9A-Fa-f]{1,2}:){5}[0-9A-Fa-f]{1,2}$ ]]; }
valid_cidr() { [[ "$1" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}/[0-9]{1,2}$ ]]; }

if [ -n "${CANON_PRINTER_IP:-}" ] && ! valid_ip "$CANON_PRINTER_IP"; then
  warn "ignoring CANON_PRINTER_IP='$CANON_PRINTER_IP' — not a dotted IPv4 address"
  CANON_PRINTER_IP=""
fi
if [ -n "${CANON_PRINTER_MAC:-}" ] && ! valid_mac "$CANON_PRINTER_MAC"; then
  warn "ignoring CANON_PRINTER_MAC='$CANON_PRINTER_MAC' — not a colon-separated MAC"
  CANON_PRINTER_MAC=""
fi
if [ -n "${CANON_PRINTER_SUBNET:-}" ] && ! valid_cidr "$CANON_PRINTER_SUBNET"; then
  warn "ignoring CANON_PRINTER_SUBNET='$CANON_PRINTER_SUBNET' — expected CIDR like 192.168.1.0/24"
  CANON_PRINTER_SUBNET=""
fi

SUBNET="${CANON_PRINTER_SUBNET:-}"
DEFAULT_IP="${CANON_PRINTER_IP:-}"
KNOWN_MAC="${CANON_PRINTER_MAC:-}"

# Local macOS CUPS queues (host-specific, not portable — see docs/guide.html
# "Printing" section for how to recreate these with lpadmin on a new machine).
QUEUE_AIRPRINT="Canon_iX6800_series"        # AirPrint queue: Letter/A4/etc.
QUEUE_NATIVE="Canon_iX6800_series_13x19"    # Native Canon driver: Super B/A3+, borderless

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

die() { echo "$*" >&2; exit 1; }

# macOS `arp -a` prints octets without leading zeros (0:1e:8f:...), so strip
# them from the configured MAC before grepping.
norm_mac() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/(^|:)0([0-9a-f])/\1\2/g'
}

# The printer announces itself over Bonjour (TXT ty=Canon iX6800 series) and
# answers mDNS even while asleep, so this finds it with no subnet sweep and
# no config at all. Returns the mDNS hostname (usable anywhere an IP is).
mdns_find() {
  command -v ippfind >/dev/null 2>&1 || return 1
  local uri
  uri="$(ippfind -T 4 --txt-ty 'iX6800' 2>/dev/null | head -1 || true)"
  [ -n "$uri" ] || return 1
  printf '%s' "$uri" | sed -E 's|^ipp://([^:/]+).*|\1|'
}

# Resolve a usable target host: the env IP if it answers, else Bonjour
# rediscovery (stale DHCP lease self-heals), else the env IP anyway so the
# reach/status diagnostics can tell the asleep-vs-gone story.
preflight_ip() {
  local candidate="$1" found
  if [ -n "$candidate" ] && ping -c 1 -t 2 "$candidate" >/dev/null 2>&1; then
    printf '%s' "$candidate"
    return 0
  fi
  found="$(mdns_find || true)"
  if [ -n "$found" ]; then
    if [ -n "$candidate" ]; then
      warn "note: $candidate not answering ping; Bonjour finds the printer at '$found' — using that. If this persists, update CANON_PRINTER_IP in ~/.env (run 'discover' to confirm the new address)."
    else
      warn "note: CANON_PRINTER_IP not set — found the printer via Bonjour at '$found'. Add its IP to ~/.env to skip this lookup."
    fi
    printf '%s' "$found"
    return 0
  fi
  if [ -n "$candidate" ]; then
    printf '%s' "$candidate"
    return 0
  fi
  return 1
}

# /24 of the default-route interface — lets `discover` run with no config.
derive_subnet() {
  local iface addr
  if [ -n "$DEFAULT_IP" ]; then
    printf '%s.0/24' "${DEFAULT_IP%.*}"
    return 0
  fi
  iface="$(route -n get default 2>/dev/null | awk '/interface:/{print $2}' || true)"
  [ -n "$iface" ] || return 1
  addr="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
  [ -n "$addr" ] || return 1
  printf '%s.0/24' "${addr%.*}"
}

# Maps a size token to queue + PPD PageSize. Sets: queue, pagesize, phys
# (phys = the physical sheet, i.e. pagesize minus any .FullBleed suffix).
resolve_size() {
  local s
  s="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "$s" in
    13x19|superb|super-b|a3+|329x483mm)
      queue="$QUEUE_NATIVE"; pagesize="329x483mm" ;;
    borderless|*-borderless)
      local base="${s%-borderless}"
      case "$base" in
        borderless|13x19|superb|super-b|a3+|329x483mm) pagesize="329x483mm.FullBleed" ;;
        letter)  pagesize="Letter.FullBleed" ;;
        a4)      pagesize="A4.FullBleed" ;;
        a3)      pagesize="A3.FullBleed" ;;
        tabloid) pagesize="Tabloid.FullBleed" ;;
        4x6)     pagesize="4x6.FullBleed" ;;
        5x7)     pagesize="5x7.FullBleed" ;;
        *) die "no borderless preset for '$base' in the native PPD (have: 13x19, letter, a4, a3, tabloid, 4x6, 5x7)" ;;
      esac
      queue="$QUEUE_NATIVE" ;;
    letter)
      queue="$QUEUE_AIRPRINT"; pagesize="Letter" ;;
    *)
      # Pass anything else straight through to the standard queue —
      # e.g. a4, legal, tabloid, 4x6, 8x10 are all valid PageSize values there.
      queue="$QUEUE_AIRPRINT"; pagesize="$1" ;;
  esac
  phys="${pagesize%.FullBleed}"
}

# CUPS has silently disabled a queue mid-session before, then sat on jobs
# forever — invisible from the printer's side. Auto-heal instead of hanging.
ensure_queue_enabled() {
  local q="$1"
  if lpstat -p "$q" 2>/dev/null | head -1 | grep -q disabled; then
    echo "=== queue $q was disabled (CUPS paused it) — re-enabling ==="
    cupsenable "$q"
  fi
}

recorded_paper() {
  [ -r "$PAPER_FILE" ] && cut -d'|' -f1 "$PAPER_FILE" || true
}

lc() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

do_print() {
  local file="$1" size="$2" queue pagesize phys loaded
  [ -r "$file" ] || die "print: cannot read '$file'"
  resolve_size "$size"
  loaded="$(recorded_paper)"
  if [ -n "$loaded" ] && [ "$(lc "$loaded")" != "$(lc "$phys")" ] && [ "${CANON_PRINTER_FORCE:-}" != "1" ]; then
    die "paper mismatch: recorded loaded paper is '$loaded' but this job needs '$phys'.
The printer halts on this (Support Code 2100 signature). Either:
  - swap the paper, then record it:  canon-printer.sh paper $size
  - print at the loaded size:        canon-printer.sh print '$file' $loaded
  - override if the record is stale: CANON_PRINTER_FORCE=1 canon-printer.sh print '$file' $size"
  elif [ -z "$loaded" ]; then
    echo "note: loaded-paper state unknown — record it with: canon-printer.sh paper <size>"
  fi
  ensure_queue_enabled "$queue"
  echo "=== printing via $queue at $pagesize ==="
  lp -d "$queue" -o "PageSize=$pagesize" -o "media=$pagesize" "$file"
}

do_print_doc() {
  local file="$1" size="$2" ext pdf
  [ -r "$file" ] || die "print-doc: cannot read '$file'"
  ext="$(printf '%s' "${file##*.}" | tr '[:upper:]' '[:lower:]')"
  case "$ext" in
    pdf)
      do_print "$file" "$size" ;;
    html|htm)
      [ -x "$CHROME" ] || die "print-doc needs Chrome at '$CHROME' for HTML→PDF conversion"
      pdf="$(mktemp -t canon-printer-doc).pdf"
      "$CHROME" --headless --disable-gpu --no-pdf-header-footer \
        --print-to-pdf="$pdf" "file://$(realpath "$file")" 2>/dev/null \
        || die "print-doc: Chrome HTML→PDF conversion failed for '$file'"
      echo "=== rendered $file → $pdf ==="
      do_print "$pdf" "$size" ;;
    md|markdown)
      die "print-doc takes HTML or PDF. Render the markdown to a styled HTML file first (with an @page CSS size matching the paper), then print-doc that file." ;;
    *)
      die "print-doc: unsupported extension '.$ext' (html, htm, pdf)" ;;
  esac
}

cmd="${1:-all}"

case "$cmd" in
  cancel-job)
    job_id="${2:?Usage: canon-printer.sh cancel-job <job-id> [ip]}"
    if [ -n "${3:-}" ]; then
      ip="$3"
    else
      ip="$(preflight_ip "$DEFAULT_IP")" || die "No printer IP available: CANON_PRINTER_IP unset/invalid in ~/.env and Bonjour can't see the printer. Pass it explicitly: cancel-job $job_id <ip>"
    fi
    ipptool -tv -d "job-id=$job_id" -d "user=$(whoami)" "ipp://$ip:631/" "$SCRIPT_DIR/cancel-job.test"
    exit 0
    ;;

  print)
    do_print "${2:?Usage: canon-printer.sh print <file> [size]}" "${3:-letter}"
    exit 0
    ;;

  print-doc)
    do_print_doc "${2:?Usage: canon-printer.sh print-doc <file.html|.pdf> [size]}" "${3:-letter}"
    exit 0
    ;;

  paper)
    if [ -n "${2:-}" ]; then
      resolve_size "$2"
      mkdir -p "$STATE_DIR"
      printf '%s|%s\n' "$phys" "$(date +%Y-%m-%d)" > "$PAPER_FILE"
      echo "recorded loaded paper: $phys (rear tray assumed for 13x19)"
    elif [ -r "$PAPER_FILE" ]; then
      echo "loaded paper (size|recorded-on): $(cat "$PAPER_FILE")"
    else
      echo "loaded paper: unknown — record it with: canon-printer.sh paper <size>"
    fi
    exit 0
    ;;

  ink-history)
    if [ -r "$INK_LOG" ]; then
      cat "$INK_LOG"
    else
      echo "no ink history yet — each 'status' run appends marker-levels to $INK_LOG"
    fi
    exit 0
    ;;

  queues)
    for q in "$QUEUE_AIRPRINT" "$QUEUE_NATIVE"; do
      lpstat -p "$q" | head -1 || true
      ensure_queue_enabled "$q"
    done
    exit 0
    ;;
esac

case "$cmd" in
  discover|reach|status|jobs|all) ;;
  *)
    {
      echo "Usage: canon-printer.sh {discover|reach|status|jobs|all|queues|paper|ink-history|cancel-job|print|print-doc} [ip]"
      echo "       canon-printer.sh cancel-job <job-id> [ip]"
      echo "       canon-printer.sh print <file> [size]        (letter|a4|13x19|13x19-borderless|... default letter)"
      echo "       canon-printer.sh print-doc <file.html|.pdf> [size]"
      echo "       canon-printer.sh paper [size]               (show or record what's physically loaded)"
    } >&2
    exit 1
    ;;
esac

if [ -n "${2:-}" ]; then
  ip="$2"   # explicit argument wins; no second-guessing
elif [ "$cmd" = "discover" ]; then
  ip="$DEFAULT_IP"
else
  ip="$(preflight_ip "$DEFAULT_IP")" || die "No printer IP available: CANON_PRINTER_IP unset/invalid in ~/.env and Bonjour can't see the printer (it may be fully powered off — check the panel). Run 'discover', or pass an IP explicitly: canon-printer.sh $cmd <ip>"
fi

case "$cmd" in
  discover)
    echo "=== Bonjour (ippfind, TXT ty=iX6800) ==="
    found="$(mdns_find || true)"
    if [ -n "$found" ]; then echo "$found"; else echo "(nothing announced — printer may be fully powered off)"; fi
    echo
    if [ -z "$SUBNET" ]; then
      SUBNET="$(derive_subnet)" || die "CANON_PRINTER_SUBNET not set in ~/.env and no default-route interface to derive it from — pass one, e.g.: CANON_PRINTER_SUBNET=192.168.x.0/24 canon-printer.sh discover"
      warn "note: CANON_PRINTER_SUBNET not set — derived $SUBNET from the local interface"
    fi
    echo "=== Ping sweep: $SUBNET ==="
    nmap -sn "$SUBNET"
    echo
    if [ -n "$KNOWN_MAC" ]; then
      echo "=== ARP entries (known printer MAC: $KNOWN_MAC) ==="
      arp -a | grep -i "$(norm_mac "$KNOWN_MAC")" || arp -a
    else
      echo "=== ARP entries (CANON_PRINTER_MAC not set — full table, look for the Canon vendor prefix) ==="
      arp -a
    fi
    ;;

  reach)
    echo "=== ping $ip ==="
    ping -c 3 "$ip" || true
    echo
    echo "=== port scan: 80,443,631,9100,515 ==="
    nmap -Pn -p 80,443,631,9100,515 -T4 --max-retries 2 --host-timeout 20s "$ip"
    ;;

  status)
    echo "=== ping $ip ==="
    ping -c 2 -t 5 "$ip" 2>&1 || true
    echo
    echo "=== printer state via IPP ==="
    out="$(ipptool -tv "ipp://$ip:631/" "$SCRIPT_DIR/get-printer-state.test")" && rc=0 || rc=$?
    printf '%s\n' "$out"
    levels="$(printf '%s\n' "$out" | awk '/^[[:space:]]*marker-levels \(/ {sub(/.*= /, ""); print; exit}')"
    if [ -n "$levels" ]; then
      mkdir -p "$STATE_DIR"
      [ -f "$INK_LOG" ] || printf '# date\tmarker-levels (Magenta,Black(BK),Yellow,Black(PGBK),Cyan)\n' > "$INK_LOG"
      printf '%s\t%s\n' "$(date +%Y-%m-%dT%H:%M:%S)" "$levels" >> "$INK_LOG"
    fi
    exit "$rc"
    ;;

  jobs)
    echo "=== job queue via IPP (not-completed) ==="
    ipptool -tv "ipp://$ip:631/" "$SCRIPT_DIR/get-jobs.test"
    ;;

  all)
    "$SCRIPT_DIR/canon-printer.sh" reach "$ip"
    echo
    "$SCRIPT_DIR/canon-printer.sh" status "$ip"
    echo
    "$SCRIPT_DIR/canon-printer.sh" jobs "$ip"
    echo
    "$SCRIPT_DIR/canon-printer.sh" queues
    ;;

esac
