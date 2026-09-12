---
title: Serving My Skills Over MCP
date: 2026-08-31
description: Reading SEP-2640, implementing it, and finding that 28 of my 36 skills weren't portable enough to serve.
tags:
  - claude-code
  - mcp
  - skills
---

# Serving My Skills Over MCP

My skills now serve over MCP at `https://skills.cloudcompute.com/mcp` — every portable skill in this repo, consumable by any MCP host, with verifiable manifests. This post is the compact reference for how that happened: reading the standard, implementing it, and the part I didn't see coming, which was what the standard revealed about my own repo.

## Reading the standard

[SEP-2640](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2640), the Skills Extension, rides the existing Resources primitive — one resource per file under `skill://` — and adds three methods: `skills/list`, `skills/get`, and an optional `resources/directory/read`. The load-bearing design decision is that a skill's listing entry is a *complete manifest*: every file with a SHA-256 digest and byte size, so a consuming host can verify every byte it reads and bind a user's approval to exact content. Archive distribution was cut by the core maintainers during review — unpacking a remote server's tarball is an attack surface the file-by-file shape doesn't have — so everything is individually addressed files. I think that was the right call, with the tradeoff that a many-file skill costs one round trip per file; lazy retrieval makes that scale with use rather than with catalog size.

A host that doesn't know the extension sees ordinary MCP resources and everything still works: an unmodified Claude Code session consumed the server as plain resources, paginating 400-odd files without knowing skills were involved.

## Where the work was

The implementation ([#252](https://github.com/fairchild/dotclaude/pull/252)) is a manifest builder, the three methods on the stock TypeScript SDK, and two bindings behind one store interface — stdio serving the live `~/.claude/skills`, and a Cloudflare Worker serving a build-time snapshot. A conformance suite doubles as an executable reading of the spec.

The real work was the corpus. When I linted my skills for portability, 28 of 36 failed — roughly 500 hardcoded `~/.claude/skills/...` paths that had been invisible for as long as the skills had exactly one consumer. A skill served over MCP gets materialized wherever the host chooses, so a hardcoded install path points at a directory the consuming machine has no reason to have. The second consumer is what makes coupling visible, and I suspect every skill collection that's only ever been consumed one way is carrying the same latent debt.

The rewrite settled on a test I'd use again: a skill is *portable* if it does its job on a stranger's machine given stated prerequisites — macOS, a CLI, an API key, Claude Code itself all count. Only two of my skills are genuinely bound to my machine (a printer, a homelab observability stack); they're declared `machine-bound` in frontmatter and served only by the local binding. A lint enforces the convention in CI so it can't silently regress.

## What testing found

I had agents exercise the server as consumers — a catalog sweep, an agent following a skill it fetched purely over MCP, a staleness race, an adversary, a real host session, a load generator. The finding that stuck with me: each verification layer caught a defect class the previous one couldn't. The lint found literal paths but not programmatic ones; review lenses found those; only an agent actually *following* a skill noticed the skill's own worked example failed its own validator ([#256](https://github.com/fairchild/dotclaude/pull/256)); only adversarial probing found that a junk pagination cursor decoded to `Number("")`, which is `0`, silently restarting at page one. No single layer would have gotten half of it.

Deployment and usage metrics landed in [#259](https://github.com/fairchild/dotclaude/pull/259), and the config visualizer grew a card for the server ([#260](https://github.com/fairchild/dotclaude/pull/260)). Requests are logged — method, skill, country, user agent, no IPs, and anonymous users are one undifferentiated bucket; the landing page says exactly that, because a reader can only weigh collection they can see. The repo keeps no account IDs and no keys: a fork brings its own Cloudflare account and PostHog key or gets a clean no-op, which is the forkability shape I want this whole repo to have.

If you want to try it, the landing page at [skills.cloudcompute.com](https://skills.cloudcompute.com) has the connect snippet. The point of all of it: skills are becoming infrastructure worth distributing, and a manifest that names every byte is what lets someone consume mine without taking my word for any of it.
