#!/usr/bin/env bash
# Deterministic checks for the home Canon PIXMA printer: reachability, IPP
# printer state (ink levels + error reasons), and the CUPS job queue.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Device details are local, not tracked here — set these in ~/.env (same file
# CANON_PRINTER_ADMIN_PASSWORD lives in). See docs/guide.html or SKILL.md for
# how to find them the first time (arp -a after a `discover` ping sweep).
SUBNET="${CANON_PRINTER_SUBNET:-}"
DEFAULT_IP="${CANON_PRINTER_IP:-}"
KNOWN_MAC="${CANON_PRINTER_MAC:-}"

# Local macOS CUPS queues (host-specific, not portable — see docs/guide.html
# "Printing" section for how to recreate these with lpadmin on a new machine).
QUEUE_STANDARD="Canon_iX6800_series"        # AirPrint queue: Letter/A4/etc.
QUEUE_13X19="Canon_iX6800_series_13x19"     # Native Canon driver: Super B/A3+

cmd="${1:-status}"

if [ "$cmd" = "cancel-job" ]; then
  job_id="${2:?Usage: canon-printer.sh cancel-job <job-id> [ip]}"
  ip="${3:-$DEFAULT_IP}"
  if [ -z "$ip" ]; then
    echo "No printer IP available. Set CANON_PRINTER_IP in ~/.env, or pass it explicitly: cancel-job $job_id <ip>" >&2
    exit 1
  fi
  ipptool -tv -d "job-id=$job_id" -d "user=$(whoami)" "ipp://$ip:631/" "$SCRIPT_DIR/cancel-job.test"
  exit 0
fi

if [ "$cmd" = "print" ]; then
  file="${2:?Usage: canon-printer.sh print <file> [size]}"
  size="${3:-letter}"
  case "$(echo "$size" | tr '[:upper:]' '[:lower:]')" in
    13x19|superb|super-b|"a3+"|329x483mm)
      queue="$QUEUE_13X19"
      pagesize="329x483mm"
      ;;
    letter|"")
      queue="$QUEUE_STANDARD"
      pagesize="Letter"
      ;;
    *)
      # Pass anything else straight through to the standard queue —
      # e.g. a4, legal, tabloid, 4x6, 8x10 are all valid PageSize values there.
      queue="$QUEUE_STANDARD"
      pagesize="$size"
      ;;
  esac
  echo "=== printing via $queue at $pagesize ==="
  lp -d "$queue" -o "PageSize=$pagesize" -o "media=$pagesize" "$file"
  exit 0
fi

ip="${2:-$DEFAULT_IP}"

if [ -z "$ip" ] && [ "$cmd" != "discover" ]; then
  echo "No printer IP available. Set CANON_PRINTER_IP in ~/.env, or pass it explicitly: canon-printer.sh $cmd <ip>" >&2
  exit 1
fi

case "$cmd" in
  discover)
    if [ -z "$SUBNET" ]; then
      echo "CANON_PRINTER_SUBNET not set in ~/.env — pass it explicitly, e.g.: canon-printer.sh discover  (after exporting CANON_PRINTER_SUBNET=192.168.x.0/24)" >&2
      exit 1
    fi
    echo "=== Ping sweep: $SUBNET ==="
    nmap -sn "$SUBNET"
    echo
    if [ -n "$KNOWN_MAC" ]; then
      echo "=== ARP entries (known printer MAC: $KNOWN_MAC) ==="
      arp -a | grep -i "$KNOWN_MAC" || arp -a
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
    ipptool -tv "ipp://$ip:631/" "$SCRIPT_DIR/get-printer-state.test"
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
    ;;

  *)
    echo "Usage: canon-printer.sh {discover|reach|status|jobs|all|cancel-job|print} [ip]" >&2
    echo "       canon-printer.sh cancel-job <job-id> [ip]" >&2
    echo "       canon-printer.sh print <file> [size]   (size: letter|a4|legal|13x19, default letter)" >&2
    exit 1
    ;;
esac
