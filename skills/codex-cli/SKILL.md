---
name: codex-cli
description: Run Codex CLI for code review or implementation, select the current model, and capture the model and session that actually ran. Use whenever invoking codex from another agent or updating a Codex CLI recipe.
license: Apache-2.0
metadata:
  status: experimental
  experimental_reason: Consolidates existing Codex CLI recipes and replaces the codex-review command; command syntax is checked locally, but the consolidated workflow has no skill eval yet.
---

# Codex CLI

This skill owns model selection and CLI mechanics. `review-pr` owns review scope,
findings, and verdicts; a repository's review loop owns its additional checks.
It replaces the old `codex-review` command and duplicated model pins in callers.

## Select a model once per work session

1. Honor a model explicitly requested by the user, including an older model.
2. Otherwise read OpenAI's [latest-model guide](https://developers.openai.com/api/docs/guides/latest-model.md)
   and use its `latestModelInfo.model` metadata. Confirm that it is a Codex model
   in the [Codex model guide](https://developers.openai.com/codex/models).
   Reuse the selection for the session; do not fetch docs for every worker or
   review round. Refresh the selection when resuming a long-running arc or when
   availability changes. If the OpenAI Docs skill is available, use its documented
   search/fetch workflow and latest-model resolver rather than adding another.
3. If current documentation is unavailable, the fallback verified on 2026-11-11
   is `gpt-6-astra`. Disclose use of this dated fallback. This is the only default
   model pin in these recipes; update it here when current guidance changes.
4. Check availability and supported reasoning efforts using the CLI's `/model`
   picker or app-server `model/list`. An unavailable catalog is an unknown, not
   proof that the model is supported. If launch rejects the model or effort,
   report the error; do not guess aliases or silently downgrade.

Set the shell variable `codex_model` to the selected exact model ID before using
the recipes below. Pass it explicitly: omitting `--model` inherits configuration,
which can contain an old pin. Catalog ordering, version-number sorting, a saved
default, and the API model list do not identify the latest flagship.

Use the task's requested effort. Otherwise start at `high` for implementation and
`xhigh` for substantive review; verify support for the selected model. Preserve
lower effort for explicitly scoped routine work. Record the effective model and
effort from the run's header, structured events, or session transcript, rather than copying this
skill's fallback into attribution.

## Review

For a directed review, use `exec` with an explicit diff command and concrete
failure scenarios. Resolve the base and head to commit SHAs before writing the
prompt; include the repo's rules, scope exclusions, and expected finding format.

```bash
codex exec --model "${codex_model:?select a model first}" --sandbox read-only \
  -c model_reasoning_effort='"xhigh"' \
  --output-last-message /tmp/codex-review-verdict.txt \
  "<review prompt naming base/head SHAs and the diff command>" </dev/null
```

Use a unique output path per run. For tests that need writes, use a scratch
worktree and grant only the required workspace access. Review findings are leads
to reproduce and adjudicate; a successful CLI exit is not a clean verdict.

For a standard review target without directed instructions:

```bash
codex exec --model "${codex_model:?select a model first}" --sandbox read-only \
  -c review_model="$codex_model" -c model_reasoning_effort='"xhigh"' \
  review --base origin/main </dev/null
```

Choose exactly one of `--base`, `--uncommitted`, `--commit`, or a custom review
prompt. They conflict with each other. Plain `exec` is the route when both a
specific diff and directed instructions are needed. Check the installed CLI's
`--help` before adapting flags; `codex review` and `codex exec review` differ.
The native review recipe sets `review_model` too, so a separate old review-model
configuration pin cannot override the selected model.

## Implementation

Use the repository's isolation and delegation rules. Give a fresh process an
explicit working directory, scope, verification commands, and delivery contract.

```bash
codex exec --cd <worktree-path> \
  --model "${codex_model:?select a model first}" --sandbox workspace-write \
  -c model_reasoning_effort='"high"' \
  "<implementation brief>" </dev/null
```

Keep stdin closed for argument-based prompts. Non-interactive `exec` can append
stdin to a supplied prompt and wait for a pipe that stays open. If the prompt
comes from a file, use `codex exec ... - < brief.md` instead.

Capture the session ID and exit status. Resume a timed-out run by its exact ID,
not `--last`, which can select another concurrent run. Pass the selected model
and effort again on resume: a session ID alone can pick up configuration defaults.
For a review at `xhigh`:

```bash
codex exec --model "${codex_model:?select a model first}" \
  -c model_reasoning_effort='"xhigh"' resume <session-id> \
  "<continuation instructions>" </dev/null
```

Verify the original process has stopped before resuming. Keep quota-limit retry
times in the handoff rather than scheduling an unbounded sleep.

CLI mechanics: [official reference](https://developers.openai.com/codex/cli/reference).
