# Detection

What to run, and what the answer means. Run the command; do not infer the value from a file you
read. A repository's tooling lies in the direction of what used to be true.

## Package manager and task runner

```bash
ls bun.lock bun.lockb pnpm-lock.yaml package-lock.json yarn.lock uv.lock poetry.lock Cargo.lock go.sum 2>/dev/null
```

The lockfile is the answer, not `package.json`'s `packageManager` field and not what the README
says to install. Two lockfiles means a migration in progress: take the one git touched most
recently (`git log -1 --format=%ci -- <file>`) and say in the config file that both exist.

Then ask the task runner what it has, rather than composing a command:

```bash
mise tasks 2>/dev/null
node -e 'console.log(Object.keys(require("./package.json").scripts ?? {}).join("\n"))' 2>/dev/null
just --list 2>/dev/null
make -qp 2>/dev/null | awk -F: '/^[a-zA-Z0-9][^$#\/\t=]*:/ {print $1}' | sort -u
```

A task the repository already calls `check`, `lint`, `test`, `ci` or `verify` is the gate. Prefer
it over a composed command even when the composed one is shorter: the repository's own task is what
its CI runs and what its authors run, so a seat running the same thing gets the same answer.

If the gate and the tests are one task, say so on both lines rather than inventing a split.

## Required checks

```bash
gh api "repos/$REPO/branches/$(gh api repos/$REPO --jq .default_branch)/protection" 2>&1
gh api "repos/$REPO/rulesets" --jq '.[] | {id, name, target, enforcement}'
gh api "repos/$REPO/rulesets/<id>" --jq '.rules[] | select(.type == "required_status_checks")'
```

A `404` from the protection endpoint is an answer: this repository uses rulesets, or nothing. Read
the rulesets before concluding "nothing" — a ruleset enforces the same requirements through a
different endpoint, and a seat that believes a branch is unprotected will approve things it should
hold.

Record the number of required approvals too. Zero required approvals means the verdict is the only
review on record, which raises what a verdict has to carry, not lowers it.

## Check names, and why not the workflow file

```bash
gh api "repos/$REPO/commits/$(gh api repos/$REPO/commits --jq '.[0].sha')/check-runs" \
  --jq '.check_runs[] | "\(.name)\t\(.conclusion)"'
```

A workflow file names jobs; GitHub reports checks. A matrix job appears once per cell, a reusable
workflow appears under its caller's name, and a gate job that aggregates the others is often the
only required one. Take the names from a real commit's check runs.

## CI duration

```bash
gh run list --repo "$REPO" --workflow <name> --limit 10 \
  --json createdAt,updatedAt --jq '.[] | ((.updatedAt | fromdate) - (.createdAt | fromdate))'
```

The median, not the mean — one timed-out run doubles a mean and teaches the seat to wait for
nothing.

## Venue and label

```bash
gh api "repos/$REPO/labels" --jq '.[] | "\(.name)\t\(.description)"'
gh api "repos/$REPO/pulls?state=closed&per_page=20" --jq '.[].number'
gh api "repos/$REPO/pulls/<n>/comments" --jq 'length'
gh api "repos/$REPO/issues/<n>/comments" --jq 'length'
```

Where the review comments actually are, across the last several merged pull requests, is the venue —
not where the contributing guide says to put them. A repository whose reviews are all conversation
comments will find an inline-only seat alien, and the seat's findings get read as noise.

For the label: a name already in use wins. `needs-review`, `ready`, `for-review` and `review` all
mean the same thing to a human and different things to a poll.

## Never-defer classes

These come from the repository's own guards, so look for things that already refuse:

```bash
cat .pre-commit-config.yaml prek.toml .githooks/* 2>/dev/null
ls .github/workflows/
git log --oneline -20 --grep='revert' -i
```

Each guard names a class that is never a nit in this repository: a secret scanner means a
credential in tracked text is blocking; a policy job means the policy is blocking; a cluster of
reverts around one module means changes there carry a cost the diff does not show.

A class belongs in the never-defer list when the repository already treats it as unarguable. The
list is not a wish.
