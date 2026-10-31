---
name: tight-docs
description: >-
  Use this when a coding agent writes or revises a design doc, a security
  review, or an ADR (an architecture decision record) and the doc must be tight:
  short sections, no filler, and every claim backed by evidence.
license: Apache-2.0
---
# Tight docs

Shared rules for every doc type. Load the reference file for the type you're writing:
- Design doc: `design-doc.md`
- Security review: `security-review.md`
- ADR: `adr.md`. Load it only when the user asks for an ADR.
- Scoring a finished doc: `rubric.md`

## The spine
Every section, and the doc as a whole, follows this order:
1. **Claim.** What's true or what you propose, in one sentence.
2. **Evidence.** The specific fact, measurement, file, or incident that backs it.
3. **Decision.** What you're choosing because of it.
4. **Next step.** Who does what next. Leave it out only when nothing follows.

If a paragraph has no claim, cut it. If a claim has no evidence, mark it `(unverified)` or cut it.

**List sections** (Assets, Trust boundaries, Alternatives considered, and similar inventories): each bullet is claim + evidence inline. The section does not need its own decision or next-step line; those live in Findings, Residual risk, or Next steps.

**Proposal sections** (design Proposal, ADR Decision): the claim is the approach; evidence is the constraint or measurement that forces a boundary; each boundary you state is a decision.

## Hard length budget
- The doc's TL;DR is 3 bullets or 60 words at most.
- A normal section is 150 words at most.
- A list is 7 items at most. If you need more, group them.
- Each reference file sets its own section caps, and those override these defaults.

**Count with a tool, not by eye.** Before you hand the doc over, count words in every capped section (and every security finding) with a script or editor word count. The budget is a ceiling, not a target. Heading lines do not count; required field labels (`Asset:`, `Where:`, …) do.

## Sentence-level trim rule
Every sentence has to earn its place against the sentence before it. Delete it if it:
- restates the sentence before it,
- announces what comes next ("This section describes..."),
- hedges without adding information ("It may be worth noting that..."),
- explains something the audience already knows.

Do one pass that does nothing but delete sentences. Then do a second pass that cuts words inside the sentences that are left.

## Soft rule: over-cap sections
This is a soft rule, not a hard block.
1. When a section goes over its cap, add a flag at the top of that section: `> OVER CAP (N/cap words): reflect and trim.`
2. Reread the section against the trim rule and cut what you can.
3. If it's still over the cap and the length is justified, keep the flag and replace the note with one line saying why: `> OVER CAP (N/cap words), kept because: <reason>.`
4. List every remaining flag for the user in your final message and ask for explicit sign-off. The doc isn't done until the user approves each kept flag or you trim the section under its cap.

## Before you hand it over
- The TL;DR is within its budget, and someone who reads only the TL;DR can act on it.
- Every section follows the spine (list sections: per-bullet claim+evidence).
- No sentence fails the trim rule.
- Every capped section and finding was word-counted with a tool.
- Every over-cap flag is either trimmed away or listed for sign-off.
