# The Chronicle: A Persistent Coding Journalist Agent

> **Status**: Design brainstorm - ready for MVP implementation
> **MVP Focus**: Continuity Threads (track unfinished work between sessions)
> **Inspiration**: Letta's memory blocks, sleep-time compute, MemGPT architecture

## Quick Summary

| Decision | Choice |
|----------|--------|
| Embedding model | OpenAI text-embedding-3-small |
| Trigger | Claude Code `Stop` hook (real-time) |
| MVP capability | Continuity threads - know what's pending |
| Cold start | Backfill last 30 days of sessions |
| Scope | Project-scoped by default, global available |

**What gets built:**
1. Thread extraction at session end (extends existing `stop.sh` hook)
2. `/chronicle pending` skill to see what's unfinished
3. Backfill script to seed from historical sessions
4. Resolution detection and thread lifecycle

---

## Vision

A **stateful agent** that observes, remembers, and learns from your coding sessions over time. Not just titles—a longitudinal memory system that can:

- **Recall**: "What was I working on in that OAuth session last week?"
- **Synthesize**: "What patterns do I see in how Michael debugs?"
- **Brief**: "What happened in my last 3 sessions? Catch me up."
- **Investigate**: "Find all sessions where I touched authentication code."

Inspired by Letta's memory blocks and sleep-time compute, this agent **thinks while you're away**.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           THE CHRONICLE SYSTEM                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    DURING SESSION (Real-time)                        │    │
│  │                                                                      │    │
│  │   Claude Code ──────▶ Status Line ──────▶ Session Tracker           │    │
│  │        │                   │                    │                    │    │
│  │        │                   │                    ▼                    │    │
│  │        │                   │           ┌──────────────────┐         │    │
│  │        │                   │           │ EPISODIC MEMORY  │         │    │
│  │        │                   │           │ (Raw session log)│         │    │
│  │        │                   │           └──────────────────┘         │    │
│  │        │                   │                                        │    │
│  └────────┼───────────────────┼────────────────────────────────────────┘    │
│           │                   │                                              │
│           │                   │                                              │
│  ┌────────┼───────────────────┼────────────────────────────────────────┐    │
│  │        │   BETWEEN SESSIONS (Sleep-time compute)                     │    │
│  │        ▼                   ▼                                         │    │
│  │   ┌─────────────────────────────────────────────────────────────┐   │    │
│  │   │                  CHRONICLE AGENT (Haiku)                     │   │    │
│  │   │                                                              │   │    │
│  │   │   Runs asynchronously on:                                    │   │    │
│  │   │   • Session end (process latest session)                     │   │    │
│  │   │   • Scheduled (daily digest, pattern mining)                 │   │    │
│  │   │   • Triggered (explicit /chronicle command)                  │   │    │
│  │   │                                                              │   │    │
│  │   │   Tasks:                                                     │   │    │
│  │   │   ✦ Compress session → semantic memory                       │   │    │
│  │   │   ✦ Update preference observations                          │   │    │
│  │   │   ✦ Consolidate related memories                             │   │    │
│  │   │   ✦ Mine patterns across sessions                            │   │    │
│  │   │   ✦ Prepare daily/weekly digests                             │   │    │
│  │   └─────────────────────────────────────────────────────────────┘   │    │
│  │                              │                                       │    │
│  │                              ▼                                       │    │
│  │   ┌─────────────────────────────────────────────────────────────┐   │    │
│  │   │                    MEMORY BLOCKS                             │   │    │
│  │   │                                                              │   │    │
│  │   │   ┌────────────────┐  ┌────────────────┐  ┌──────────────┐  │   │    │
│  │   │   │ SEMANTIC       │  │ PROCEDURAL     │  │ PREFERENCES  │  │   │    │
│  │   │   │ (Facts/Skills) │  │ (Workflows)    │  │ (Style)      │  │   │    │
│  │   │   │                │  │                │  │              │  │   │    │
│  │   │   │ "Knows OAuth"  │  │ "Debugs by..." │  │ "Prefers..." │  │   │    │
│  │   │   │ "Uses Bun"     │  │ "Tests after"  │  │ "Minimal"    │  │   │    │
│  │   │   └────────────────┘  └────────────────┘  └──────────────┘  │   │    │
│  │   │                                                              │   │    │
│  │   │   ┌────────────────────────────────────────────────────────┐│   │    │
│  │   │   │ VECTOR INDEX (LanceDB)                                 ││   │    │
│  │   │   │ Embeddings of session summaries for semantic search    ││   │    │
│  │   │   └────────────────────────────────────────────────────────┘│   │    │
│  │   └─────────────────────────────────────────────────────────────┘   │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    ON DEMAND (Query interface)                       │    │
│  │                                                                      │    │
│  │   User: "/chronicle catch me up"                                     │    │
│  │   User: "/chronicle what was that OAuth session?"                    │    │
│  │   User: "/chronicle how do I usually debug auth?"                    │    │
│  │   User: "/chronicle what patterns do you see in my work?"            │    │
│  │                                                                      │    │
│  │          ▼                                                           │    │
│  │   ┌─────────────────────────────────────────────────────────────┐   │    │
│  │   │             CHRONICLE QUERY AGENT (Sonnet/Haiku)             │   │    │
│  │   │                                                              │   │    │
│  │   │   • Semantic search over session embeddings                  │   │    │
│  │   │   • Read memory blocks for context                           │   │    │
│  │   │   • Can request episodic detail if needed                    │   │    │
│  │   │   • Generates focused, actionable response                   │   │    │
│  │   └─────────────────────────────────────────────────────────────┘   │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Memory Architecture (Letta-Inspired)

### Three Memory Types

| Type | What it Stores | Update Frequency | Example |
|------|---------------|------------------|---------|
| **Episodic** | Raw session logs, transcripts | Every session | "Dec 15: Fixed OAuth redirect in auth module" |
| **Semantic** | Extracted facts, knowledge | After consolidation | "Michael knows: OAuth, Bun, TypeScript, Cloudflare Workers" |
| **Procedural** | Observed workflows, patterns | Weekly mining | "Debugging pattern: read logs → grep for error → trace backwards" |

### Memory Block Schema

```typescript
// ~/.claude/chronicle/blocks/

interface MemoryBlock {
  label: string;           // Unique identifier
  description: string;     // What this block represents
  value: string;           // The actual content (text)
  limit: number;           // Character budget (forces compression)
  updatedAt: string;       // ISO timestamp
  version: number;         // For tracking evolution
}

// Core blocks the Chronicle maintains:
const CHRONICLE_BLOCKS = {
  // IDENTITY: Who Michael is as a developer
  developer_profile: {
    label: "developer_profile",
    description: "Core facts about Michael's development environment and skills",
    limit: 2000,
    // Value: "Uses Bun, prefers TypeScript, Cloudflare Workers for deployment..."
  },

  // PREFERENCES: How Michael likes to work
  preferences: {
    label: "preferences",
    description: "Observed preferences and style choices",
    limit: 1500,
    // Value: "Prefers minimal dependencies, narrative code organization, conventional commits..."
  },

  // RECENT_CONTEXT: Sliding window of recent work
  recent_sessions: {
    label: "recent_sessions",
    description: "Summary of last 5-10 sessions",
    limit: 3000,
    // Value: Compressed summaries, updated each session
  },

  // PROJECTS: Active project knowledge
  active_projects: {
    label: "active_projects",
    description: "Current active projects and their status",
    limit: 2000,
    // Value: "jrnlfish: daily journaling app, currently on experiments..."
  },

  // PATTERNS: Observed behavioral patterns
  work_patterns: {
    label: "work_patterns",
    description: "Mining-derived patterns in how Michael works",
    limit: 2000,
    // Value: "Tends to debug by reading logs first, prefers test-behavior-not-implementation..."
  },

  // PENDING: Things to remember for next session
  pending_threads: {
    label: "pending_threads",
    description: "Unfinished work, open questions, planned next steps",
    limit: 1500,
    // Value: "OAuth session incomplete: need to add state param validation..."
  }
};
```

---

## Sleep-Time Compute: The Background Journalist

### When Sleep-Time Runs

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          SLEEP-TIME TRIGGERS                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   1. SESSION END                                                             │
│      ─────────────                                                          │
│      Trigger: Claude Code session closes (hook or manual)                   │
│      Task: Process latest session → episodic memory                         │
│      Cost: 1 Haiku call (~$0.001)                                           │
│                                                                              │
│   2. DAILY CONSOLIDATION (Cron or launchd)                                  │
│      ─────────────────────────────────────────                              │
│      Trigger: 3 AM daily (or first session of day)                          │
│      Tasks:                                                                  │
│        • Compress yesterday's sessions into semantic memory                 │
│        • Update preference observations                                     │
│        • Consolidate related memories                                       │
│        • Prepare "morning briefing"                                         │
│      Cost: 1-2 Haiku calls (~$0.005)                                        │
│                                                                              │
│   3. WEEKLY PATTERN MINING                                                   │
│      ────────────────────────                                               │
│      Trigger: Sunday night                                                  │
│      Tasks:                                                                  │
│        • Analyze week's work for patterns                                   │
│        • Update procedural memory                                           │
│        • Identify emerging preferences                                      │
│        • Generate weekly retrospective                                      │
│      Cost: 1 Sonnet call (~$0.03)                                           │
│                                                                              │
│   4. EXPLICIT TRIGGER                                                        │
│      ────────────────                                                       │
│      Command: /chronicle consolidate                                        │
│      Runs full consolidation cycle on demand                                │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Session End Processing

```typescript
// ~/.claude/scripts/chronicle-sleep.ts

interface SessionDigest {
  sessionId: string;
  project: string;
  branch: string;

  // Extracted by Haiku
  summary: string;           // 1-2 sentence summary
  keyActions: string[];      // What was accomplished
  filesModified: string[];   // Which files changed
  technologiesUsed: string[];// Tech mentioned/used
  openQuestions: string[];   // Unfinished threads

  // Computed
  embedding: Float32Array;   // For vector search
  importance: number;        // 1-5 for memory prioritization
}

async function processSessionEnd(sessionPath: string): Promise<void> {
  // 1. Extract session context (reuse existing infrastructure)
  const context = await extractEnhancedContext(sessionPath);

  // 2. Generate digest with Haiku
  const digest = await callHaiku(`
    You are a journalist documenting a coding session.

    Session context:
    - Project: ${context.projectName}
    - Branch: ${context.gitBranch}
    - Primary request: ${context.primaryRequest}
    - Latest activity: ${context.latestActivity}
    - Files modified: ${context.modifiedFiles.join(", ")}

    Generate a digest with:
    1. summary: 1-2 sentence summary of what was accomplished
    2. keyActions: Array of 3-5 key actions taken
    3. openQuestions: Any unfinished work or open threads
    4. importance: 1-5 rating (5 = major feature, 1 = trivial fix)

    Output JSON only.
  `);

  // 3. Embed for vector search
  const embedding = await embed(digest.summary + " " + digest.keyActions.join(" "));

  // 4. Store episodic memory
  await appendToEpisodicLog({ ...digest, embedding });

  // 5. Update recent_sessions block (sliding window)
  await updateRecentSessionsBlock(digest);
}
```

### Daily Consolidation

```typescript
// Runs during "sleep time" (between sessions or scheduled)

async function dailyConsolidation(): Promise<void> {
  // 1. Load yesterday's episodic memories
  const yesterday = await getSessionDigests({ since: "24h" });

  // 2. Consolidate into semantic memory
  const consolidation = await callHaiku(`
    You are consolidating a day's coding work into long-term memory.

    Yesterday's sessions:
    ${yesterday.map(d => `- ${d.project}: ${d.summary}`).join("\n")}

    Current semantic memory:
    ${await getBlock("developer_profile")}

    Tasks:
    1. What new facts/skills were demonstrated? (ADD to profile)
    2. What preferences were observed? (UPDATE preferences)
    3. What should be remembered for tomorrow? (UPDATE pending_threads)

    Be aggressive about compression. Only store what's NOVEL or IMPORTANT.
    Output JSON with: { addToProfile: string[], updatePreferences: string[], pendingThreads: string[] }
  `);

  // 3. Apply updates to memory blocks
  await mergeIntoBlock("developer_profile", consolidation.addToProfile);
  await mergeIntoBlock("preferences", consolidation.updatePreferences);
  await replaceBlock("pending_threads", consolidation.pendingThreads);
}
```

---

## Query Interface: The /chronicle Skill

### Commands

```bash
/chronicle                    # Morning briefing - what's pending, recent work
/chronicle catch me up        # Summarize recent sessions
/chronicle find <query>       # Semantic search over session history
/chronicle about <topic>      # What do I know about this topic/project?
/chronicle how do I <task>    # Search procedural memory for patterns
/chronicle patterns           # What patterns does the journalist see?
/chronicle digest [period]    # Generate digest for day/week/month
```

### Query Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          CHRONICLE QUERY FLOW                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   User: "/chronicle what was that OAuth session?"                           │
│                             │                                                │
│                             ▼                                                │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  1. INTENT CLASSIFICATION (Fast, Haiku)                             │   │
│   │     → Query type: SEARCH                                            │   │
│   │     → Key terms: "OAuth", "session"                                 │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                             │                                                │
│                             ▼                                                │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  2. MEMORY RETRIEVAL                                                 │   │
│   │     → Embed query: "OAuth session"                                  │   │
│   │     → Search LanceDB for similar sessions                           │   │
│   │     → Pull top 3 matches with summaries                             │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                             │                                                │
│                             ▼                                                │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  3. CONTEXT AUGMENTATION                                             │   │
│   │     → Load relevant memory blocks (developer_profile, preferences)  │   │
│   │     → If high importance match, offer to load full episodic log     │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                             │                                                │
│                             ▼                                                │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  4. RESPONSE GENERATION (Haiku or Sonnet for complex)               │   │
│   │     "I found 2 OAuth-related sessions:                              │   │
│   │      • Dec 15: Fixed OAuth redirect loop in auth module             │   │
│   │        Status: Completed. Added state param validation.             │   │
│   │      • Dec 10: Initial OAuth integration for jrnlfish               │   │
│   │        Status: Shipped, using Google provider.                      │   │
│   │      Want me to dig into either one?"                               │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Storage Layout

```
~/.claude/chronicle/
├── blocks/                          # Memory blocks (JSON files)
│   ├── developer_profile.json
│   ├── preferences.json
│   ├── recent_sessions.json
│   ├── active_projects.json
│   ├── work_patterns.json
│   └── pending_threads.json
├── episodic/                        # Raw session digests
│   └── 2025-12/
│       ├── 2025-12-15-session-abc.json
│       └── 2025-12-16-session-def.json
├── vectors/                         # LanceDB storage
│   └── sessions.lance/
├── digests/                         # Generated summaries
│   ├── daily/
│   │   └── 2025-12-15.md
│   └── weekly/
│       └── 2025-W50.md
└── config.json                      # Chronicle settings
```

---

## Learning Through Observation

### Preference Mining

The Chronicle doesn't just store—it **observes and infers**:

```typescript
interface PreferenceObservation {
  preference: string;        // What was observed
  confidence: number;        // 0-1 based on frequency
  evidence: string[];        // Sessions that support this
  firstObserved: string;     // When first noticed
  lastConfirmed: string;     // Most recent confirmation
}

// Example observations:
const observations: PreferenceObservation[] = [
  {
    preference: "Prefers Bun over Node for TypeScript",
    confidence: 0.95,
    evidence: ["session-abc", "session-def", "session-ghi"],
    firstObserved: "2025-11-15",
    lastConfirmed: "2025-12-30"
  },
  {
    preference: "Uses conventional commits (feat:, fix:, chore:)",
    confidence: 0.90,
    evidence: ["session-xyz", ...],
    firstObserved: "2025-11-20",
    lastConfirmed: "2025-12-31"
  },
  {
    preference: "Tests behavior over implementation details",
    confidence: 0.75,
    evidence: ["session-test1", "session-test2"],
    firstObserved: "2025-12-01",
    lastConfirmed: "2025-12-28"
  }
];
```

### Pattern Mining (Weekly)

```typescript
async function mineWeeklyPatterns(): Promise<void> {
  const weekSessions = await getSessionDigests({ since: "7d" });

  const patterns = await callSonnet(`
    You are analyzing a week of coding sessions for behavioral patterns.

    Sessions this week:
    ${weekSessions.map(s => JSON.stringify(s, null, 2)).join("\n---\n")}

    Current known patterns:
    ${await getBlock("work_patterns")}

    Analyze for:
    1. DEBUGGING PATTERNS: How does Michael approach debugging?
    2. WORKFLOW PATTERNS: What sequence of actions is common?
    3. TOOL PATTERNS: What tools/commands are frequently used?
    4. TIME PATTERNS: Any patterns in when/how work happens?
    5. EMERGING SKILLS: What new technologies/patterns are appearing?

    Update the patterns block with new observations.
    Be specific and evidence-based.
  `);

  await updateBlock("work_patterns", patterns);
}
```

---

## Integration with Existing Infrastructure

### What We Already Have

| Component | Location | Reuse |
|-----------|----------|-------|
| Session history | `~/.claude/history.jsonl` | Source for episodic memory |
| Title generation | `scripts/generate-session-title-testable.ts` | Context extraction logic |
| Feedback schema | `title-feedback/schema.ts` | Extend for chronicle ratings |
| Session titles | `session-titles/` | Compressed session summaries |
| Evaluation framework | `skills/session-title-eval/` | Quality metrics |
| Status line | `statusline.sh` | Trigger point for updates |

### New Components

| Component | Location | Purpose |
|-----------|----------|---------|
| Chronicle blocks | `chronicle/blocks/` | Persistent memory |
| Episodic log | `chronicle/episodic/` | Session digests |
| Vector store | `chronicle/vectors/` | LanceDB for search |
| Sleep agent | `scripts/chronicle-sleep.ts` | Background processing |
| Query skill | `skills/chronicle/` | User interface |
| Consolidation | `scripts/chronicle-consolidate.ts` | Memory management |

---

## Implementation Phases

### Phase 0: Foundation (Current State)
- [x] Enhanced context extraction (primaryRequest, latestActivity)
- [x] Feedback schema for ratings
- [x] 2000+ sessions of historical data
- [x] Session title generation working

### Phase 1: Episodic Memory
- [ ] Create `chronicle/` directory structure
- [ ] Implement session digest extraction
- [ ] Add session-end hook to trigger processing
- [ ] Store digests in episodic log

### Phase 2: Memory Blocks
- [ ] Define block schema and initial values
- [ ] Implement block read/write utilities
- [ ] Create `recent_sessions` sliding window
- [ ] Add `pending_threads` for continuity

### Phase 3: Vector Search
- [ ] Integrate LanceDB
- [ ] Embed session summaries
- [ ] Implement semantic search
- [ ] Add `/chronicle find` command

### Phase 4: Sleep-Time Compute
- [ ] Implement daily consolidation
- [ ] Add preference observation logic
- [ ] Create weekly pattern mining
- [ ] Schedule via launchd or hook

### Phase 5: Query Interface
- [ ] Create `/chronicle` skill
- [ ] Implement query routing
- [ ] Add morning briefing
- [ ] Polish response generation

### Phase 6: Learning Loop
- [ ] Connect feedback to preference confidence
- [ ] Implement memory decay/pruning
- [ ] Add retrospective generation
- [ ] DSPy optimization (if enough data)

---

## Design Decisions (Resolved)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Embedding model** | OpenAI text-embedding-3-small | Fast, cheap (~$0.02/1M tokens), simple integration |
| **Sleep-time trigger** | Session-end hook | Real-time processing, immediate capture |
| **MVP Focus** | Continuity threads | Track unfinished work, remind about pending items |
| **Cold start** | Selective backfill (30 days) | Balance of historical context and freshness |

---

## MVP: Continuity Threads

The first release focuses on **knowing what was left undone** and **picking up where you left off**.

### Core Concept

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CONTINUITY THREADS MVP                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   SESSION N                              SESSION N+1                         │
│   ─────────                              ───────────                        │
│                                                                              │
│   Working on OAuth...                    "What was I doing?"                │
│   Fixed redirect issue                              │                        │
│   Started state validation                          ▼                        │
│   ⚠️ Left incomplete: tests            ┌──────────────────────┐             │
│           │                            │  CHRONICLE BRIEFING   │             │
│           │                            │                        │             │
│           ▼                            │  "Last session you     │             │
│   ┌──────────────────────┐            │  were working on OAuth │             │
│   │  SESSION END HOOK    │            │  in jrnlfish.          │             │
│   │                      │            │                        │             │
│   │  Extract:            │            │  Pending:              │             │
│   │  • What was done     │───────────▶│  • State validation    │             │
│   │  • What's pending    │            │    tests not written   │             │
│   │  • Open questions    │            │  • Error handling      │             │
│   │                      │            │    needs review        │             │
│   └──────────────────────┘            │                        │             │
│                                        │  Continue? [y/n]"      │             │
│                                        └──────────────────────┘             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Pending Thread Schema

```typescript
interface PendingThread {
  id: string;                    // Unique thread ID
  sessionId: string;             // Which session created this
  project: string;               // Project context
  branch: string;                // Git branch when created

  // The thread itself
  summary: string;               // "Add state validation tests for OAuth"
  context: string;               // Why this matters, what was the goal
  priority: "high" | "medium" | "low";

  // Metadata
  createdAt: string;             // When identified
  lastMentioned: string;         // Most recent session that touched this
  status: "pending" | "in_progress" | "resolved" | "abandoned";

  // Resolution (when closed)
  resolution?: {
    how: "completed" | "deferred" | "wont_do";
    note?: string;
    resolvedAt: string;
  };
}
```

### Thread Lifecycle

```
                    ┌─────────────┐
                    │   SESSION   │
                    │   ENDS      │
                    └──────┬──────┘
                           │
                           ▼
                    ┌─────────────┐
                    │   EXTRACT   │◀──── Haiku analyzes:
                    │   THREADS   │      "What's incomplete?"
                    └──────┬──────┘
                           │
            ┌──────────────┼──────────────┐
            │              │              │
            ▼              ▼              ▼
       ┌─────────┐   ┌─────────┐   ┌─────────┐
       │  NEW    │   │ UPDATE  │   │ RESOLVE │
       │ THREAD  │   │ THREAD  │   │ THREAD  │
       └────┬────┘   └────┬────┘   └────┬────┘
            │             │              │
            └──────────────┼──────────────┘
                          │
                          ▼
                   ┌─────────────┐
                   │  PENDING    │
                   │  THREADS    │
                   │   BLOCK     │
                   └─────────────┘
                          │
                          ▼
                   ┌─────────────┐
                   │  NEXT       │◀──── Status line or
                   │  SESSION    │      /chronicle briefing
                   │  BRIEFING   │
                   └─────────────┘
```

### Session-End Extraction Prompt

```typescript
const THREAD_EXTRACTION_PROMPT = `
You are analyzing a coding session that just ended.

Session context:
- Project: {{project}}
- Branch: {{branch}}
- What was accomplished: {{keyActions}}
- Current state: {{latestActivity}}

Your task: Identify PENDING THREADS - work that was started but not finished.

A pending thread is:
- An incomplete implementation ("added function but no tests")
- An open question ("not sure if this handles edge case")
- An explicit TODO mentioned in conversation
- A deferred decision ("will handle error case later")
- A blocked item ("waiting on API response")

NOT a pending thread:
- Work that was completed successfully
- General areas for future improvement
- Vague "should do eventually" items

For each thread found, provide:
{
  "summary": "Short actionable description (imperative voice)",
  "context": "Why this matters, what's the goal",
  "priority": "high" | "medium" | "low"
}

If session was fully resolved (all work complete), return: { "threads": [] }
`;
```

### Briefing Interface

When starting a new session, the Chronicle can provide context:

```bash
# Option 1: Automatic (via status line hook or session start)
$ claude
┌─────────────────────────────────────────────────────────────────┐
│  Chronicle: You have 2 pending threads from yesterday:          │
│                                                                  │
│  [HIGH] Add state validation tests for OAuth (jrnlfish)         │
│  [MED]  Review error handling in redirect.ts                    │
│                                                                  │
│  Continue with these? [y/n/details]                             │
└─────────────────────────────────────────────────────────────────┘

# Option 2: On-demand
> /chronicle pending
> /chronicle threads
> /chronicle what was I doing?

# Option 3: Project-scoped
> /chronicle pending jrnlfish
```

### Thread Resolution

When a thread is completed, the Chronicle tracks it:

```typescript
// During session, detect resolution signals:
// - "Done with the tests" → resolve "Add state validation tests"
// - Explicit: /chronicle resolve <thread-id>
// - Implicit: file changes + successful test run

async function detectResolution(
  thread: PendingThread,
  sessionContext: SessionContext
): Promise<boolean> {
  // Haiku checks if thread appears resolved
  const check = await callHaiku(`
    Thread: "${thread.summary}"
    Context: ${thread.context}

    Session actions:
    ${sessionContext.keyActions.join("\n")}

    Was this thread resolved in this session?
    Consider: tests passing, implementation complete, explicit confirmation.

    Output: { "resolved": true/false, "evidence": "why you think so" }
  `);

  return check.resolved;
}
```

---

## Hook Integration

The Chronicle will integrate with the existing `Stop` hook infrastructure:

```
~/.claude/settings.json
    └── hooks.Stop
        └── ~/.claude/hooks/stop.sh
            └── ~/.claude/scripts/generate-session-title.ts  ← existing
            └── ~/.claude/scripts/chronicle-extract.ts       ← NEW
```

### Existing Infrastructure

```bash
# ~/.claude/hooks/stop.sh (current)
#!/bin/bash
~/.claude/scripts/generate-session-title.ts
```

### Extended Hook

```bash
# ~/.claude/hooks/stop.sh (with Chronicle)
#!/bin/bash

# Existing: Generate session title
~/.claude/scripts/generate-session-title.ts

# New: Extract pending threads for Chronicle
~/.claude/scripts/chronicle-extract.ts
```

Both scripts read the same stdin (session JSON) passed by Claude Code.

---

## Implementation Plan

### Phase 1: Foundation (Day 1)

**Files to create:**

| File | Purpose |
|------|---------|
| `chronicle/threads/pending.jsonl` | Global pending threads |
| `chronicle/threads/resolved.jsonl` | Completed threads (history) |
| `chronicle/config.json` | Chronicle settings |
| `scripts/chronicle-extract.ts` | Thread extraction (Stop hook) |
| `scripts/chronicle-lib.ts` | Shared utilities |

**Tasks:**
1. Create `~/.claude/chronicle/` directory structure
2. Define `PendingThread` TypeScript interface
3. Implement `chronicle-extract.ts`:
   - Read session context from stdin (same as title generator)
   - Call Haiku with thread extraction prompt
   - Append new threads to `pending.jsonl`
4. Update `stop.sh` to also call Chronicle extraction

### Phase 2: Query Skill (Day 2)

**Files to create:**

| File | Purpose |
|------|---------|
| `skills/chronicle/SKILL.md` | Skill definition |
| `scripts/chronicle-query.ts` | Query processor |

**Commands to implement:**
- `/chronicle pending` - Show all pending threads
- `/chronicle pending <project>` - Project-scoped
- `/chronicle all` - Global view sorted by priority
- `/chronicle resolve <id>` - Mark thread resolved

### Phase 3: Backfill (Day 3)

**Files to create:**

| File | Purpose |
|------|---------|
| `scripts/chronicle-backfill.ts` | Process historical sessions |

**Tasks:**
1. Read last 30 days of `history.jsonl`
2. Extract threads from each session
3. Deduplicate against existing threads
4. Populate initial `pending.jsonl`

### Phase 4: Thread Intelligence (Day 4+)

**Enhancements:**
1. Thread resolution detection during sessions
2. Priority inference from patterns
3. Stale thread auto-archival (30+ days)
4. Cross-project thread linking

---

## Key Files Reference

### Existing (reuse)

| File | Use |
|------|-----|
| `scripts/generate-session-title-testable.ts` | Context extraction logic |
| `title-feedback/schema.ts` | Type patterns |
| `hooks/stop.sh` | Hook entry point |
| `history.jsonl` | Historical sessions for backfill |

### New (create)

| File | Purpose |
|------|---------|
| `chronicle/threads/pending.jsonl` | Active pending threads |
| `chronicle/threads/resolved.jsonl` | Resolved thread history |
| `chronicle/config.json` | Chronicle settings |
| `scripts/chronicle-extract.ts` | Thread extraction at session end |
| `scripts/chronicle-lib.ts` | Shared Chronicle utilities |
| `scripts/chronicle-query.ts` | Query/search functionality |
| `scripts/chronicle-backfill.ts` | Historical session processing |
| `skills/chronicle/SKILL.md` | User-facing skill |

---

## Cost Estimate (MVP)

| Operation | Model | Per-Call | Monthly (~600 sessions) |
|-----------|-------|----------|-------------------------|
| Thread extraction | Haiku | ~$0.001 | ~$0.60 |
| Thread queries | Haiku | ~$0.0005 | ~$0.15 |
| Backfill (one-time) | Haiku | ~$0.50 | N/A |
| **Total monthly** | | | **~$0.75** |

---

## Build vs Use Letta Framework

### Option A: Custom Implementation (Current Plan)

Build Chronicle entirely with TypeScript, using:
- LanceDB for vectors (local, no server)
- JSONL files for episodic/thread storage
- Claude Code hooks for triggers
- Direct Anthropic API calls

**Pros:**
- No new infrastructure (Docker, PostgreSQL)
- Full control, minimal dependencies
- Integrates natively with Claude Code
- Works offline, fully local

**Cons:**
- Must build memory management from scratch
- No ADE (Agent Development Environment)
- Sleep-time agent logic is manual

### Option B: Letta Framework

Use Letta's open-source agent framework:
- Docker container with PostgreSQL
- Memory blocks managed by Letta
- TypeScript SDK (`@letta-ai/letta-client`)
- Built-in sleep-time compute

**Self-hosting requirements:**
```bash
docker run \
  -v ~/.letta/.persist/pgdata:/var/lib/postgresql/data \
  -p 8283:8283 \
  -e ANTHROPIC_API_KEY="key" \
  letta/letta:latest
```

**Pros:**
- Memory management handled
- Agent tools (memory_update, memory_rethink) built-in
- ADE for debugging and visualization
- Multi-agent coordination native

**Cons:**
- Docker dependency
- PostgreSQL for storage (vs files)
- Another service to manage

### Hybrid Approach (Recommended)

```
PHASE 1-2: Custom MVP          PHASE 3+: Evaluate Letta
─────────────────────          ────────────────────────
• Thread extraction            • If memory needs grow complex
• /chronicle skill             • If multi-agent coordination needed
• Simple JSONL storage         • If ADE visualization valuable
• LanceDB vectors
```

---

## Pattern Mining Deep Dive

### What Patterns to Mine

| Category | Question | Observable Signals |
|----------|----------|--------------------|
| **Debugging** | "How does Michael debug?" | Sequence: logs→grep→trace? First action? |
| **Workflow** | "What sequences are common?" | plan→implement→test? Branch→code→PR? |
| **Tools** | "What tools recur?" | bun vs npm, vitest vs jest, commit style |
| **Time** | "When/how does work happen?" | Session length, morning vs evening |

### Example Pattern Observation

```typescript
{
  patternType: "debugging",
  pattern: "Reads error logs first, greps for message, traces call stack backwards",
  confidence: 0.85,
  evidence: ["session-abc", "session-def", "session-ghi"],
  examples: [
    "Dec 15: OAuth error → checked server logs → found redirect issue",
    "Dec 20: Test failure → read pytest output → traced to fixture"
  ]
}
```

---

## Preference Learning Deep Dive

### Implicit vs Explicit Signals

| Type | Example | Weight | Decay |
|------|---------|--------|-------|
| **Explicit** | "I prefer Bun over Node" | High | Low |
| **Implicit** | Uses bun in 95% of projects | Accumulates | Higher |

### Developer Profile Schema

```typescript
interface DeveloperProfile {
  identity: {
    primaryLanguages: ["TypeScript", "Python"];
    primaryTools: ["Bun", "Claude Code", "git"];
  };
  preferences: Preference[];  // Observed + stated
  style: {
    commitStyle: "conventional commits";
    commentStyle: "minimal, self-documenting";
    testingApproach: "behavior over implementation";
  };
}
```

---

## Memory Architecture Deep Dive

### Three-Tier Model

```
TIER 1: HOT (Always in context)     ~4000 chars
────────────────────────────────
pending_threads, recent_sessions, developer_profile_summary

TIER 2: WARM (Retrievable)          Unlimited (vector indexed)
────────────────────────────
Session summaries, pattern observations, preference evidence

TIER 3: COLD (Archive)              Full historical
──────────────────────
Raw transcripts (history.jsonl), old resolved threads
```

### Memory Decay

```typescript
// Importance decays over time, but boosts on access
function calculateImportance(entry): number {
  const decayFactor = Math.pow(0.5, daysSinceCreated / halfLife);
  return Math.max(initial * decayFactor + boosts, floor);
}
```

### Consolidation Schedule

| Frequency | Tasks |
|-----------|-------|
| **Daily** | Compress sessions, update sliding windows, extract preferences |
| **Weekly** | Mine patterns, prune low-importance, consolidate similar |
| **Monthly** | Regenerate profile, archive old threads |

---

## Cross-Project Insights

### What Connects Projects?

- **Technology clusters**: Which projects share Bun/Hono/Cloudflare?
- **Skill transfer**: OAuth debugging in one project → apply to another
- **Recurring problems**: Issues that appear across repos

### Query Examples

```bash
/chronicle skills                    # Technologies I've used
/chronicle projects using Hono       # Which use this framework?
/chronicle similar to jrnlfish       # Projects with similar stack
/chronicle recurring problems        # Cross-project issues
```

---

## Extended Cost Estimate (Full System)

| Operation | Model | Frequency | Monthly |
|-----------|-------|-----------|---------|
| Thread extraction | Haiku | ~20/day | ~$0.60 |
| Daily consolidation | Haiku | 30/month | ~$0.15 |
| Weekly patterns | Sonnet | 4/month | ~$0.12 |
| Chronicle queries | Haiku | ~10/day | ~$0.30 |
| Preference extraction | Haiku | ~20/day | ~$0.30 |
| Vector embeddings | OpenAI | ~20/day | ~$0.10 |
| **Total** | | | **~$1.60/month** |

---

## Next Steps

This brainstorm covers:
1. **Continuity Threads MVP** - Ready to build
2. **Pattern Mining** - Design complete, build after MVP
3. **Preference Learning** - Design complete, build after patterns
4. **Memory Architecture** - Three-tier model defined
5. **Letta Integration** - Evaluate after Phase 2

**Recommended path:**
1. Build custom MVP (threads + skill) - Days 1-3
2. Add backfill from history - Day 4
3. Add LanceDB vectors - Day 5
4. Evaluate if Letta needed for advanced features

---

## Sources

- [Letta: Sleep-Time Compute](https://www.letta.com/blog/sleep-time-compute)
- [Letta: Memory Blocks](https://docs.letta.com/guides/agents/memory-blocks)
- [Letta: Self-Hosting Guide](https://docs.letta.com/guides/selfhosting/)
- [Letta: Continual Learning](https://www.letta.com/blog/continual-learning)
- [LanceDB: Continue IDE Case Study](https://lancedb.com/blog/the-future-of-ai-native-development-is-local-inside-continues-lancedb-powered-evolution/)
