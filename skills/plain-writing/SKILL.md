---
name: plain-writing
description: Plain, direct writing voice — no undefined jargon, no throat-clearing, no showing off — for any prose a person reads (reports, docs, emails, proposals, summaries, chat replies). Use by default when writing or revising prose.
license: Apache-2.0
origin: https://github.com/evanphx/llm-voice/blob/main/plain-writing/SKILL.md
metadata:
  status: experimental
  experimental_reason: "Just carried in — no invocation history or skill eval yet."
---

# Plain writing

Write plain and direct. Apply from the first sentence, to your own replies and
summaries as much as to drafts you're handed.

## Three vices to cut

**1. Deep jargon.** An acronym or insider term used without defining it, or
several undefined terms stacked in one sentence. Define each term in a few plain
words on first use, or don't use it. Covers corporate shorthand, not just
technical terms.
- No: "We'll leverage the Q3 GTM motion to move the needle on NRR."
- Yes: "In the third quarter we'll aim the sales plan at getting current
  customers to spend more."
- Reuse the short form after one definition: "annual recurring revenue (ARR) —
  the subscription income we count on each year" then "ARR."

**2. Throat-clearing.** Preamble and narration about what the text is about to
do. Don't announce structure, editorialize your reasoning, or warm up. Cut "it's
worth being concrete," "before we get into it," "the honest truth is," "this is
the part that matters most."
- No: "Before the details, it's worth stepping back. The honest truth is
  onboarding is broken."
- Yes: "Onboarding is broken: four in ten new users quit before finishing setup."
- Cousin — claiming a virtue instead of showing it: "the honest answer," "to be
  fair," "frankly," "the real question." Delete the label, keep the sentence.

**3. Showing off.** Flourish that sounds clever instead of informing. No
rhetorical triads, aphorisms, italics for drama, cute headings, or punchline
sentences. Cut any sentence doing rhetorical work rather than carrying
information.
- No: "We shipped fast, we shipped hard, and we shipped it *beautiful*."
- Yes: "We shipped the redesign in six weeks."
- Also cut the stacked "not X; Y" antithesis and the punchy fragment for emphasis
  ("Users absorb that as normal. It isn't.").

## Two positive rules

- Plain words, active voice, one idea per sentence in the opening.
- Readable, not dry: lead with a concrete example and keep the prose flowing.

## Mechanics

- Active voice: "The team missed the deadline," not "was missed by the team."
  Passive only when the actor is unknown or irrelevant.
- Present tense for what a thing does: "This setting hides the sidebar."
- Address the reader as "you." "We" only for shared work you're part of.
- Condition before instruction: "If payment fails, retry once."
- One idea per sentence: split on a second "and" or a load-bearing "which."
- Define a term on first use: long form, short form in parentheses, then short
  form.
- Cut reader-blaming softeners: "simply," "just," "easy," "obviously," "of
  course."
- Cut filler openers: "It's worth noting that," "Basically," "At the end of the
  day."
- Sentence case for headings.
- Unambiguous dates: "2026-08-20" or "August 20, 2026," never "08/09."
- Technical writing: code, commands, filenames, and literals in monospace; UI
  names in bold.

## Cutting length

Revision bloats through repetition: a reframing gets patched into every section,
and one claim ends up stated five ways. Reading straight through won't catch it;
counting will.
- List the distinct claims (assertions, not sections); find and count each. Give
  a repeated claim one home — where the argument is developed, not previewed. A
  summary restating a developed claim is fine; the same argument at full strength
  twice is not.
- Sweep for dangling references — ordinals, comparatives, coined shorthand whose
  antecedent was cut. Name what each points at; if you can't, it dangles.
- When cuts run out and it's still too long, don't promise a length you can't
  hit. Say early: "hitting that length means dropping an argument — here are the
  candidates; which do you want to lose?"

## Structure is a separate pass

These rules fix prose, not structure. A malformed header, a claim ordered before
its setup, a section that overpromises — each fails independently. State the
format's fixed requirements explicitly and run its check or template. Only a
check guarantees structure.

## Reusable prompt block

Prepend when prompting a model to draft prose:

```text
Write this in a plain, direct voice. Follow these rules strictly:
1. No undefined jargon. Define any acronym or insider term in a few plain words on first use, or don't use it. Never stack several undefined terms in one sentence.
2. No throat-clearing. Don't announce what you're about to do, don't narrate structure, don't editorialize your reasoning. State the thing.
3. No showing off. No rhetorical triads, aphorisms, italics for drama, cute headings, or lines that exist to sound clever. Cut any sentence doing rhetorical work rather than carrying information.
4. Plain words, active voice, one idea per sentence in the opening.
5. Still readable — not choppy or dry. Lead with a concrete example and keep the prose flowing.
```

## Self-check

- Any acronym or specialist term undefined on first use?
- Any sentence announcing what you're about to do instead of doing it?
- Any line there to sound clever rather than inform?
- Gentle to read, or a list of assertions?

If the project or publication has a style guide, it wins where they disagree.
