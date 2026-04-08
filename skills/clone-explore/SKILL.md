---
name: clone-explore
description: Clone GitHub and git repos into a conventional local location, inspect them, and recommend the most useful next steps. Use when the user asks to clone, download, inspect, evaluate, look over, or assess a repository, especially when they want it placed under the usual owner/repo path in ~/code/github and reviewed before deeper work.
license: Apache-2.0
---

# Clone Explore

Clone repositories into a predictable location, inspect them conservatively, and turn the result into an actionable recommendation.

## Repository Location Convention

Prefer these destinations:

- GitHub: `~/code/github/<owner>/<repo>`
- Other git hosts: `~/code/git/<host>/<owner>/<repo>`
- Temporary evaluations: `~/code/tmp/<owner>-<repo>`

If the user gives a different destination explicitly, follow the user's instruction.

## When To Use This Skill

Use this skill when the user asks for things like:

- "clone this repo"
- "download this and look it over"
- "inspect this GitHub project"
- "check out this repo and tell me what to do next"
- "evaluate whether this repo is useful"

## Workflow

### 1. Resolve the target

Parse the repo URL or shorthand and determine:

- host
- owner/org
- repo name
- conventional local destination

If the user provides GitHub shorthand like `owner/repo`, treat it as `https://github.com/owner/repo`.

### 2. Clone conservatively

- Create the parent directory if needed.
- If the repo is missing locally, clone it to the conventional destination.
- If it already exists, do not reclone.
- Report the final local path clearly.

If the repo already exists, inspect the existing checkout first. Fetch remote state only if useful, and do not switch branches unless the user asks.

### 3. Inspect before proposing work

Read the most relevant project files first:

- `README*`
- `AGENTS.md` / `CLAUDE.md`
- runtime and package-manager files (`package.json`, `bun.lock`, `pnpm-lock.yaml`, `uv.lock`, `pyproject.toml`, `Cargo.toml`, etc.)
- top-level structure
- docs and examples
- recent git activity and current status

Detect the stack from the repo files instead of guessing.

### 4. Summarize what matters

Provide a concise summary covering:

- what the repo is
- stack and architecture
- apparent maturity and maintenance status
- how relevant it is to the user's workflow
- risks, caveats, or signs of staleness

If the repo is a catalog, awesome list, template collection, or index, also extract the entries most relevant to the user's workflow instead of only describing the catalog itself.

### 5. Recommend next actions

Give 3-5 ranked suggestions and clearly identify the single highest-leverage next step.

Prefer suggestions that help the user:

- adopt the repo
- evaluate it more deeply
- integrate useful pieces into their workflow
- avoid wasting time on low-value setup

## Deep Evaluation Mode

If the user explicitly asks for deeper evaluation, you may go beyond inspection and:

- determine the native package manager/runtime
- install dependencies
- run documented read-only checks like `test`, `check`, `lint`, or `build`

Before expensive, stateful, or external side effects, ask for confirmation. Be conservative.

Do not deploy, publish, edit files, or commit unless the user explicitly asks.

## Output Checklist

Always include:

- final local path
- whether the repo was newly cloned or already existed
- the repo summary
- the best next action

## Notes

- Prefer read-only exploration first.
- Use the conventional destination unless the user overrides it.
- For GitHub resources, default to `~/code/github/` so related repos are easy to discover and maintain.
