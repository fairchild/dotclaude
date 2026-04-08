# clone-explore

Clone a repository into a conventional local path, inspect it conservatively, and recommend the most useful next step.

## When to use this

Use this skill when you want Claude to:

- clone a GitHub repository into a predictable place under `~/code/`
- inspect a repo before deciding whether it is worth adopting
- look over an unfamiliar project and summarize its stack, maturity, and relevance
- recommend follow-up actions after a quick repo review

## Repository convention

The skill prefers these locations:

- GitHub: `~/code/github/<owner>/<repo>`
- Other git hosts: `~/code/git/<host>/<owner>/<repo>`
- Temporary evaluations: `~/code/tmp/<owner>-<repo>`

If you give Claude a different path explicitly, it should follow your instruction instead.

## What it does

1. Resolves the repo URL or shorthand
2. Clones only if the repo is not already present
3. Inspects key files like `README*`, `AGENTS.md`, `CLAUDE.md`, package/runtime files, and recent git history
4. Summarizes what the project is, how it is built, and whether it looks active or stale
5. Recommends the highest-leverage next action

If you explicitly ask for a deeper evaluation, the skill can also install dependencies and run safe validation commands — but only after a conservative read-first pass.

## Example prompts

- "Clone this repo and look it over: https://github.com/qualisero/awesome-pi-agent"
- "Download `owner/repo`, inspect it, and tell me if it seems useful"
- "Clone this project into the usual place and recommend what I should do next"
- "Do a deeper evaluation of this repo and run its checks"
