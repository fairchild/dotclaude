# Adaptive Session Title Generation System

## BLUF (Bottom Line Up Front)

**Decision point**: Two paths forward, both valid:

| Path | Approach | Best for |
|------|----------|----------|
| **A: Fix & Learn** | Fix extraction now, add learning later | Quick wins, simplicity first |
| **B: Journalist** | Stateful agent follows along | Long sessions, nuanced tracking |

**Recommendation**: Start with **Path A (Fix & Learn)**, but design for journalist compatibility.

### Path A: Three-Phase Implementation

1. **Phase 1** (Now): Fix context extraction, better filtering, static examples
2. **Phase 2** (Next): LanceDB vector memory, feedback collection, dynamic few-shot
3. **Phase 3** (Later): Sonnet quality audits, DSPy prompt optimization

### Path B: Journalist Agent (Alternative)

Inspired by [Letta's memory blocks](https://www.letta.com/blog/memory-blocks):
- Agent maintains 2 memory blocks: `situation` (stable) + `recent_actions` (sliding)
- Updates incrementally as session progresses
- Title always reflects current state, not just initial request

**Key insight**: Don't just generate titles—build a system that *learns* what good titles look like for YOUR workflow.

---

## Problem Statement

Current session title generation suffers from:
1. **Poor context extraction** - Gets "yes" instead of substantive requests
2. **No memory** - Each title generated in isolation
3. **Static prompts** - Same prompt regardless of session type
4. **No feedback loop** - No way to learn from good/bad titles
5. **Title decay** - Evolution makes titles worse, not better

---

## Research Findings

### Context Compression Techniques

From [JetBrains Research](https://blog.jetbrains.com/research/2025/12/efficient-context-management/) and [Mem0](https://mem0.ai/blog/llm-chat-history-summarization-guide-2025):

```
┌─────────────────────────────────────────────────────────────┐
│                 HIERARCHICAL MEMORY MODEL                    │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ TIER 1: Permanent Summary (oldest, compressed)       │   │
│  │ "Session started with CI fix, pivoted to auth"       │   │
│  └──────────────────────────────────────────────────────┘   │
│                          ↓                                   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ TIER 2: Sliding Window (middle, summarized)          │   │
│  │ Last 10-20 messages compressed to key facts          │   │
│  └──────────────────────────────────────────────────────┘   │
│                          ↓                                   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ TIER 3: Recent Context (newest, full detail)         │   │
│  │ Last 3-5 messages verbatim                           │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Key finding**: Keep latest 10 turns full detail, summarize 21 turns at a time for older content. This achieves 3-4x compression while maintaining accuracy ([TechXplore](https://techxplore.com/news/2025-11-ai-tech-compress-llm-chatbot.html)).

### DSPy for Prompt Optimization

From [DSPy Official Docs](https://dspy.ai/learn/optimization/optimizers/) and [Pondhouse Data](https://www.pondhouse-data.com/blog/dspy-build-better-ai-systems-with-automated-prompt-optimization):

```
┌─────────────────────────────────────────────────────────────┐
│                    DSPy OPTIMIZATION LOOP                    │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│   │  Training   │───▶│  Optimizer  │───▶│  Compiled   │     │
│   │   Dataset   │    │  (MIPROv2)  │    │   Program   │     │
│   └─────────────┘    └─────────────┘    └─────────────┘     │
│         │                   │                  │             │
│         │            ┌──────┴──────┐          │             │
│         │            │   Metric    │          │             │
│         └───────────▶│  Function   │◀─────────┘             │
│                      │ (eval score)│                        │
│                      └─────────────┘                        │
│                                                              │
│   Key Optimizers:                                            │
│   • BootstrapFewShot: ~10 examples, generates demos         │
│   • MIPROv2: 200+ examples, Bayesian prompt search          │
│   • SIMBA: Identifies hard cases, self-reflective rules     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Key insight**: DSPy can automatically evolve prompts based on a scoring metric. With our golden dataset, we could periodically optimize the title generation prompt.

### LanceDB for Local Vector Memory

From [LanceDB Continue Case Study](https://lancedb.com/blog/the-future-of-ai-native-development-is-local-inside-continues-lancedb-powered-evolution/):

```
┌─────────────────────────────────────────────────────────────┐
│                   LOCAL VECTOR MEMORY                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   New Session Context                                        │
│   ┌─────────────────┐                                       │
│   │ "Fix CI, auth   │                                       │
│   │  module, pytest"│                                       │
│   └────────┬────────┘                                       │
│            │ embed                                           │
│            ▼                                                 │
│   ┌─────────────────┐     ┌─────────────────────────────┐   │
│   │  Query Vector   │────▶│      LanceDB (local)        │   │
│   │  [0.23, -0.45,  │     │  ~/.claude/vectors/         │   │
│   │   0.12, ...]    │     │                             │   │
│   └─────────────────┘     │  ┌───────────────────────┐  │   │
│                           │  │ Similar Past Sessions │  │   │
│                           │  │ • "Fix pytest CI" (4)  │  │   │
│                           │  │ • "Debug auth flow"(5) │  │   │
│                           │  │ • "CI/CD pipeline" (3) │  │   │
│                           │  └───────────────────────┘  │   │
│                           └─────────────────────────────┘   │
│                                        │                     │
│                                        ▼                     │
│                           ┌─────────────────────────────┐   │
│                           │ Use best titles as examples │   │
│                           │ in few-shot prompt          │   │
│                           └─────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Key insight**: Embed session contexts, find similar past sessions with good titles, use those as few-shot examples. Sub-10ms queries on 1M+ vectors.

---

## Option Analysis

### Option 1: Enhanced Extraction Only (Low Effort)

**What**: Fix context extraction to get substantive messages

```typescript
// Instead of first/last message, get:
interface EnhancedContext {
  substantiveRequest: string;  // Longest user message > 20 chars
  latestActivity: string;      // Most recent non-confirmation
  sessionArc: string;          // "Started with X, now doing Y"
  keyEntities: string[];       // Files, branches, error types
}
```

**Pros**: Quick win, immediate improvement
**Cons**: Still static, no learning
**Effort**: 1 day

### Option 2: Hierarchical Memory (Medium Effort)

**What**: Implement 3-tier memory with compression

```
Session Start ──────────────────────────────────────▶ Now
│                                                      │
├─ OLDEST ────────┼─ MIDDLE ──────────┼─ NEWEST ──────┤
│  Compressed     │  Sliding window   │  Full detail  │
│  summary        │  of key facts     │  last 3 msgs  │
│  (Haiku)        │  (extracted)      │  (verbatim)   │
│                 │                   │               │
└─────────────────┴───────────────────┴───────────────┘
```

**Implementation**:
1. On first message: Store as "initial request"
2. Every N messages: Haiku summarizes middle tier
3. On title request: Combine all tiers into prompt

**Pros**: Captures session evolution, handles topic drift
**Cons**: More API calls, complexity
**Effort**: 2-3 days

### Option 3: Vector Memory + Few-Shot (Medium-High Effort)

**What**: Use LanceDB to find similar past sessions

```typescript
// ~/.claude/vectors/sessions.lance
interface SessionEmbedding {
  id: string;
  context_embedding: Float32Array;  // Embed the context
  title: string;
  human_score: number;  // 1-5 from feedback
  project: string;
}

// On title generation:
const similar = await db.search(embedContext(currentSession))
  .filter("human_score >= 4")
  .limit(3);

const fewShotExamples = similar.map(s => ({
  context: s.context_summary,
  title: s.title
}));
```

**Pros**: Learns from your history, improves over time
**Cons**: Needs embedding model, storage
**Effort**: 1 week

### Option 4: Sonnet Quality Auditor (Medium Effort)

**What**: Periodically use Sonnet to review and improve

```
┌─────────────────────────────────────────────────────────────┐
│                    QUALITY AUDIT LOOP                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   Every N sessions (or on explicit feedback):                │
│                                                              │
│   1. Collect recent titles + contexts                        │
│   2. Sonnet reviews: "Rate these titles 1-5, explain why"    │
│   3. Identify patterns in low-scoring titles                 │
│   4. Sonnet suggests prompt improvements                     │
│   5. Update prompt template for next batch                   │
│                                                              │
│   ┌─────────┐      ┌─────────┐      ┌─────────┐             │
│   │ Recent  │─────▶│ Sonnet  │─────▶│ Prompt  │             │
│   │ Titles  │      │ Review  │      │ Update  │             │
│   └─────────┘      └─────────┘      └─────────┘             │
│                                                              │
│   Trigger conditions:                                        │
│   • Every 50 sessions                                        │
│   • User gives explicit feedback (👍/👎)                     │
│   • Title generation fails 3x in a row                       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Pros**: Smart oversight without high cost
**Cons**: Delayed improvement, not real-time
**Effort**: 3-4 days

### Option 5: DSPy Full Integration (High Effort)

**What**: Use DSPy to automatically optimize prompts

```python
# Define the signature
class TitleGenerator(dspy.Signature):
    """Generate a concise, actionable title for a coding session."""

    context = dspy.InputField(desc="Session context with first message, last activity, files")
    title = dspy.OutputField(desc="4-7 word title, active voice, no meta-language")

# Define the metric
def title_quality(example, pred):
    # Use LLM judge or human score
    return llm_judge_score(example.context, pred.title, example.ideal_title)

# Optimize
optimizer = MIPROv2(metric=title_quality, num_candidates=10)
compiled = optimizer.compile(TitleGenerator(), trainset=golden_dataset)
```

**Pros**: Automated prompt evolution, scientifically rigorous
**Cons**: Python dependency, setup complexity
**Effort**: 2+ weeks

### Option 6: Status Line Feedback Loop (Low Effort, High Value)

**What**: Add occasional feedback prompts to status line

```
┌─────────────────────────────────────────────────────────────┐
│  dotclaude main Opus $0.45 +12 -3 | Fix auth redirect loop  │
│                                                      ⬆️ ⬇️   │
└─────────────────────────────────────────────────────────────┘
      │                                                  │
      │  Occasionally (1 in 20 renders):                 │
      │                                                  │
      ▼                                                  ▼
┌─────────────────────────────────────────────────────────────┐
│  Title: "Fix auth redirect loop" — Good? [y/n/edit]         │
└─────────────────────────────────────────────────────────────┘
```

**Implementation**:
1. Every ~20 status line renders, show feedback prompt
2. y = score 5, n = score 1, edit = provide ideal title
3. Store in golden dataset automatically
4. Feed into DSPy/vector memory for learning

**Pros**: Zero-friction data collection, builds golden dataset
**Cons**: Occasional interruption
**Effort**: 1 day

---

## Recommended Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     ADAPTIVE TITLE GENERATION SYSTEM                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  SESSION                                                                 │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    CONTEXT EXTRACTION                             │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐               │   │
│  │  │  Oldest     │  │  Middle     │  │  Newest     │               │   │
│  │  │  Summary    │  │  Key Facts  │  │  Verbatim   │               │   │
│  │  │  (Haiku)    │  │  (extracted)│  │  (raw)      │               │   │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘               │   │
│  │         └────────────────┼────────────────┘                       │   │
│  │                          ▼                                        │   │
│  │                 ┌─────────────────┐                               │   │
│  │                 │ Combined Context│                               │   │
│  │                 └────────┬────────┘                               │   │
│  └──────────────────────────┼────────────────────────────────────────┘   │
│                             │                                            │
│                             ▼                                            │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    VECTOR MEMORY (LanceDB)                        │   │
│  │                                                                   │   │
│  │   Query: embed(context) ──────▶ Top 3 similar sessions           │   │
│  │                                 with score >= 4                   │   │
│  │                                                                   │   │
│  │   Result: Few-shot examples for prompt                           │   │
│  │                                                                   │   │
│  └──────────────────────────┬───────────────────────────────────────┘   │
│                             │                                            │
│                             ▼                                            │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    TITLE GENERATION (Haiku)                       │   │
│  │                                                                   │   │
│  │   Prompt = DSPy-optimized template                               │   │
│  │          + few-shot from vector memory                           │   │
│  │          + hierarchical context                                  │   │
│  │                                                                   │   │
│  │   Output: "Fix OAuth redirect in auth module"                    │   │
│  │                                                                   │   │
│  └──────────────────────────┬───────────────────────────────────────┘   │
│                             │                                            │
│                             ▼                                            │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    FEEDBACK LOOP                                  │   │
│  │                                                                   │   │
│  │   Status Line: [title] 👍/👎?                                    │   │
│  │                    │                                              │   │
│  │                    ▼                                              │   │
│  │   Store: { context, title, score } ──▶ LanceDB                   │   │
│  │                                           │                       │   │
│  │                                           ▼                       │   │
│  │   Every 50 sessions: ┌─────────────────────────┐                 │   │
│  │                      │  Sonnet Quality Audit   │                 │   │
│  │                      │  • Review low scores    │                 │   │
│  │                      │  • Suggest improvements │                 │   │
│  │                      │  • Update prompt        │                 │   │
│  │                      └─────────────────────────┘                 │   │
│  │                                           │                       │   │
│  │   Every 200 sessions: ┌─────────────────────────┐                │   │
│  │                       │  DSPy Optimization      │                │   │
│  │                       │  (if enough examples)   │                │   │
│  │                       └─────────────────────────┘                │   │
│  │                                                                   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Recommendation: Start Small, Design for Full Vision

**Do this**: Implement Phase 1 now, but design every component to plug into the full system later.

The key insight is that each phase *prepares* for the next:
- Phase 1 fixes the data quality problem (garbage in → garbage out)
- Phase 2 uses that clean data to build memory
- Phase 3 uses memory + feedback to optimize

Starting with Phase 2/3 without Phase 1 would train on bad data. Starting Phase 1 without designing for Phase 2/3 would require rework.

---

## Implementation Phases (Detailed)

### Phase 1: Foundation — "Get the basics right"

**Goal**: Fix the immediate problems so titles are useful *today*, while laying groundwork for learning.

**Duration**: 1-2 days

#### Task 1.1: Fix Context Extraction (Critical)

**Problem**: Currently captures "yes" instead of substantive requests.

**Solution**: Multi-pass extraction that finds the *best* message, not just first/last.

```typescript
// ~/.claude/scripts/generate-session-title-testable.ts

interface EnhancedContext {
  // PRIMARY: The most substantive request
  primaryRequest: string | null;  // Longest non-trivial user message

  // SECONDARY: Recent activity
  latestActivity: string | null;  // Most recent non-confirmation message

  // SIGNALS: Quick context
  gitBranch: string | null;
  modifiedFiles: string[];        // Top 5 files touched
  projectName: string;

  // METADATA: For future learning
  messageCount: number;
  sessionDuration: number;        // Minutes between first/last message
}

function extractEnhancedContext(transcriptPath: string): EnhancedContext {
  // 1. Filter: Skip messages that are:
  //    - < 15 chars
  //    - Start with "<" (system tags)
  //    - Match confirmation patterns: /^(yes|no|ok|sure|thanks|got it)/i

  // 2. Find primary: Longest qualifying message from first 10 user turns

  // 3. Find latest: Most recent qualifying message

  // 4. Extract signals: Branch from first gitBranch, files from Edit/Write tools
}
```

**Files to modify**:
- `~/.claude/scripts/generate-session-title-testable.ts` — Core extraction logic
- `~/.claude/scripts/generate-session-title.test.ts` — Add test cases for edge cases

**Test cases to add**:
- [ ] Session with "yes" as first message → finds later substantive message
- [ ] Session with `<system_instruction>` wrapper → parses through it
- [ ] Very short session (2 messages) → uses what's available
- [ ] Session with only confirmations → falls back to branch/files/project

#### Task 1.2: Smarter Message Filtering

**Problem**: Conductor app wraps first message in `<system_instruction>` tags.

```typescript
function extractUserText(content: string | ContentBlock[]): string | null {
  let text = typeof content === "string"
    ? content
    : content.find(c => c.type === "text")?.text;

  if (!text) return null;

  // Strip system instruction wrappers
  text = text.replace(/<system_instruction>[\s\S]*?<\/system_instruction>/g, "").trim();

  // Skip trivial responses
  if (text.length < 15) return null;
  if (/^(yes|no|ok|sure|thanks|got it|sounds good|please|do it)/i.test(text)) return null;

  return text;
}
```

#### Task 1.3: Improve Prompt with Static Examples

**Problem**: Current prompt lacks good examples.

**Solution**: Add 3-5 hardcoded examples of ideal titles.

```typescript
const TITLE_EXAMPLES = `
Examples of good titles:
- "Fix OAuth redirect loop" (from session about auth debugging)
- "Add rate limiting to API" (from session about API improvements)
- "Debug flaky pytest CI" (from session about test failures)
- "Refactor user settings page" (from session about settings UI)

Bad titles to avoid:
- "Session about fixing things" (meta-language)
- "Working on code" (too vague)
- "User wants to update auth" (meta-language + vague)
`;
```

#### Task 1.4: Design Data Schema for Future Learning

**Problem**: Need to store context + title + feedback for Phase 2/3.

**Solution**: Define schema now, start collecting data.

```typescript
// ~/.claude/title-feedback/schema.ts

interface TitleFeedback {
  id: string;                    // Hash of session ID + project
  timestamp: string;             // ISO date

  // Input
  context: EnhancedContext;      // What we extracted

  // Output
  generatedTitle: string;        // What Haiku produced

  // Feedback (collected later)
  humanScore?: number;           // 1-5 from user
  idealTitle?: string;           // User's correction

  // Metadata for analysis
  promptVersion: string;         // Track which prompt produced this
  modelUsed: string;             // "haiku-3.5" etc.
}
```

**Create**: `~/.claude/title-feedback/` directory structure
- `pending.jsonl` — Titles awaiting feedback
- `scored.jsonl` — Titles with human scores
- `schema.ts` — Type definitions

#### Task 1.5: Add Simple Feedback Command

**Solution**: Add `/rate-title` command that:
1. Shows current title
2. Asks for score (1-5)
3. Optionally accepts better title
4. Saves to `scored.jsonl`

```bash
# Usage
/rate-title           # Rate most recent session
/rate-title 4         # Quick rating
/rate-title 3 "Better title here"  # Rating + correction
```

**File**: Create `~/.claude/skills/rate-title/SKILL.md`

---

### Phase 2: Memory Layer — "Learn from history"

**Goal**: Use past sessions to improve future titles through vector similarity and feedback.

**Duration**: ~1 week

**Prerequisite**: Phase 1 complete (clean data to learn from)

#### Task 2.1: Integrate LanceDB

**Why LanceDB**:
- Native TypeScript/JavaScript support
- Local-first (no server)
- Sub-10ms queries on 1M+ vectors
- Lance columnar format (efficient storage)

```typescript
// ~/.claude/scripts/title-memory.ts
import * as lancedb from "@lancedb/lancedb";

interface SessionVector {
  id: string;
  context_text: string;          // Raw context for display
  vector: Float32Array;          // Embedded context
  title: string;
  score: number;                 // Human rating 1-5
  project: string;
  created_at: string;
}

const db = await lancedb.connect("~/.claude/vectors");
const sessions = await db.openTable("sessions");

// On title generation: find similar past sessions
const similar = await sessions
  .search(embedContext(currentContext))
  .filter("score >= 4")
  .limit(3)
  .toArray();
```

#### Task 2.2: Choose Embedding Strategy

**Options**:

| Approach | Pros | Cons | Cost |
|----------|------|------|------|
| OpenAI text-embedding-3-small | Best quality, easy | API dependency | ~$0.02/1M tokens |
| Ollama + nomic-embed-text | Local, free | Setup, slower | $0 |
| Anthropic voyage-lite-02 | Same vendor | API dependency | ~$0.01/1M tokens |

**Recommendation**: Start with OpenAI (simple), migrate to Ollama if cost becomes issue.

#### Task 2.3: Build Feedback Collection into Status Line

**Implementation**: Occasionally (1 in 20 renders), add feedback prompt.

```bash
# Normal render
dotclaude main Opus $0.45 | Fix OAuth redirect loop

# Occasional feedback prompt (1 in 20)
dotclaude main Opus $0.45 | Fix OAuth redirect loop  [👍/👎?]
```

User presses:
- `y` → Score 5, save to `scored.jsonl`
- `n` → Score 1, prompt for better title
- `e` → Edit mode, provide ideal title

#### Task 2.4: Dynamic Few-Shot Examples

Replace static examples with similar past sessions:

```typescript
async function generateTitleWithMemory(ctx: EnhancedContext): Promise<string> {
  // 1. Embed current context
  const embedding = await embed(contextToText(ctx));

  // 2. Find similar high-scoring sessions
  const similar = await sessions
    .search(embedding)
    .filter("score >= 4")
    .limit(3)
    .toArray();

  // 3. Build prompt with dynamic examples
  const examples = similar.map(s =>
    `Context: "${s.context_text.substring(0, 100)}..."\nTitle: "${s.title}"`
  ).join("\n\n");

  // 4. Generate with enriched prompt
  return callHaiku(buildPrompt(ctx, examples));
}
```

---

### Phase 3: Learning Layer — "Continuous improvement"

**Goal**: Automated prompt optimization and quality auditing.

**Duration**: 2+ weeks (ongoing refinement)

**Prerequisite**: Phase 2 complete (50+ scored examples)

#### Task 3.1: Periodic Sonnet Quality Audits

**Trigger**: Every 50 new sessions OR on explicit request.

```typescript
// ~/.claude/scripts/quality-audit.ts

async function runQualityAudit() {
  // 1. Collect last 50 sessions with titles
  const recent = await getRecentSessions(50);

  // 2. Ask Sonnet to review
  const audit = await callSonnet(`
    Review these session titles for quality.

    For each, rate 1-5 and explain issues:
    ${recent.map(s => `Context: "${s.context}"\nTitle: "${s.title}"`).join("\n---\n")}

    Then identify patterns in low-scoring titles and suggest prompt improvements.
  `);

  // 3. Save audit results
  await saveAuditReport(audit);

  // 4. Optionally auto-update prompt template
  if (audit.suggestedChanges) {
    await proposePromptUpdate(audit.suggestedChanges);
  }
}
```

#### Task 3.2: Prompt Versioning

Track which prompt version generated each title:

```typescript
const PROMPT_VERSION = "v2.1";  // Increment on changes

interface TitleGeneration {
  // ... existing fields
  promptVersion: string;
  promptHash: string;  // SHA of actual prompt text
}
```

This enables A/B analysis: "Did v2.1 perform better than v2.0?"

#### Task 3.3: DSPy Integration (Optional, Advanced)

**If Phase 3.1-3.2 aren't enough**, add systematic prompt optimization:

```python
# ~/.claude/scripts/optimize-prompt.py
import dspy

class TitleGenerator(dspy.Signature):
    """Generate a concise, actionable session title."""
    context = dspy.InputField()
    title = dspy.OutputField()

# Load scored examples
trainset = load_scored_examples("~/.claude/title-feedback/scored.jsonl")

# Define quality metric
def title_quality(example, pred):
    # Use existing LLM judge from eval framework
    return llm_judge(example.context, pred.title, example.ideal_title)

# Optimize
optimizer = dspy.MIPROv2(metric=title_quality, num_candidates=10)
compiled = optimizer.compile(TitleGenerator(), trainset=trainset)

# Export optimized prompt for TypeScript
export_prompt(compiled, "~/.claude/prompts/title-v3.txt")
```

**When to add DSPy**:
- 200+ scored examples accumulated
- Quality audits show consistent patterns
- Manual prompt tweaking isn't improving scores

---

### Phase Summary

```
Phase 1 (Now)              Phase 2 (Next)           Phase 3 (Later)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Fix extraction      ──▶    Add vector memory   ──▶    Sonnet audits
Better filtering           LanceDB setup             Prompt versioning
Static examples            Dynamic few-shot          DSPy optimization
Feedback schema            Feedback collection       A/B testing
/rate-title cmd            Status line prompts       Auto-refinement

Outcome:                   Outcome:                  Outcome:
Titles are useful          Titles improve with       System evolves
TODAY                      YOUR history              autonomously
```

---

## Alternative: Letta-Style Memory Blocks ("The Journalist" Agent)

### Research Findings

[Letta](https://www.letta.com/blog/memory-blocks) (formerly MemGPT) pioneered a compelling approach: **agents that manage their own memory** through structured "memory blocks."

Key concepts from [Letta's architecture](https://docs.letta.com/guides/agents/memory-blocks/):

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    LETTA MEMORY BLOCK ARCHITECTURE                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   Each BLOCK has:                                                        │
│   ┌────────────────────────────────────────────────────────────────┐    │
│   │  label: "session_situation"     // Unique identifier           │    │
│   │  description: "High-level context about what user is doing"    │    │
│   │  value: "User is debugging OAuth redirect issues in..."       │    │
│   │  limit: 500                     // Character budget            │    │
│   └────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│   Agent TOOLS for self-editing:                                          │
│   • memory_replace(label, new_value)  — Overwrite block                 │
│   • memory_insert(label, text)        — Append to block                 │
│   • memory_rethink(label)             — Summarize/compress block        │
│                                                                          │
│   Blocks are:                                                            │
│   • Persisted in DB (survive restarts)                                  │
│   • Shareable across agents                                             │
│   • Optionally read-only                                                │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### The "Journalist" Agent Concept

Instead of extracting context and generating titles *after* the fact, what if we had a **stateful agent that follows along** during the session?

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     THE JOURNALIST AGENT                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   "I am a silent observer, keeping notes as the session unfolds.        │
│    I maintain two memory blocks:"                                        │
│                                                                          │
│   ┌──────────────────────────────────────────────────────────────────┐  │
│   │  BLOCK: situation                                                 │  │
│   │  ──────────────────────                                          │  │
│   │  "The user started this session to fix OAuth redirect issues     │  │
│   │   in the authentication module. They've identified the root      │  │
│   │   cause as a missing state parameter. Current focus: updating    │  │
│   │   the redirect handler."                                         │  │
│   │                                                                   │  │
│   │  [Updated when: major topic shift, goal achieved, new problem]   │  │
│   └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│   ┌──────────────────────────────────────────────────────────────────┐  │
│   │  BLOCK: recent_actions                                            │  │
│   │  ──────────────────────                                          │  │
│   │  "Last 3 actions:                                                 │  │
│   │   1. Read auth/redirect.ts to understand flow                    │  │
│   │   2. Edited redirect handler to preserve state param             │  │
│   │   3. Running tests to verify fix"                                │  │
│   │                                                                   │  │
│   │  [Updated: every N messages, rotating window]                    │  │
│   └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│   When asked for a title:                                                │
│   → Reads both blocks                                                   │
│   → Generates title from situation + recent focus                       │
│   → Example: "Fix OAuth state param in redirect handler"               │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Two-Level Prompt Structure

The user's insight: prompts should have **two levels** reflecting how a journalist would think:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  LEVEL 1: Situation & Goal (stable, compressed)                         │
│  ─────────────────────────────────────────────────────────────────────  │
│  "What is this session fundamentally about?"                            │
│                                                                          │
│  Updates: Rarely (on major pivots)                                      │
│  Content: 1-2 sentences capturing the core mission                      │
│  Example: "Debugging authentication flow, specifically OAuth redirect"  │
├─────────────────────────────────────────────────────────────────────────┤
│  LEVEL 2: Latest Actions (dynamic, sliding)                             │
│  ─────────────────────────────────────────────────────────────────────  │
│  "What just happened? What's the current focus?"                        │
│                                                                          │
│  Updates: Frequently (every few messages)                               │
│  Content: Last 3-5 concrete actions                                     │
│  Example: "Editing redirect.ts, added state parameter validation"       │
└─────────────────────────────────────────────────────────────────────────┘
```

### Comparison: Extraction vs. Journalist

| Aspect | Current (Extract after) | Journalist (Follow along) |
|--------|------------------------|---------------------------|
| **When** | On-demand, after session | Continuous, during session |
| **How** | Parse transcript, guess context | Agent observes, takes notes |
| **Quality** | Depends on extraction heuristics | Agent understands context |
| **Cost** | One Haiku call per title | Occasional Haiku updates |
| **State** | Stateless | Stateful (memory blocks) |
| **Shift detection** | Heuristic (message hash) | Agent judges significance |

### Implementation Sketch

```typescript
// ~/.claude/scripts/journalist-agent.ts

interface MemoryBlock {
  label: string;
  description: string;
  value: string;
  limit: number;  // Character budget
  updatedAt: string;
}

interface JournalistState {
  blocks: {
    situation: MemoryBlock;      // High-level context
    recent_actions: MemoryBlock; // Sliding window
    title_draft: MemoryBlock;    // Current best title
  };
  lastProcessedMessage: number;
}

// Called periodically (every N messages or on significant events)
async function updateJournalistState(
  transcript: string[],
  state: JournalistState
): Promise<JournalistState> {
  const newMessages = transcript.slice(state.lastProcessedMessage);

  const prompt = `
You are a journalist silently observing a coding session.

Current understanding:
SITUATION: ${state.blocks.situation.value}
RECENT: ${state.blocks.recent_actions.value}

New messages since last update:
${newMessages.join("\n")}

Tasks:
1. Should SITUATION be updated? (major pivot, new goal, problem solved)
   If yes, provide new value (max ${state.blocks.situation.limit} chars)

2. Update RECENT_ACTIONS with latest 3-5 concrete actions
   (max ${state.blocks.recent_actions.limit} chars)

3. Draft a title (4-7 words, active voice, specific)

Output JSON: { situation: string | null, recent: string, title: string }
`;

  const result = await callHaiku(prompt);
  // Update blocks...
  return newState;
}

// Called by status line
async function getTitle(state: JournalistState): Promise<string> {
  return state.blocks.title_draft.value;
}
```

### When to Use This Approach

**Consider Journalist Agent if:**
- Sessions are long (50+ messages)
- Topics drift significantly within sessions
- Current extraction misses nuance
- You want titles that reflect *current* focus, not just *initial* request

**Stick with Extraction if:**
- Sessions are short
- Simplicity is paramount
- Cost per session matters (fewer API calls)

### Integration with Phase Plan

The Journalist approach could be:
- **Phase 1 alternative**: Replace extraction with simpler 2-block structure
- **Phase 2 enhancement**: Add journalist as optional mode for long sessions
- **Future evolution**: Let the journalist use LanceDB to recall similar past sessions

**Recommendation**: Start with Phase 1 as planned (fix extraction), but design the data schema to support a future journalist agent. The `EnhancedContext` interface already maps well to the two-level structure:
- `primaryRequest` → Situation block
- `latestActivity` → Recent actions block

---

## Cost Analysis

| Component | Model | Frequency | Est. Cost/Month |
|-----------|-------|-----------|-----------------|
| Title generation | Haiku | Every render | ~$2-5 |
| Context summarization | Haiku | Every 20 msgs | ~$1 |
| Vector embedding | Local/API | On save | ~$0-2 |
| Quality audit | Sonnet | Every 50 sessions | ~$1 |
| DSPy optimization | Sonnet | Monthly | ~$2 |
| **Total** | | | **~$6-11/month** |

---

## Open Questions

1. **Embedding model**: Use OpenAI's text-embedding-3-small (~$0.02/1M tokens) or local model via Ollama?
2. **Feedback UX**: Inline in status line, or separate command like `/rate-title`?
3. **DSPy integration**: Run locally with Python, or create a TypeScript equivalent?
4. **Storage location**: `~/.claude/vectors/` or inside project directories?

---

## Sources

- [JetBrains Research: Efficient Context Management](https://blog.jetbrains.com/research/2025/12/efficient-context-management/)
- [Mem0: LLM Chat History Summarization Guide 2025](https://mem0.ai/blog/llm-chat-history-summarization-guide-2025)
- [DSPy Official Documentation](https://dspy.ai/learn/optimization/optimizers/)
- [Pondhouse Data: DSPy Tutorial 2025](https://www.pondhouse-data.com/blog/dspy-build-better-ai-systems-with-automated-prompt-optimization)
- [LanceDB: Continue IDE Case Study](https://lancedb.com/blog/the-future-of-ai-native-development-is-local-inside-continues-lancedb-powered-evolution/)
- [TechXplore: KVzip 3-4x Compression](https://techxplore.com/news/2025-11-ai-tech-compress-llm-chatbot.html)
- [Agenta: Top Techniques for Context Length](https://agenta.ai/blog/top-6-techniques-to-manage-context-length-in-llms)
