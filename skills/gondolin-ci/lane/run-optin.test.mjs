// How run-optin.sh decides which run is ours, driven against a gh on PATH that answers from a
// script. Nothing here reaches GitHub.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HERE = new URL(".", import.meta.url).pathname;
const RUNNER = "gondolin-optin-pr-7-120000";
const SHA = "a".repeat(40);

/** A directory holding an executable named `name` with `body`. */
function bin(name, body) {
  const dir = mkdtempSync(join(tmpdir(), "run-optin-test-"));
  writeFileSync(join(dir, name), `#!/usr/bin/env bash\n${body}`);
  chmodSync(join(dir, name), 0o755);
  return dir;
}

/**
 * Run dispatch_the_workflow_and_find_our_run with a fake gh. `dispatched` is what GitHub answers
 * the dispatch with ("" for nothing); `takers` maps each listed run to the runner its job went to.
 * @param {{ dispatched: string, takers: Record<string, string> }} world
 */
function findOurRun({ dispatched, takers }) {
  const jobs = Object.entries(takers)
    .map(([id, runner]) => `  *"runs/${id}/jobs"*) echo ${runner} ;;`)
    .join("\n");
  const dir = bin(
    "gh",
    `echo "$*" >> "$(dirname "$0")/calls"
case "$*" in
  *dispatches*) printf '%b' '${dispatched}' ;;
  "run list"*) printf '%s\\n' ${Object.keys(takers).join(" ")} ;;
${jobs}
esac
`,
  );
  const runFile = join(dir, "run");
  const driver = `source "${HERE}run-optin.sh"; pr=7 sha=${SHA} suite=lint name=${RUNNER} default_branch=trunk; dispatch_the_workflow_and_find_our_run`;
  const { status, stdout } = spawnSync("bash", ["-c", driver], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, GONDOLIN_RUN_ID_FILE: runFile, GONDOLIN_CI_REPO: "acme/widgets" },
    encoding: "utf8",
  });
  return {
    status,
    stdout,
    recorded: existsSync(runFile) ? readFileSync(runFile, "utf8") : undefined,
    calls: readFileSync(join(dir, "calls"), "utf8").split("\n"),
  };
}

test("the run GitHub made for our dispatch, taken by our runner, is ours, and only it is recorded", () => {
  const { status, recorded } = findOurRun({ dispatched: "200", takers: { 100: "gondolin-optin-pr-7-115900", 200: RUNNER } });
  assert.equal(status, 0);
  assert.equal(recorded, "200\n");
});

test("another dispatch's run that reached our runner first is refused, and ours is cancelled", () => {
  const { status, stdout, recorded, calls } = findOurRun({ dispatched: "200", takers: { 100: RUNNER, 200: "" } });
  assert.equal(status, 1);
  assert.equal(recorded, undefined);
  assert.match(stdout, /took another dispatch's job/);
  assert.ok(calls.includes("run cancel 200 --repo acme/widgets"), "our run would wedge pr-7 if left queued");
  assert.match(stdout, /cancelled ours/);
});

test("a dispatch GitHub does not name a run for is refused, since ours cannot be told apart", () => {
  const { status, recorded } = findOurRun({ dispatched: "", takers: { 100: RUNNER } });
  assert.equal(status, 1);
  assert.equal(recorded, undefined);
});

test("a run id that is not a number is refused before it is printed or used", () => {
  const { status, stdout, recorded, calls } = findOurRun({ dispatched: "evil\\nrun 999", takers: { 100: RUNNER } });
  assert.equal(status, 1);
  assert.equal(recorded, undefined);
  assert.doesNotMatch(stdout, /999/);
  assert.ok(!calls.some((call) => call.startsWith("run list")), "nothing is matched against it");
});

test("the dispatch goes to the repository's own default branch and the named workflow", () => {
  const { calls } = findOurRun({ dispatched: "200", takers: { 200: RUNNER } });
  const dispatch = calls.find((call) => call.includes("dispatches"));
  assert.match(dispatch, /repos\/acme\/widgets\/actions\/workflows\/pr-optin-run\.yml\/dispatches/);
  assert.match(dispatch, /ref=trunk/);
});

/** Run find_the_repository with `repo` from the environment and gh answering as `gh` says. */
function findTheRepository({ env, nameWithOwner, canonical = "Acme/Widgets", ghExit = 0 }) {
  const dir = bin(
    "gh",
    `case "$*" in
  "repo view"*) ${nameWithOwner ? `echo ${nameWithOwner}` : "exit 1"} ;;
  *) echo '${ghExit ? '{"message":"Not Found"}' : `${canonical} trunk true`}'; exit ${ghExit} ;;
esac
`,
  );
  const driver = `source "${HERE}run-optin.sh"; find_the_repository; echo "$repo $default_branch $private"`;
  return spawnSync("bash", ["-c", driver], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, GONDOLIN_CI_REPO: "", ...env },
    encoding: "utf8",
  });
}

test("the repository comes from the operator first, then the checkout, and is never assumed", () => {
  assert.equal(findTheRepository({ env: { GONDOLIN_CI_REPO: "acme/widgets" } }).stdout, "Acme/Widgets trunk true\n");
  assert.equal(findTheRepository({ env: {}, nameWithOwner: "acme/gears", canonical: "acme/gears" }).stdout, "acme/gears trunk true\n");
  const none = findTheRepository({ env: {} });
  assert.equal(none.status, 2);
  assert.match(none.stderr, /GONDOLIN_CI_REPO/);
});

test("a repository gh cannot read is said in words, with no error body taken for an answer", () => {
  const unreadable = findTheRepository({ env: { GONDOLIN_CI_REPO: "acme/gone" }, ghExit: 1 });
  assert.equal(unreadable.status, 1);
  assert.match(unreadable.stderr, /cannot read acme\/gone/);
  assert.equal(unreadable.stdout, "");
});

/** Run a function of the script with `gh` answering from `body`, after `setup` shell. */
function drive(setup, call, body, env = {}) {
  const dir = bin("gh", body);
  return spawnSync("bash", ["-c", `source "${HERE}run-optin.sh"; ${setup}; ${call}`], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, GONDOLIN_CI_REPO: "acme/widgets", ...env },
    encoding: "utf8",
  });
}

const WORKFLOW = `echo "if: contains(format(',{0},', inputs.suites), ',unit,')"; echo "if: contains(format(',{0},', inputs.suites), ',e2e,')"`;

test("a suite the workflow lacks stops the run before anything is minted, and none means the first", () => {
  const typo = drive("suite=lint default_branch=trunk", "read_the_workflow", WORKFLOW);
  assert.equal(typo.status, 2);
  assert.match(typo.stderr, /no suite 'lint' in pr-optin-run\.yml; it has: unit e2e/);
  const first = drive("suite= default_branch=trunk", 'read_the_workflow; echo "$suite"', WORKFLOW);
  assert.equal(first.stdout, "unit\n");
});

test("a repository without the workflow is told where to start", () => {
  const missing = drive("suite= default_branch=trunk", "read_the_workflow", "exit 1");
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /assets\/pr-optin-run\.yml/);
});

test("a public repository is refused before a runner exists", () => {
  const refused = drive("pr=7 private=false", "refuse_what_this_lane_cannot_contain", "exit 1");
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /private repositories only/);
});

test("a pull request number is a number, since it reaches a jq filter", () => {
  for (const pr of ['5"))|halt_error("x', "0", "-1", "abc"]) {
    const run = spawnSync("bash", ["-c", `source "${HERE}run-optin.sh"; read_arguments '${pr}'`], { encoding: "utf8" });
    assert.equal(run.status, 2, pr);
  }
});

test("an error body is never taken for a run's conclusion", () => {
  const body = `echo '{"message":"Bad Gateway"}'; exit 1`;
  const run = drive('run_id=9 started=$SECONDS; sleep() { :; }', 'report_the_outcome; echo "[$conclusion]"', body);
  assert.match(run.stdout, /\[unknown\]/);
  assert.doesNotMatch(run.stdout, /Bad Gateway/);
});

test("a runner that never took its job is deregistered, and one already gone costs nothing", () => {
  const dir = bin("gh", `echo "$*" >> "$(dirname "$0")/calls"\ncase "$*" in\n  *DELETE*) ;;\n  *) echo 41 ;;\nesac\n`);
  const driver = `source "${HERE}run-optin.sh"; repo=acme/widgets name=${RUNNER}; forget_the_runner`;
  const run = spawnSync("bash", ["-c", driver], { env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, encoding: "utf8" });
  assert.equal(run.status, 0);
  assert.match(readFileSync(join(dir, "calls"), "utf8"), /-X DELETE repos\/acme\/widgets\/actions\/runners\/41/);
  const gone = drive(`name=${RUNNER} repo=acme/widgets`, "forget_the_runner", "exit 0");
  assert.equal(gone.status, 0);
});

test("the race check refuses when GitHub cannot say what is queued", () => {
  const body = `case "$*" in
  "run list"*) exit 1 ;;
  *) echo 0 ;;
esac
`;
  const blind = drive("repo=acme/widgets pr=7", "refuse_to_race_an_earlier_dispatch", body);
  assert.equal(blind.status, 1);
  assert.match(blind.stdout, /cannot tell whether one waits for pr-7/);
});
