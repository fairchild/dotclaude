# Chronicle Sync UX

## Problem Statement

Chronicle captures valuable session context (pending threads, insights, patterns) but the sync experience is purely mechanical: a daily popup asking "sync now or later?" with no visibility into what's being synced or why it matters. Users lose momentum because they can't see:
- What unfinished work is waiting for them
- Patterns emerging across sessions
- How long threads have been stalled

## Solution Summary

Transform sync from a chore into a momentum tool. The enhanced sync experience shows pending threads and session summaries upfront, surfaces AI-generated insights about work patterns, and suggests actionable next steps with feedback-driven learning.

## Core Capabilities

**Enhanced Popup**
- Pending threads displayed prominently
- Recent session summaries visible at a glance
- "View Details" button for deeper exploration
- Time context (last sync) for urgency

**Dashboard Sync View**
- Full sync preview with quantitative stats
- Continuity insights (thread duration, resolutions, stalled work)
- Technical patterns (hot files, tech debt signals)
- Cross-project connections
- Historical sync timeline

**Post-Sync Notification**
- macOS notification with key insights
- Two suggested actions with click tracking
- Feedback loop for improving suggestions

**Insight Generation (Hybrid)**
- Lightweight stats computed on extraction
- Deep analysis on-demand or scheduled
- Continuity, technical, and cross-project insights

## Target Users

Developers using Claude Code who want to maintain context across sessions and improve their development momentum. Primary persona: solo developer or small team member who context-switches frequently.

## Design Principles

1. **Momentum over mechanics** - Every interaction should help users pick up where they left off
2. **Insights earn attention** - Don't interrupt unless there's something valuable to show
3. **Actions close loops** - Suggestions should be one click from execution
4. **Feedback improves quality** - Track what users click to improve suggestions over time
5. **Progressive disclosure** - Quick info in popup, depth in dashboard
