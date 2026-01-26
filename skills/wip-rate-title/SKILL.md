---
name: rate-title
description: AI-assisted session title rating. The model judges the title first, then you confirm or correct. Builds a golden dataset for DSPy optimization of both judge and journalist prompts.
license: Apache-2.0
status: wip
---

# Rate Session Title

Interactive title rating with AI judge assessment + human calibration.

## Purpose

Build a training dataset for DSPy to optimize:
1. **Judge prompt** - learns to rate titles like you do
2. **Journalist prompt** - learns to generate titles you rate highly

## Workflow

When `/rate-title` is invoked:

### Step 1: AI Judge Assessment

Read the current session context and generated title, then provide:
- **Score (1-5)**: How well does this title capture the session?
- **Reasoning**: Why this score? What's good/bad about it?
- **Proposed Title**: What would be a better title? (even if score is 5, suggest alternative)

### Step 2: Human Calibration

Present the AI assessment to the user and ask:
- Do you agree with this assessment?
- If not, what's your score and reasoning?
- Do you have a better title suggestion?

### Step 3: Record Both Perspectives

Save to `~/.claude/title-feedback/scored.jsonl`:
- AI judge: score, reasoning, proposed title
- Human: score, reasoning (if disagreed), proposed title
- `agreedWithJudge` flag for quick filtering

## Rating Scale

| Score | Meaning | Example |
|-------|---------|---------|
| 5 | Perfect | Captures session precisely, actionable |
| 4 | Good | Accurate, minor phrasing improvements possible |
| 3 | Okay | Serviceable but generic or slightly off |
| 2 | Poor | Misses the main point or too vague |
| 1 | Wrong | Completely off-base or misleading |

## Judge Prompt

When assessing a title, consider:
- Does it capture the PRIMARY goal of the session?
- Is it specific enough to distinguish from other sessions?
- Does it use active voice? ("Fix X" not "Fixing X" or "X was fixed")
- Does it avoid meta-language? (no "User wants", "Session about")
- Is it 4-7 words? (concise but descriptive)

## Example Interaction

```
Current title: "Fix OAuth redirect loop"
Context: Project dotclaude, branch feat/auth-fix
Primary request: "The OAuth callback keeps redirecting infinitely..."

AI JUDGE ASSESSMENT:
Score: 4/5
Reasoning: Good active voice, specific to the problem. Could mention
  "callback" since that's where the actual fix happened.
Proposed: "Fix OAuth callback redirect loop"

Do you agree? [y/n/score]:
> n

Your score (1-5): 5
Reasoning (optional): The original is fine, "callback" is implied.
Better title (optional):

Saved! Disagreement recorded for training.
Stats: 23 pending, 156 scored (12 disagreements)
```

## Data Schema

```typescript
interface TitleFeedback {
  context: { projectName, gitBranch, primaryRequest, ... };
  generatedTitle: string;

  judgeAssessment: {
    score: number;
    reasoning: string;
    proposedTitle: string;
    judgePromptVersion: string;
  };

  humanAssessment: {
    score: number;
    reasoning?: string;
    proposedTitle?: string;
    agreedWithJudge: boolean;
  };
}
```

## DSPy Training

The dataset enables:
- **Judge optimization**: Train judge to predict human scores
- **Title optimization**: Learn patterns from high-scoring titles
- **Disagreement analysis**: Cases where AI != human reveal prompt gaps
