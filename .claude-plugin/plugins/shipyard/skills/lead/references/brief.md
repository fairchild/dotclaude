# The brief

An implementer reads this and nothing else. It has no memory of the lead's conversation, no sight
of the queue, and no way to ask a question without costing a round trip. Everything it needs is
here, and everything here it will act on — so a sentence you did not mean becomes work you did not
want.

```markdown
## Task

<One paragraph: what to build, and what it is for. The "for" is not decoration — an implementer
that knows the purpose makes the small decisions the brief does not cover in the right direction.>

## Done looks like

- `<command>` passes.
- <A behavior that holds, stated so it can be checked: given this input, this output.>
- <A file that exists, with named content.>

## Where

- `<path>` — <what changes here>
- `<path>` — <what changes here>
- Worktree: `<path>`. Work there and nowhere else.

## Out of scope

- <The adjacent thing that will be tempting.> Found a problem there? Name it in the pull request;
  don't fix it.
- <Another.>

## Already ruled out

- <Approach> — <why it failed, concretely enough not to be re-tried.>

## The gate

`<gate command from the config file>` must pass before the pull request opens. `<test command>`
for the touched tests.

## Reporting

Open the pull request against `<base>`, fill the repository's template, and report the number and
the head SHA. Do not merge. Do not apply the review label — the lead does that.
```

## What makes a brief go wrong

**A scope boundary that is implied rather than written.** "Add the retry" with no out-of-scope line
gets you the retry, a refactor of the thing being retried, and a logging change. None of it is
wrong; all of it is in one pull request.

**A done condition that cannot be checked.** "Works correctly", "is clean", "handles errors
properly" — each sends the implementer to invent its own standard, and the reviewer then finds
findings against a standard nobody stated.

**A brief that needs the lead's conversation to make sense.** "The approach we settled on", "as
discussed", "the usual pattern". The implementer has none of that. Write the approach.

**A brief longer than a page.** That is two tasks, or a design question. Split it or stop.
