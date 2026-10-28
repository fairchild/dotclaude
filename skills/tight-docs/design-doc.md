# Design doc

## Purpose
A design doc gets a decision made on how to build something before anyone builds it. It names the problem, picks one approach, shows why that approach beats the alternatives, and says what happens next. It is not a spec, a tutorial, or a code walkthrough. The reader is a reviewer with ten minutes who has to approve, push back, or ask one sharp question.

## Output format
Section caps are in words (heading line excluded). The soft rule in SKILL.md applies to every cap.

```
# <Title>
Status: draft | in review | approved   Owner: <name>   Date: <YYYY-MM-DD>

## TL;DR                      (60)
- Problem:
- Proposal:
- Ask: what you need from the reader

## Problem                    (120)
What's broken or missing, with evidence: a metric, an incident, or a user report.

## Proposal                   (200)
The approach: its shape, its boundaries, and the main components.
Spine: claim = the approach; evidence = the constraint that forces each boundary; each boundary is a decision. Skip stack trivia with no evidence.

## Why this approach          (150)
Evidence that it works better than the alternatives.

## Alternatives considered    (120)
List section: one or two lines each — the option (claim) and why you didn't pick it (evidence).

## Risks and open questions   (100)
Each one with an owner, or "accepted".

## Next steps                 (60)
Who does what, and by when.
```

## Anti-patterns
- **Restating requirements.** Don't copy the ticket or the PRD. Link to it and state only what changes the design.
- **Explaining how code works.** Describe behavior and boundaries, not lines of code. If a reviewer needs the code, link to the file.
- Background sections that recount history nobody needs to make the decision.
- "Goals and non-goals" lists that restate the proposal in other words.
- Alternatives that were never real options, added to look thorough.
- **Stack-as-filler.** Naming language, framework, or repo layout with no constraint that forces the choice.

## Worked example

**Bloated (97 words):**
> In this section we will describe the caching approach. As mentioned in the requirements, the API is currently slow. Users have reported that it is slow, and this is a problem that we need to solve. There are many ways we could address this. After careful consideration, we believe that adding a cache could potentially be a good way to improve performance. The cache would store responses so that they don't have to be recomputed each time, which would make things faster. We will use Redis, which is a popular in-memory data store that many companies use.

**Tight (40 words):**
> p95 latency on `/search` is 1.8 s, and 70% of requests repeat a query from the last hour. We'll cache responses in Redis with a 1-hour TTL. Expected p95 is under 300 ms. Next step: load-test on staging this Friday.

What was cut: the announcement, the restated requirement, the hedging, and the definition of Redis. What was added: the evidence (latency and repeat rate), the decision (TTL), and the next step.

## Soft-rule flagging
Use the flag from SKILL.md. Proposal is the section most often justified in going over its cap, for example when there are several components. Alternatives and Background almost never are. Trim those first. Count with a tool before handoff.
