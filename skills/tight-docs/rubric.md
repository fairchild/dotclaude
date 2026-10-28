# Tight-docs rubric

Use this to score a doc written with the tight-docs skill: a design doc, security review, ADR, project plan, or engineering doc. It works for a human judge or an LLM judge.

## How to score
1. Read the doc once, top to bottom, without scoring.
2. Score each dimension from 1 to 5 using the anchors below. Use the mid anchors; do not invent a 3 that means "I am unsure".
3. For each score, quote or point at one piece of evidence from the doc: a sentence, a section name, or a word count.
4. Report in the output format at the end. Don't average the scores into a single grade unless you're asked to.

## Word-count rules (shared with the skill)
- Count the section body only. Exclude the heading line and any `> OVER CAP` flag line.
- Include field labels (`Asset:`, `Where:`, …) and inline code.
- For Findings, score each `###` finding against the per-finding cap.

## Dimensions

### 1. Brevity
- **1:** Padded and repetitive. Sentences restate each other, announce what's coming, or hedge.
- **2:** Several disposable sentences; a trim pass would remove a paragraph or more.
- **3:** Acceptable, with clear room to cut. At least one sentence fails the trim rule.
- **4:** Nearly tight. At most one weak sentence or clause; deleting it loses little.
- **5:** Every sentence carries new information. Removing any sentence would lose something.
- Check: find the weakest sentence. If deleting it loses nothing, score ≤4. If two or more such sentences, score ≤3.

### 2. Spine adherence
- **1:** Sections drift from claim, evidence, decision, next step. Claims have no evidence, and no decision is stated.
- **2:** Most sections lack either evidence or a decision; only one or two sections are complete.
- **3:** About half the sections show claim+evidence; others are description-only.
- **4:** Nearly all sections (or bullets, for list sections) show claim+evidence; at most one gap.
- **5:** That order is obvious throughout — section-level for prose sections, per-bullet for list sections (Assets, Trust boundaries, Alternatives).
- Check: for each prose section, name its claim and its evidence. For each list section, spot-check two bullets. Each prose section or list section that fails costs a point from 5 (floor 1).
- Do not penalize list sections for missing a section-level decision line.

### 3. Anti-pattern avoidance
- **1:** 5 or more violations from the doc type's anti-pattern list.
- **2:** 3 or 4 violations.
- **3:** 2 violations.
- **4:** 1 violation.
- **5:** None.
- Check: list each violation and name which anti-pattern it is. Ignore anti-patterns not in that doc type's reference file.

### 4. Flag accuracy
- **1:** Long sections went unflagged, or short sections got false flags (net 4+ errors).
- **2:** 3 errors (miss, false flag, or kept flag missing from sign-off).
- **3:** 2 errors.
- **4:** 1 error.
- **5:** Every over-cap section/finding is flagged correctly, and every kept flag is routed for sign-off — or the doc has no over-cap sections and no flags.
- Check: count words per the Word-count rules above. Compare to the cap in the matching reference file (v0: findings 40; v1: findings 60). Each miss, false flag, or kept flag left out of the sign-off list is one error.

### 5. Usefulness
- **1:** A reader is still lost after one pass and can't say what was decided or what to do.
- **2:** Decision or ask is buried below the fold; TL;DR alone is not actionable.
- **3:** TL;DR states a topic but not a concrete decision or ask.
- **4:** TL;DR yields the decision or the ask, but not both clearly.
- **5:** The decision is clear in the first lines. A reader of the TL;DR alone could act on it (decision and ask both recoverable).
- Check: after reading only the TL;DR, write down the decision and the ask. If either is missing, score ≤4. If both are missing, score ≤3.

## Output format
```
Doc: <title>   Type: <design doc | security review | ADR | plan | other>
Brevity:            <1-5>  <evidence>
Spine adherence:    <1-5>  <evidence>
Anti-patterns:      <1-5>  <violations found, or "none">
Flag accuracy:      <1-5>  <section: words/cap, flagged? correct?>
Usefulness:         <1-5>  <decision and ask, as read from the TL;DR>
Weakest dimension:  <name>, and the one change that would raise it most
```
