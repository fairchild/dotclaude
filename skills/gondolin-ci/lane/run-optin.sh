#!/usr/bin/env bash
# Run one opt-in suite for one pull request inside one disposable gondolin VM.
#
#   run-optin.sh <pr-number> [suite] [head-sha]
#
# The repository is $GONDOLIN_CI_REPO, or the one this directory's checkout belongs to. Its opt-in
# workflow ($GONDOLIN_CI_WORKFLOW, default pr-optin-run.yml) waits for a runner labelled
# self-hosted, optin, pr-<N>. This script boots a VM that registers under exactly those labels,
# dispatches the workflow, narrates the job's steps as the runner inside the VM reports them, and
# throws the VM away. The workflow definition that runs is the default branch's copy; only the pull
# request's tree is checked out. ../references/design.md is the design.
set -euo pipefail
# Run records hold what a job printed, and the config is a live credential until the runner takes it.
umask 077

repo=${GONDOLIN_CI_REPO:-}
workflow=${GONDOLIN_CI_WORKFLOW:-pr-optin-run.yml}
here=$(cd -- "$(dirname -- "$0")" && pwd)
state=${GONDOLIN_STATE:-${XDG_STATE_HOME:-$HOME/.local/state}/gondolin-runner}

main() {
  read_arguments "$@"
  find_the_repository
  read_the_workflow
  have_what_a_run_needs
  wait_for_the_vm_slot

  refuse_what_this_lane_cannot_contain
  refuse_to_race_an_earlier_dispatch

  introduce_the_run
  warn_if_the_branch_is_behind
  warn_if_the_host_is_busy

  mint_a_single_use_runner
  boot_the_vm_until_github_sees_it
  dispatch_the_workflow_and_find_our_run
  narrate_the_steps_as_the_runner_reports_them
  let_the_runner_leave_on_its_own
  tell_any_steps_still_untold

  report_the_outcome
  report_what_the_guest_tried_to_reach
  explain_a_failure
  point_at_the_records
  [ "$conclusion" = "success" ]
}

read_arguments() {
  pr=${1:?usage: run-optin.sh <pr-number> [suite] [head-sha]}
  suite=${2:-}
  requested_sha=${3:-}
  if ! [[ "$pr" =~ ^[1-9][0-9]*$ ]]; then
    say_err "${pr} is not a pull request number"
    exit 2
  fi
  # A just-in-time runner takes exactly one job. A second suite would stay queued on pr-<N>, and the
  # next invocation's runner could take it at whatever sha it was dispatched with.
  case "$suite" in
    *,*)
      say_err "one suite per invocation: a single-use runner takes one job, and the rest would wait for the next one"
      exit 2
      ;;
  esac
}

# Nothing is assumed about where a run points: the operator names the repository, or stands in it.
find_the_repository() {
  [ -n "$repo" ] || repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner 2> /dev/null || true)
  if [ -z "$repo" ]; then
    say_err "no repository: set GONDOLIN_CI_REPO=owner/name, or run this from a checkout of it"
    exit 2
  fi
  local facts
  if ! facts=$(ask "repos/${repo}" --jq '"\(.full_name) \(.default_branch) \(.private)"'); then
    say_err "cannot read ${repo}: check the name, and gh's login"
    exit 1
  fi
  read -r repo default_branch private <<< "$facts"
}

# The suites are the workflow's jobs. Reading them here turns a missing workflow or a mistyped
# suite into a sentence, where it would otherwise be a VM waiting two minutes for a job.
read_the_workflow() {
  local definition suites
  if ! definition=$(gh workflow view "$workflow" --repo "$repo" --ref "$default_branch" --yaml 2> /dev/null); then
    say_err "no ${workflow} on ${repo}'s ${default_branch}: start from the skill's assets/pr-optin-run.yml"
    exit 1
  fi
  suites=$(printf '%s\n' "$definition" | grep -oE "',[a-zA-Z0-9_-]+,'" | tr -d "'," || true)
  [ -n "$suite" ] || suite=$(printf '%s\n' "$suites" | sed -n 1p)
  if ! printf '%s\n' "$suites" | grep -qxF -- "$suite"; then
    say_err "no suite '${suite}' in ${workflow}; it has: $(printf '%s' "$suites" | paste -sd' ' -)"
    exit 2
  fi
}

have_what_a_run_needs() {
  local assets=${GONDOLIN_ASSETS:-${XDG_CACHE_HOME:-$HOME/.cache}/gondolin-runner/assets}
  if ! [ -d "${here}/node_modules/@earendil-works/gondolin" ] || ! [ -f "${assets}/manifest.json" ]; then
    say_err "the lane is not set up: run gondolin-ci.sh setup"
    exit 1
  fi
}

# One VM at a time: a VM takes most of the laptop's cores, and two at once fail each other's tests
# on timeouts. The slot is taken before anything is read or minted, so that what follows is about
# the pull request as it is when the run can actually start. lib/slot.mjs is the mechanism.
wait_for_the_vm_slot() {
  runner_pid=""
  trap leave EXIT
  node "${here}/lib/slot.mjs" take $$ "pr ${pr} ${suite}"
  started=$SECONDS
}

# However the script ends: stop a runner that is still up, leave no live config on disk, and give
# the slot back.
leave() {
  [ -z "$runner_pid" ] || kill "$runner_pid" 2> /dev/null || true
  [ -z "${jit:-}" ] || rm -f "$jit"
  forget_the_runner
  node "${here}/lib/slot.mjs" release $$
}

# A runner that took its job deregisters itself. One that never did stays listed, and the next run
# for this pull request refuses to share its label.
forget_the_runner() {
  [ -n "${name:-}" ] || return 0
  local id
  id=$(ask "repos/${repo}/actions/runners?per_page=100" --jq ".runners[] | select(.name == \"${name}\") | .id") || return 0
  [[ "$id" =~ ^[0-9]+$ ]] || return 0
  gh api -X DELETE "repos/${repo}/actions/runners/${id}" > /dev/null 2>&1 \
    || say_err "${name} is still registered: gh api -X DELETE repos/${repo}/actions/runners/${id}"
}

# --- Before anything exists ----------------------------------------------------------------------

# Two kinds of run would leave something outside the VM's walls, so they stop here, before a
# runner is minted.
refuse_what_this_lane_cannot_contain() {
  # A runner takes any job whose labels it carries, and anyone can open a pull request from a fork
  # of a public repository with a workflow asking for `self-hosted` alone. That job could reach the
  # runner minted here first, and it would run its own definition with logs its author can read.
  if [ "$private" != true ]; then
    say "${red}${repo} is public; this lane runs private repositories only (references/design.md, gap 2)${off}"
    exit 1
  fi

  # A dispatched run has no fork refusal of its own: it is an event on the default branch, and a fork's head is
  # reachable here through refs/pull/<N>/head. Inside the VM a fork's code is contained, but its
  # author can read the run's logs, and the design doc leaves routes open to that adversary until
  # tokens stay out of the guest and the host side is confined.
  local head_repository head_sha
  read -r head_repository head_sha < <(gh api "repos/${repo}/pulls/${pr}" \
    --jq '"\(.head.repo.full_name // "gone") \(.head.sha)"')
  if [ "$head_repository" != "$repo" ]; then
    say "${red}pull request ${pr} is from ${head_repository}, not ${repo}; opt in only to a branch of ${repo}${off}"
    exit 1
  fi

  # The lane runs heads only, so what it proves is about the commit that would merge.
  sha=${requested_sha:-$head_sha}
  if [ "$sha" != "$head_sha" ]; then
    say "${red}${sha} is not the head of pull request ${pr} (${head_sha}); the lane runs heads only${off}"
    exit 1
  fi
}

# Our runner answers to pr-<N>. Anything else already answering to that label, or already waiting
# for it, would meet our runner first.
refuse_to_race_an_earlier_dispatch() {
  local carriers
  if ! carriers=$(ask "repos/${repo}/actions/runners?per_page=100" \
    --jq "[.runners[] | select(.labels | map(.name) | index(\"pr-${pr}\"))] | length"); then
    say "${red}cannot list ${repo}'s runners: that takes admin on the repository${off}"
    exit 1
  fi
  if [ "$carriers" != "0" ]; then
    say "${red}a runner already carries pr-${pr}; deregister it first${off}"
    exit 1
  fi

  # A job queued for pr-<N> would take our runner before our own dispatch does, at an older sha. A
  # run already in progress can still hold queued jobs, so every unfinished run is checked.
  local state unfinished="" listed id labels
  for state in queued in_progress waiting pending requested; do
    if ! listed=$(gh run list --repo "$repo" --workflow "$workflow" --status "$state" \
      --json databaseId --jq '.[].databaseId' 2> /dev/null); then
      say "${red}cannot list ${repo}'s runs, so cannot tell whether one waits for pr-${pr}${off}"
      exit 1
    fi
    unfinished+=" ${listed}"
  done
  for id in $unfinished; do
    if ! labels=$(ask "repos/${repo}/actions/runs/${id}/jobs" --jq '.jobs[] | select(.status == "queued") | .labels[]'); then
      say "${red}cannot read run ${id}, so cannot tell whether it waits for pr-${pr}${off}"
      exit 1
    fi
    if printf '%s\n' "$labels" | grep -qx "pr-${pr}"; then
      say "${red}run ${id} already has a job waiting for pr-${pr}; cancel it first: gh run cancel ${id} --repo ${repo}${off}"
      exit 1
    fi
  done
}

# Every file this run leaves behind shares one name, so a run's config, log, steps and egress
# report are found together.
introduce_the_run() {
  local title stamp
  # The title is the pull request author's text, so it goes through the sanitiser like guest output.
  title=$(gh pr view "$pr" --repo "$repo" --json title --jq .title 2> /dev/null | clean || echo '')
  stamp=$(date -u +%H%M%S)
  suffix="optin-pr-${pr}-${stamp}"
  # The config is a live credential until the runner takes it, so this directory is the user's own.
  (umask 077 && mkdir -p "${state}/runs")
  jit="${state}/runs/.jit-${suffix}"
  log="${state}/runs/job-${suffix}.log"
  egress="${state}/runs/job-${suffix}.egress"
  yielding="${state}/runs/job-${suffix}.yield"
  steps="${state}/runs/job-${suffix}.steps"

  say ""
  say "${bold}pr ${pr}${off}  ${title}"
  say "${dim}${sha:0:12} · suite ${suite} · one VM, discarded when the job ends${off}"
  say ""
}

# The opt-in workflow checks out this commit, never a merge with the default branch. A branch that is behind runs
# its own stale copy of every CI contract, which reads as the pull request failing when it is
# really the branch being old.
warn_if_the_branch_is_behind() {
  local behind
  behind=$(ask "repos/${repo}/compare/${default_branch}...${sha}" --jq '.behind_by' || echo 0)
  [ "${behind:-0}" -gt 0 ] || return 0
  say "  ${yellow}${behind} commit(s) behind ${default_branch}${off} ${dim}— this runs the branch's own copy of every CI contract${off}"
  say "  ${dim}bring it up to date first:${off}"
  say "  ${dim}  gh api -X PUT repos/${repo}/pulls/${pr}/update-branch -f expected_head_sha=${sha}${off}"
  say ""
}

# The VM gets whatever CPU the laptop has left, and browser tests feel it first: the same 17 tests
# took 65 s on an idle host and 110 to 130 s beside six to ten busy loops. A failure on a busy host
# says more about the host than the pull request. The measure is idle CPU over the two seconds just
# gone. The load average does not track it: an Apple silicon laptop can show a load near 7 while
# 80% idle.
warn_if_the_host_is_busy() {
  local idle floor=${GONDOLIN_MIN_IDLE:-40}
  idle=$(idle_cpu)
  [ "$idle" -lt "$floor" ] || return 0
  say "  ${yellow}${idle}% of the CPU is idle${off} ${dim}— expect slow steps, and read timeouts as the host's, not the pull request's${off}"
  say ""
}

# --- The runner's one life -----------------------------------------------------------------------

# mint-jit.sh gets a config good for one registration and one job. Whatever credential mints it
# stays on the host; only this config goes into the guest.
mint_a_single_use_runner() {
  if ! name=$(bash "${here}/mint-jit.sh" "$repo" "$suffix" "$jit" "self-hosted,optin,pr-${pr}" 2> "${jit}.err"); then
    say "${red}could not mint a runner:${off} $(clean < "${jit}.err")"
    rm -f "${jit}.err"
    exit 1
  fi
  rm -f "${jit}.err"
  say "  ${dim}minted${off} ${name}"
}

# The VM counts as ready once GitHub itself lists the runner online; only then can a dispatch land
# on it rather than wait for some other runner.
#
# The lane borrows the laptop, so the VM starts in macOS's background band (efficiency cores,
# throttled disk I/O) and lib/governor.mjs keeps it there while the laptop is in use or busy. It
# runs full only once the laptop has been left alone. GONDOLIN_PRIORITY=normal opts out, for a
# run someone is waiting on.
boot_the_vm_until_github_sees_it() {
  local launch=(taskpolicy -b)
  [ "${GONDOLIN_PRIORITY:-low}" = normal ] && launch=(env)
  # Both write the log in append mode, or the runner's writes land over the governor's lines.
  : > "$log"
  "${launch[@]}" node "${here}/run-job.mjs" --jit "$jit" --profile build --repo "$repo" --report "$egress" --steps "$steps" \
    --memory "${VM_MEMORY:-6G}" --cpus "${VM_CPUS:-4}" >> "$log" 2>&1 &
  runner_pid=$!
  if [ "${GONDOLIN_PRIORITY:-low}" != normal ]; then
    node "${here}/lib/governor.mjs" "$runner_pid" --summary "$yielding" 2>> "$log" &
    governor_pid=$!
  fi

  printf '  %sbooting the VM%s' "$dim" "$off"
  local status="" _
  for _ in $(seq 1 90); do
    status=$(ask "repos/${repo}/actions/runners?per_page=100" \
      --jq ".runners[] | select(.name == \"${name}\") | .status" || true)
    [ "$status" = "online" ] && break
    if ! runner_alive; then
      say ""
      say "${red}runner exited early:${off}"
      tail -20 "$log" | clean
      exit 1
    fi
    printf '.'
    sleep 2
  done
  printf '\n'
  if [ "$status" != "online" ]; then
    say "${red}runner never came online (${status:-unknown})${off}"
    tail -20 "$log" | clean
    exit 1
  fi
  say "  ${dim}runner online after $(elapsed) · dispatching${off}"
}

# Opt-in runs all share one title, and one pull request can have several in flight, for example
# its suites dispatched seconds apart. So neither the newest run nor the pr-<N> label
# says which run is ours. On 2026-09-30 a run dispatched 56 s earlier for the same pull request was
# taken for ours, and its verdict was reported. Nor is the run our runner took always ours: our
# runner is online before the dispatch, so another dispatch for this pull request, at another sha
# or suite, can reach it first. GitHub names the run it made for this dispatch, and that run is
# ours only if its job went to the runner this script minted.
#
# Only then is the id written to $GONDOLIN_RUN_ID_FILE, which is how a wrapper learns it. The output
# carries the pull request's title and, on an early exit, guest lines, so no line of it can be
# trusted to name the run.
dispatch_the_workflow_and_find_our_run() {
  # A minute of slack absorbs clock skew between this laptop and GitHub.
  local dispatched_after dispatched taken
  dispatched_after=$(date -u -v-60S +%Y-%m-%dT%H:%M:%SZ 2> /dev/null || date -u -d '60 seconds ago' +%Y-%m-%dT%H:%M:%SZ)
  dispatched=$(gh api -X POST "repos/${repo}/actions/workflows/${workflow}/dispatches" \
    -f "ref=${default_branch}" -F return_run_details=true \
    -f "inputs[pull_request]=${pr}" -f "inputs[head_sha]=${sha}" -f "inputs[suites]=${suite}" \
    --jq '.workflow_run_id // empty')
  if ! [[ "$dispatched" =~ ^[0-9]+$ ]]; then
    say "${red}dispatched, but GitHub did not name the run it made, so ours cannot be told from another dispatch's${off}"
    exit 1
  fi

  taken=$(the_run_our_runner_took "$dispatched_after" 40)
  if [ -z "$taken" ]; then
    say "${red}dispatched, but no run's job reached ${name}${off}"
    cancel_our_orphaned_run "$dispatched"
    exit 1
  fi
  if [ "$taken" != "$dispatched" ]; then
    say "${red}${name} took another dispatch's job, not ours; its verdict is not this run's${off}"
    say "  ${dim}ours:   https://github.com/${repo}/actions/runs/${dispatched}${off}"
    say "  ${dim}theirs: https://github.com/${repo}/actions/runs/${taken}${off}"
    cancel_our_orphaned_run "$dispatched"
    exit 1
  fi
  run_id=$dispatched
  [ -z "${GONDOLIN_RUN_ID_FILE:-}" ] || printf '%s\n' "$run_id" > "$GONDOLIN_RUN_ID_FILE"
  say "  ${dim}run ${run_id}${off}  https://github.com/${repo}/actions/runs/${run_id}"
  say ""
}

# Our run's job still waits for pr-<N>, and while it waits every later run-optin.sh for this pull
# request refuses to race it. Our runner is going, so nothing else would take it.
cancel_our_orphaned_run() {
  if gh run cancel "$1" --repo "$repo" > /dev/null 2>&1; then
    say "  ${dim}cancelled ours, which no runner is left to take${off}"
  else
    say "  ${yellow}could not cancel ours; until it is, pr-${pr} stays blocked: gh run cancel $1 --repo ${repo}${off}"
  fi
}

# since, attempts (three seconds apart)
the_run_our_runner_took() {
  local id _
  for _ in $(seq 1 "$2"); do
    for id in $(gh run list --repo "$repo" --workflow "$workflow" --event workflow_dispatch \
      --created ">=$1" --json databaseId --jq '.[].databaseId' 2> /dev/null); do
      if gh api "repos/${repo}/actions/runs/${id}/jobs" --jq '.jobs[].runner_name // empty' 2> /dev/null | grep -qxF "$name"; then
        echo "$id"
        return 0
      fi
    done
    sleep 3
  done
}

# run-job.mjs follows the runner's own log inside the guest and writes a line to $steps as each
# step starts and finishes, so the steps print here in order and as they happen. GitHub's step
# data can run minutes behind the runner and is not read. GitHub is asked one thing, now and then:
# whether the run is over, because a job that never reached our runner leaves it waiting.
narrate_the_steps_as_the_runner_reports_them() {
  local deadline=$((SECONDS + 3600)) pass=0
  told=0
  while [ "$SECONDS" -lt "$deadline" ] && runner_alive; do
    tell_the_steps_so_far
    pass=$((pass + 1))
    if [ $((pass % 15)) = 0 ] \
      && [ "$(ask "repos/${repo}/actions/runs/${run_id}" --jq .status || true)" = "completed" ]; then
      break
    fi
    sleep 1
  done
}

# A JIT runner exits by itself once its one job is done, and run-job.mjs writes the egress report
# on the way out. Give it that chance before stopping it; on SIGTERM it still writes the report.
let_the_runner_leave_on_its_own() {
  local _
  for _ in $(seq 1 45); do
    runner_alive || break
    sleep 2
  done
  kill "$runner_pid" 2> /dev/null || true
  wait "$runner_pid" 2> /dev/null || true
  # The governor notices the runner is gone within one sample, then writes the laptop share.
  [ -z "${governor_pid:-}" ] || wait "$governor_pid" 2> /dev/null || true
  runner_pid=""
}

# An empty ticker is worth a line of its own: it means the job never reached this runner, or a new
# runner version writes its log in a shape lib/steps.mjs does not read.
tell_any_steps_still_untold() {
  tell_the_steps_so_far
  [ "$told" -gt 0 ] || say "  ${yellow}the runner's log gave no steps${off}"
}

# --- What happened -------------------------------------------------------------------------------

# The verdict is GitHub's. The steps above are the guest's own account, and the code under test can
# write to the log they were read from. GitHub settles a run a moment after the runner leaves.
report_the_outcome() {
  local _
  for _ in $(seq 1 40); do
    conclusion=$(ask "repos/${repo}/actions/runs/${run_id}" --jq '.conclusion // "unknown"' || echo unknown)
    [ "$conclusion" = "unknown" ] || break
    sleep 3
  done
  say ""
  if [ "$conclusion" = "success" ]; then
    say "  ${green}${bold}job succeeded${off} in $(elapsed) · VM discarded"
  else
    say "  ${red}${bold}job failed${off} (${conclusion}) after $(elapsed) · VM discarded"
  fi
}

# Read the proxy's own report, never the job log: guest output lands in the log and could print
# lines shaped like these. Hosts off the allowlist are "denied"; requests the method-and-path
# policy stopped are "refused".
report_what_the_guest_tried_to_reach() {
  local denied refused asked
  denied=$(grep '^--- denied' "$egress" 2> /dev/null | sort -u | clean || true)
  refused=$(grep -E '^--- (refused|would refuse)' "$egress" 2> /dev/null | clean || true)
  asked=$(grep -o 'hosts the guest asked for ([0-9]*)' "$egress" 2> /dev/null | head -1 | grep -o '[0-9]*' || echo '?')

  if [ -n "$denied" ]; then
    say "  ${dim}egress: ${asked} hosts asked for, refused:${off}"
    printf '%s\n' "$denied" | sed "s/^--- denied /    ${yellow}refused${off} /" | at_most_twenty
  else
    say "  ${dim}egress: ${asked} hosts asked for, none refused${off}"
  fi
  if [ -n "$refused" ]; then
    say "  ${dim}egress policy, method and path:${off}"
    printf '%s\n' "$refused" | sed "s/^--- /    ${yellow}/; s/\$/${off}/" | at_most_twenty
  fi
}

# run-job.mjs read the last lines of a failed step's log inside the guest as the step ended, so the
# reason is already in $steps and nothing is fetched from GitHub.
explain_a_failure() {
  [ "$conclusion" != "success" ] || return 0
  say ""
  clean < "$steps" | awk -F '\t' -v dim="$dim" -v off="$off" '
    $1 == "finish" && $3 != "success" && $3 != "skipped" { failed[++count] = $2; name[$2] = $5 }
    $1 == "log" { lines[$2] = lines[$2] "      " substr($3, 1, 150) "\n" }
    END {
      for (i = 1; i <= count; i++)
        printf "  %swhy it failed:%s step %d, %s\n%s", dim, off, failed[i], name[failed[i]], lines[failed[i]]
      if (count == 0)
        printf "  %sthe runner reported no failed step; the conclusion above comes from GitHub%s\n", dim, off
    }' || true
}

point_at_the_records() {
  say ""
  # A run that spent most of its time yielding can fail on timeouts set for hosted speed.
  [ -s "$yielding" ] && say "  ${dim}laptop share: $(cat "$yielding")${off}"
  say "  ${dim}full runner log: ${log}${off}"
  say "  ${dim}steps:           ${steps}${off}"
  say "  ${dim}egress report:   ${egress}${off}"
}

# --- Plumbing ------------------------------------------------------------------------------------

# A guest chooses how much of this it causes, and the egress report keeps the rest.
at_most_twenty() { awk 'NR <= 20 { print } END { if (NR > 20) printf "    and %d more\n", NR - 20 }'; }

# gh api prints an error's body to stdout even with --jq, so an answer counts only if gh succeeded.
ask() {
  local answer
  answer=$(gh api "$@" 2> /dev/null) || return 1
  printf '%s\n' "$answer"
}

say() { printf '%s\n' "$*"; }
say_err() { printf '%s\n' "$*" >&2; }

# Anything that came from the pull request or the guest goes through the sanitiser before it
# reaches this terminal: a title, a log line or a failure dump can carry escape sequences.
clean() { node "${here}/lib/terminal.mjs"; }

runner_alive() { kill -0 "$runner_pid" 2> /dev/null; }

# top's first sample is an average since boot; the second covers the two seconds just gone.
idle_cpu() { top -l 2 -n 0 -s 2 | awk '/CPU usage/ {idle = $7} END {printf "%d", idle}'; }

# Print what $steps has gained since the last call. Only whole lines count, so a line still being
# written waits for the next call.
tell_the_steps_so_far() {
  local total kind num first second third
  total=$(($(wc -l 2> /dev/null < "$steps" || echo 0)))
  [ "$total" -gt "$told" ] || return 0
  while IFS=$'\t' read -r kind num first second third; do
    case "$kind" in
      start) announce_step "$num" "$first" ;;
      finish) print_step "$num" "$first" "$second" "$third" ;;
      capped) say "  ${yellow}the runner's log passed ${num} step records; no more are told${off}" ;;
    esac
  done < <(sed -n "$((told + 1)),${total}p" "$steps" | clean)
  told=$total
}

elapsed() { printf '%dm%02ds' $(((SECONDS - started) / 60)) $(((SECONDS - started) % 60)); }

# On a terminal, show the step that is running; its result then overwrites the line. A captured
# run gets one line per step.
announce_step() {
  [ -t 1 ] || return 0
  printf '  %s· %2d. %s%s\r' "$dim" "$1" "${2:0:52}" "$off"
}

# number, conclusion, seconds, name
print_step() {
  local mark
  case "$2" in
    success) mark="${green}✓${off}" ;;
    skipped) mark="${dim}–${off}" ;;
    *) mark="${red}✗${off}" ;;
  esac
  printf '  %s %2d. %-52s %s%4ss%s\n' "$mark" "$1" "${4:0:52}" "$dim" "$3" "$off"
}

if [ -t 1 ]; then
  dim=$'\033[2m'; bold=$'\033[1m'; green=$'\033[32m'; red=$'\033[31m'; yellow=$'\033[33m'; off=$'\033[0m'
else
  dim=''; bold=''; green=''; red=''; yellow=''; off=''
fi

# Sourced, it defines the functions and runs nothing, so a test can drive one of them.
[ "${BASH_SOURCE[0]}" != "$0" ] || main "$@"
