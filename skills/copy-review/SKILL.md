---
name: copy-review
description: Review or rewrite a README, a docs page or a landing page so it informs a newcomer fast — what it is, how to install it, one example, then links to the detail. Use when asked to review copy or docs, when a page "reads as AI slop", before a public release, and for any change to a README or docs page in a repo that has no writing rules of its own.
license: Apache-2.0
metadata:
  status: experimental
  experimental_reason: "Written from one review of two repositories' READMEs and docs sites before their public release; no eval yet."
---

# Copy review

A page's job is to inform. A reader decides in the first screen whether to keep going, so the page gives the fastest
content first and opens detail one level at a time. This skill checks what a page carries and in what order and, when
asked, rewrites it. Sentence-level wording is out of scope.

## Before reading the page

1. **Find the repo's own writing rules.** Look for a Writing section in `CONTRIBUTING.md`, a style guide in `docs/`,
   or rules in `CLAUDE.md` or `AGENTS.md`. Where they exist they win, and this skill fills what they leave out.
2. **Fix the scope.** Name the pages you'll read and the ones you won't, and say so in the report.
3. **Read the site as well as the README.** A docs site often leads better than its README does, and its wording can
   be reused.

## What to check

Read each page as a newcomer who has never seen the project.

**Order.** The first screen answers these, in this order:

1. What it is, in one or two sentences.
2. Who it's for and who it isn't, when that isn't obvious.
3. How to install it.
4. One example that runs.
5. Links to the rest.

Everything else goes a level down: a later section, the docs site or the API reference. A README links to the guide
and doesn't repeat it. Count the words before the install command and report the number.

**Purpose.** Each sentence says what a thing is, what it's for or how to use it. A sentence that argues the project
is good is persuading. Cut it or replace it with the fact behind it.

**Density.** Cut or move:

- Exceptions. The overview states the rule. "Except" and "unless" clauses go in the reference.
- Lists of names in a sentence. Keep three examples and link the full list.
- A project term used before it's explained. Use a plain word, or explain the term where it first appears.
- How it works before what it's for. "Pages are cached by view and page size" becomes "it keeps pages per view, so
  switching back is instant."
- Process details: test file names, how the site is published, how CI works. They go in `CONTRIBUTING.md`.
- Vague claims, such as "adapts to every size and setting". Say the fact.

**Visuals.** Mark each place where prose describes something a reader could see:

- a screenshot for something visible;
- a short recording for something that changes;
- a diagram for a relationship among three or more parts.

Each one needs alt text that says what it shows.

## Before rewriting

A README is sometimes an input to something else. Check before you change its structure:

- Search the tests, scripts and site source for code that reads the file: a docs page that renders the README's
  install steps, a test that compares its code blocks, a tier list that maps the file to a CI job.
- Keep every heading, anchor and fenced block those readers depend on, and verify it after the rewrite with a script
  that compares the old and new files, since a read-through misses a changed character.
- Check that every link you add points at an anchor or route that exists.
- Follow the repo's conventions (serial comma, spelling, quote style) even where they differ from yours.

## Report

Lead with the verdict in one sentence, then:

1. **What to cut or move**, as patterns, each with one quoted example from the page.
2. **Per page**, the changes in priority order. Name the section and say where it should go.
3. **Where a visual would help**, each with what it would show.
4. **What you read and what you didn't.**

Give rewrites as text the reader can compare, with the word count before and after and the count of words before the
install command. Say what the rewrite moves, since moved content is the part a reviewer most needs to find again.

## When you wrote the page

A check of your own draft confirms only that the published file matches it. Say so, and leave the review to the
reader: show the rendered page, since a passing build doesn't show how it reads.

## Making it stick

When a repo has no writing rules and the review found real problems, offer to add the Order list and the Density
rules to its `CONTRIBUTING.md` under a Writing heading, with two or three before-and-after pairs taken from the
repo's own pages. Rules kept beside the docs are read by everyone who edits them. Don't add a lint for this: a script
can't check order or density.
