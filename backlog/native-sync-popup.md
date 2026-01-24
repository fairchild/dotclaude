# Native Sync Popup

> Vision for a rich native macOS sync experience

## Why Native?

macOS `osascript` dialogs are plain text only—can't embed HTML, clickable links, or rich formatting. The designed experience requires native UI (SwiftUI/Electron/Tauri).

## Current State

What works today:
- **Terminal** (`--terminal`): Rich formatted preview
- **Dashboard** (`/sync`): Full web UI with insights
- **Popup** (default): Simple launcher (sync/later/view details)

## The Dream

A native macOS app (or menu bar utility) showing:

### Pending Threads
```
⚡ PENDING THREADS
• webapp: Fix authentication bug [4d]
• api: Add rate limiting [STALLED - 12d]
```

### Session Summaries
```
📝 RECENT SESSIONS
• [webapp] Fixed login flow and added error handling
• [api] Implemented pagination for list endpoints
```

### Insights Cards
- **Continuity**: Stalled threads, active threads
- **Technical**: Files modified, patterns detected
- **Cross-project**: Work spanning multiple repos

### Suggested Actions (2)
Click tracking to improve suggestion ranking:
```
[1] Resume "Fix authentication bug" → cd ~/code/webapp && claude
[2] Continue api work → cd ~/code/api && claude
```

## Data Contract

Native app consumes `SyncOutput` JSON:

```bash
bun scripts/chronicle-sync-popup.ts --json
```

```typescript
interface SyncOutput {
  summary: {
    sessionsToSync: number;
    projectCount: number;
    lastSyncTime: string | null;
    lastSyncAgo: string;
  };
  pendingThreads: {
    text: string;
    project: string;
    daysActive: number;
    isStalled: boolean;
  }[];
  recentSessions: {
    summary: string;
    project: string;
    timestamp: string;
  }[];
  insights: {
    continuity: { title: string; detail: string }[];
    technical: { title: string; detail: string }[];
    crossProject: { title: string; detail: string }[];
  };
  suggestedActions: {
    title: string;
    detail: string;
    command: string;
  }[];
}
```

## Future Consumers

The structured output format is UI-agnostic:
- Terminal (current)
- Dashboard web UI (current)
- Native macOS app (this backlog item)
- VS Code extension (future)
- Alfred workflow (future)
- Raycast extension (future)

## Feedback Learning

When native app exists, track:
- Which suggestion clicked (first, second, both, none)
- Time to click
- Use feedback to tune suggestion ranking

Schema:
```typescript
interface SuggestionFeedback {
  timestamp: string;
  syncId: string;
  suggestions: [
    { type: string; target: string; reason: string },
    { type: string; target: string; reason: string }
  ];
  outcome: "first" | "second" | "both" | "none" | "dashboard";
  timeToClick?: number;
}
```

## Design Assets

Created during brainstorming:
- `docs/design/brainstorm/01-popup-enhanced.png`
- `docs/design/brainstorm/02-dashboard-sync.png`
- `docs/design/brainstorm/03-notification.png`
- `docs/user-stories.md`
- `docs/product_overview.md`

## Implementation Options

1. **SwiftUI menu bar app** - Native macOS, small footprint
2. **Tauri** - Rust + web UI, cross-platform potential
3. **Electron** - Heaviest but most familiar stack

Recommend: SwiftUI for lightest touch, best macOS integration.
