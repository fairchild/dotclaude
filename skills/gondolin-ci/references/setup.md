# Setting up gondolin-ci

## The workflow

The lane dispatches a workflow on the repository's default branch and waits for it to reach the
runner it just minted. Any workflow meets the contract if it:

- has a `workflow_dispatch` trigger with the inputs `pull_request`, `head_sha` and `suites`;
- runs each job on the labels `self-hosted`, `optin` and `pr-<N>`, and only on the default branch;
- checks out `head_sha` with `persist-credentials: false`, and confirms that is the commit it got;
- gates each job on its name in `suites`, written `contains(format(',{0},', inputs.suites), ',lint,')`.
  The front end reads suite names from that expression.

The repository has to be private: the lane refuses public ones, and
[design.md](design.md#gaps) explains why.

[../assets/pr-optin-run.yml](../assets/pr-optin-run.yml) is an example with one suite. Keep
`permissions: contents: read`, and leave out repository secrets and `id-token`: everything in the
job's environment is within reach of the code under test.

## Minting runners

A just-in-time runner comes from `POST /repos/{owner}/{name}/actions/runners/generate-jitconfig`.

The `gh` login has to have admin on the repository whichever way the runner is minted, because the
lane lists and deregisters runners through it. By default `mint-jit.sh` mints through that login
too. To keep minting on a narrower credential, create a GitHub App with the repository permission
`Administration: write`, install it on the repository, and write
`~/.config/github-runner/config`:

```sh
GITHUB_APP_ID=123456
GITHUB_APP_INSTALLATION_ID=7890123
GITHUB_APP_PRIVATE_KEY_PATH=/path/to/private-key.pem
```

When that file exists the App mints the runner, with a token limited to this repository and that
one permission.

## The guest

`gondolin-ci.sh setup` runs `npm ci` in `lane/`, so the skill's directory has to be writable, then
`lane/build-image.sh` if no guest exists yet. A build takes five to seven minutes, needs about 20 GB
free while it runs, and leaves an 8.1 GB guest in
`~/.cache/gondolin-runner/assets`. Rerun `build-image.sh` after any change to `lane/image/Dockerfile`,
with no VM running.

The image is an arm64 Ubuntu with Node, Python, the Actions runner, bun, and Chromium for the
Playwright versions in `PLAYWRIGHT_VERSIONS`. Add what a suite installs on every run to the
Dockerfile, since each VM starts from that image and downloads the rest afresh.

## The allowlist

`lane/allowlist.json` is GitHub's published list of Actions hosts. When a run's egress summary shows
a refused `productionresultssa` host, GitHub has added storage since the list was fetched and that
run's log upload failed. `bash lane/refresh-allowlist.sh` fetches the current list into the state
directory, and the lane reads it on top of the shipped one.

## Settings

| variable | effect |
| --- | --- |
| `GONDOLIN_CI_REPO` | `owner/name` to run against. Default: the repository of the current checkout. |
| `GONDOLIN_CI_WORKFLOW` | the opt-in workflow's file name, default `pr-optin-run.yml`. |
| `GONDOLIN_ALLOWLIST` | a JSON file `{"hosts": [...]}` of hosts to add for a job whose toolchain reaches further. They get reads only. |
| `GONDOLIN_APP_CONFIG` | the App config file, default `~/.config/github-runner/config`. |
| `GONDOLIN_ASSETS` | where the guest lives, default `~/.cache/gondolin-runner/assets`. |
| `GONDOLIN_STATE` | where run records, the slot and a refreshed allowlist live, default `~/.local/state/gondolin-runner`. |
| `GONDOLIN_RUNNER_DIR` | run another checkout of the lane, for example a worktree. |
| `GONDOLIN_RUN_ID_FILE` | a file to receive the run id, for a wrapper. The output cannot be parsed for it, because it carries the pull request's title. |
| `GONDOLIN_MIN_IDLE` | the idle CPU percentage below which a run warns, default `40`. |
| `VM_MEMORY`, `VM_CPUS` | guest size, default `6G` and `4`. A bigger VM costs the laptop and rarely buys speed. |
| `GONDOLIN_PRIORITY=normal` | run at normal priority, for a run someone is waiting on. |
| `GONDOLIN_AWAY_AFTER` | seconds without keyboard or mouse input before the laptop counts as left alone, default `120`. |
| `GONDOLIN_PARALLEL=1` | skip the one-VM slot, for a run meant to share the host. |
| `GONDOLIN_TRACE=1` | dump the guest's processes and sockets every 20 s. |
| `GONDOLIN_EGRESS=report` | log what the egress policy would refuse without refusing it. A run with this set is **not** contained. |
| `GONDOLIN_DEBUG_HTTP=1`, `GONDOLIN_BRIDGE_FETCH=1` | network debugging. The second skips gondolin's guarded DNS lookup, so a run with it is not contained either. |
