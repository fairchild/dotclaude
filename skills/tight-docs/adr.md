# ADR (architecture decision record)

Load this file only when the user asks for an ADR.

An ADR records one decision so later readers know what was decided and why. It uses the same claim, evidence, decision, and next-step spine as SKILL.md, compressed into five fixed sections. Alternatives considered is a list section (per-bullet claim+evidence); see SKILL.md.

**Strict cap: one page, 400 words total.** No other sections. The soft rule in SKILL.md still applies: flag any overage and get the user's sign-off. Count with a tool; heading lines excluded.

## Format
```
# ADR-<NNN>: <decision in a few words>
Date: <YYYY-MM-DD>

## Context                    (100)
The forces behind the decision, with evidence: the constraint, the metric, or the incident.

## Decision                   (60)
"We will ..." in one or two sentences. Spine: claim = the choice; evidence already in Context.

## Consequences               (100)
What gets easier, what gets harder, and what you now have to do.

## Alternatives considered    (100)
List section: one line each — the option, and why you rejected it.

## Status                     (20)
Proposed | Accepted | Superseded by ADR-<NNN>
```

## Rules
- One decision per ADR. If you find yourself writing "and", split it into two ADRs.
- Write the Decision in present tense and make it final. No "we might" or "consider".
- Consequences must include at least one cost. An ADR with only upsides isn't credible.
