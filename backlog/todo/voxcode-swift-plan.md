---
arc: prototype-surface
---

# Swift Voxcode — Native macOS Voice Interface for Claude Code

## Problem Statement

Claude Code is keyboard-first. The existing voice skill (`~/.claude/skills/vocal/`) provides
TTS and STT as Bash tools, but the interaction is clunky — each listen/speak cycle requires
a separate tool call, there's no continuous conversation, and the Python scripts have no
native macOS integration (audio routing, global hotkeys, background operation).

We want a native macOS voice interface that lets you talk to Claude Code hands-free while
seeing the results of its work in your editor. Push-to-talk from anywhere, spoken responses,
Claude works on your files in the background, you watch changes appear in Zed.

## Key Decision: ACP (Agent Client Protocol)

Voxcode is a pure **ACP client**. The Agent Client Protocol
(https://agentclientprotocol.com) standardizes communication between code editors/clients
and coding agents — it's the "LSP for AI agents." By speaking ACP, Voxcode works with
any ACP-compatible agent without agent-specific code.

### Why ACP, not custom

- **Ecosystem**: 20+ agents already support ACP — Codex, Pi, Gemini CLI, Copilot, Cline,
  Goose, and more. All work out of the box.
- **Standardized protocol**: JSON-RPC 2.0 over stdio. Well-defined message types for
  streaming output, tool calls, permissions, plans, slash commands.
- **Designed for headless clients**: Omit `fs` and `terminal` capabilities — the agent
  handles files directly on disk. Perfect for a voice client.
- **Permission system built in**: `session/request_permission` is a blocking JSON-RPC
  method call from agent to client. The client shows a native dialog and responds.

### Claude Code via claude-agent-acp

Claude Code doesn't natively speak ACP. Zed maintains `claude-agent-acp`
(https://github.com/zed-industries/claude-agent-acp) — a production-ready ACP adapter
that wraps the Claude Agent SDK.

**Install**:
```bash
npm install -g @zed-industries/claude-agent-acp
# or download standalone binary from GitHub Releases (no Node.js needed)
```

**Run**: `ANTHROPIC_API_KEY=sk-... claude-agent-acp`

Voxcode launches it as a subprocess and speaks ACP. No Claude-specific code in Voxcode.

### Architecture

```
Voxcode.app (ACP Client)
    │
    │ JSON-RPC 2.0 over stdio
    │
    ├── claude-agent-acp  → Claude Code
    ├── codex             → OpenAI Codex
    ├── gemini-cli        → Google Gemini
    ├── pi                → Pi
    └── (any ACP agent)   → just works
```

### ACP Protocol Summary

**Client → Agent (methods)**:
- `initialize` — negotiate capabilities
- `session/new` — create session with `cwd`
- `session/prompt` — send user message (text, image, or audio)
- `session/cancel` — interrupt processing

**Agent → Client (notifications)**:
- `session/update` with `message_chunk` — streaming text (→ TTS)
- `session/update` with `tool_call_update` — tool activity (→ activity log)
- `session/update` with `plan` — execution plan

**Agent → Client (method calls, blocking)**:
- `session/request_permission` — permission request (→ native alert)

### Internal Event Model

ACPClient translates ACP messages into `AgentEvent` stream that the UI binds to:

```swift
public enum AgentEvent: Sendable {
    case initialized(AgentSession)
    case textResponse(String)     // → TTS + activity log
    case textDelta(String)        // → sentence-level streaming TTS
    case toolCall(ToolCall)       // → activity log entry
    case toolResult(ToolResult)   // → activity log entry
    case permissionRequest(PermissionRequest)  // → native alert
    case completed(CompletionInfo)
    case error(AgentError)
}
```

Agent selection is configuration, not code:
```swift
// Claude
try await engine.startAgent(config: .claude(), workingDirectory: projectURL)

// Codex
try await engine.startAgent(config: .codex(), workingDirectory: projectURL)

// Any ACP agent
try await engine.startAgent(config: .custom(path: "/usr/local/bin/my-agent"), workingDirectory: projectURL)
```

## Architecture: Headless ACP Agent + Editor as Display

The key insight: **your editor IS the display**. The ACP agent runs headless, reads and
edits files on disk, and you see those changes live in Zed. The menu bar app provides
voice I/O and an activity log.

```
┌─ Your Screen ──────────────────────────────────────┐
│                                                    │
│  ┌─ Zed (your editor) ────────────────────────┐    │
│  │                                            │    │
│  │  Files change in real-time as Claude edits  │    │
│  │  Click file links in activity log →         │    │
│  │    opens here at the changed line           │    │
│  │                                            │    │
│  └────────────────────────────────────────────┘    │
│                                                    │
│  ┌─ Menu Bar ──────────────────────────────┐       │
│  │  🎙 ▾                                   │       │
│  │  ┌─ Activity Log (hover/click) ──────┐  │       │
│  │  │                                   │  │       │
│  │  │ 2:14  📖 Read Package.swift       │  │       │
│  │  │ 2:14  📖 Read Sources/main.swift  │  │       │
│  │  │ 2:14  💬 "I see the project       │  │       │
│  │  │          structure. I'll add the   │  │       │
│  │  │          new endpoint now."        │  │       │
│  │  │ 2:15  ✏️  Edit routes.swift:42     │  │  ← click opens in Zed
│  │  │ 2:15  ▶ swift build               │  │       │
│  │  │ 2:15  ✓ Build succeeded            │  │       │
│  │  │ 2:15  💬 "Done. Added the /users   │  │       │
│  │  │          endpoint. Build passes."  │  │       │
│  │  │                                   │  │       │
│  │  │ ─── Files Changed ─────────────── │  │       │
│  │  │  ✏️  Sources/routes.swift:42       │  │  ← click opens at line 42
│  │  │  ✏️  Sources/models.swift:18       │  │  ← click opens at line 18
│  │  │  ➕ Tests/routeTests.swift         │  │  ← click opens new file
│  │  │                                   │  │       │
│  │  └───────────────────────────────────┘  │       │
│  │                                         │       │
│  │  [⚙ Settings]  [🔄 New Session]         │       │
│  └─────────────────────────────────────────┘       │
│                                                    │
│  🎤 Push-to-talk: ⌥Space from anywhere             │
│  🔊 Claude speaks responses aloud                   │
└────────────────────────────────────────────────────┘
```

### Process Architecture

```
┌─────────────────────────────────────────────────┐
│ Voxcode.app (menu bar)                      │
│                                                 │
│  ┌─────────┐     ┌──────────────────────────┐   │
│  │ Mic     │────▶│ STT Engine               │   │
│  │ Capture │     │ (Apple / ElevenLabs)      │   │
│  └─────────┘     └──────────┬───────────────┘   │
│                             │ transcript        │
│                             ▼                   │
│  ┌──────────────────────────────────────────┐   │
│  │ claude --print                           │   │
│  │   --input-format stream-json             │   │
│  │   --output-format stream-json            │   │
│  │   --verbose                              │   │
│  │   --include-partial-messages             │   │
│  │   --allowedTools "Read" "Glob" ...       │   │
│  │                                          │   │
│  │ Working directory: ~/code/my-project     │   │
│  │ Claude reads/edits files on disk         │   │
│  └──────────┬───────────────────────────────┘   │
│             │ stream-json events                │
│             ├──────────────────┐                │
│             ▼                  ▼                │
│  ┌──────────────────┐  ┌───────────────────┐   │
│  │ Activity Log     │  │ TTS Engine        │   │
│  │ (SwiftUI List)   │  │ (speaks Claude's  │   │
│  │                  │  │  text responses)  │   │
│  │ • Tool calls     │  └───────────────────┘   │
│  │ • File changes   │                          │
│  │ • Responses      │  ┌───────────────────┐   │
│  │                  │  │ FSEvents watcher  │   │
│  │ Clickable files  │──│ (working dir)     │   │
│  │ → open in Zed    │  └───────────────────┘   │
│  └──────────────────┘                          │
│                                                 │
│  ┌──────────────────────────────────────────┐   │
│  │ Permission Handler                       │   │
│  │ control_request → native macOS alert     │   │
│  │ with all options + text/voice input      │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

### Why This Works

1. **No terminal needed** — Claude works on files headlessly. You see results in your editor.
2. **Structured output** — Stream-json gives us typed events. We know exactly what tool was
   called, what file was edited, at what line. No ANSI parsing.
3. **Clean TTS** — Text responses are separated from tool output in the JSON. We speak only
   Claude's words, not file contents or command output.
4. **File links** — Edit events include file paths and line numbers. Click to open in Zed
   via `Process("/usr/local/bin/zed", arguments: ["path/to/file:line"])`.

## Permission System

### Default mode: Standard allow list

Claude starts with pre-approved safe tools:
```bash
--allowedTools "Read" "Glob" "Grep" "WebSearch" "WebFetch"
```

Tools not in the allow list trigger a `control_request` event. The app shows a **native
macOS alert** with:

```
┌─────────────────────────────────────────────┐
│ Claude wants to use: Edit                    │
│                                             │
│ File: Sources/routes.swift                   │
│ Lines 42-58: Adding /users endpoint handler  │
│                                             │
│ ┌─────────────────────────────────────────┐  │
│ │ (text input for custom instructions)    │  │
│ │ or use 🎤 to speak instructions         │  │
│ └─────────────────────────────────────────┘  │
│                                             │
│ [Allow]  [Allow All]  [Deny]  [Deny All]    │
└─────────────────────────────────────────────┘
```

**Response options** (all map to `control_response`):

| Button | Behavior | `control_response` |
|--------|----------|-------------------|
| Allow | Approve this one tool call | `{"behavior": "allow"}` |
| Allow All | Approve this tool for the session | `{"behavior": "allow"}` + add to runtime allow list |
| Deny | Reject this tool call | `{"behavior": "deny"}` |
| Deny All | Reject this tool for the session | `{"behavior": "deny"}` + add to runtime deny list |
| Text/Voice input | Send custom instructions back | `{"behavior": "deny", "message": "..."}` — Claude sees the feedback |

The text/voice input field lets you redirect Claude:
- Type: "Don't edit that file, use a new file instead"
- Or push-to-talk in the dialog to speak the instruction
- This gets sent as the denial message, so Claude understands why and adjusts

### Autonomous mode: Toggle in settings

A toggle in settings enables `--dangerously-skip-permissions`. Claude runs fully autonomous —
no approval dialogs. The menu bar icon changes color to indicate autonomous mode is active.
Activity log still shows everything that happened.

### Runtime allow list

As you approve tools during a session, the app tracks which tools you've allowed. These
persist for the session (not across sessions). The settings view shows the current allow
list and lets you modify it.

## Activity Log

The activity log is the primary UI. It's a SwiftUI `List` in the menu bar popover that
renders stream-json events in real-time.

### Event rendering

| Stream-JSON type | Log entry |
|-----------------|-----------|
| `assistant` with text content | 💬 Claude's words (the part we also TTS) |
| `assistant` with `tool_use` (Read) | 📖 Read `path/to/file` |
| `assistant` with `tool_use` (Edit) | ✏️ Edit `path/to/file:line` — clickable |
| `assistant` with `tool_use` (Write) | ➕ Write `path/to/file` — clickable |
| `assistant` with `tool_use` (Bash) | ▶ `command preview` |
| `assistant` with `tool_use` (Glob) | 🔍 Search `pattern` |
| `assistant` with `tool_use` (Grep) | 🔍 Grep `pattern` |
| `user` (tool_result) | Result preview (truncated, expandable) |
| `result` | ✓ Done (or ✗ Error) with cost/duration |
| `control_request` | ⚠️ Permission needed (with action buttons inline) |
| `stream_event` | Not shown individually; accumulates into the text response |

### File changes section

Below the event log, a "Files Changed" section tracks all files Claude has modified in the
current session. Populated from `Edit` and `Write` tool_use events.

Each entry is clickable:
```swift
// Open file in Zed at specific line
func openInZed(path: String, line: Int? = nil) {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/local/bin/zed")
    if let line {
        process.arguments = ["\(path):\(line)"]
    } else {
        process.arguments = [path]
    }
    try? process.run()
}
```

Line numbers are extracted from Edit tool_use input — the `old_string` match position gives
us the line. For Write events, open at line 1.

### Log persistence

Activity logs are saved as JSON to `~/.voxcode/logs/YYYY-MM-DD-HHMMSS.json` for
review. Not rendered as markdown — raw structured data for potential future use
(search, analytics, export).

## ACP Protocol Quick Reference

### Initialization (client → agent)

```json
{"jsonrpc": "2.0", "id": 0, "method": "initialize", "params": {
  "protocolVersion": 1,
  "capabilities": {},
  "clientInfo": {"name": "voxcode", "title": "Voxcode", "version": "0.1.0"}
}}
```

### Create session (client → agent)

```json
{"jsonrpc": "2.0", "id": 1, "method": "session/new", "params": {
  "cwd": "/Users/michael/code/my-project"
}}
```

### Send prompt (client → agent)

```json
{"jsonrpc": "2.0", "id": 2, "method": "session/prompt", "params": {
  "sessionId": "sess_abc123",
  "content": [{"type": "text", "text": "Add a /users endpoint to the API"}]
}}
```

### Streaming output (agent → client, notifications)

```json
{"jsonrpc": "2.0", "method": "session/update", "params": {
  "sessionId": "sess_abc123",
  "update": {"sessionUpdate": "message_chunk", "content": [{"type": "text", "text": "I'll start by..."}]}
}}

{"jsonrpc": "2.0", "method": "session/update", "params": {
  "sessionId": "sess_abc123",
  "update": {"sessionUpdate": "tool_call_update", "toolCallId": "tc_001", "title": "Edit routes.swift",
             "kind": "edit", "status": "in_progress", "location": {"path": "/src/routes.swift", "line": 42}}
}}
```

### Permission request (agent → client, blocking method call)

```json
{"jsonrpc": "2.0", "id": 10, "method": "session/request_permission", "params": {
  "sessionId": "sess_abc123",
  "toolCallId": "tc_001",
  "description": "Run: swift build"
}}
```

Client responds:
```json
{"jsonrpc": "2.0", "id": 10, "result": {"outcome": "allow_once"}}
```

Outcome values: `allow_once`, `allow_always`, `reject`, `cancelled`

### Prompt completion (agent → client, response to session/prompt)

```json
{"jsonrpc": "2.0", "id": 2, "result": {"stopReason": "end_turn"}}
```

### Claude Code via claude-agent-acp

```bash
# Install
npm install -g @zed-industries/claude-agent-acp

# Or download standalone binary from GitHub Releases
# https://github.com/zed-industries/claude-agent-acp/releases

# Voxcode launches it as:
ANTHROPIC_API_KEY=sk-... claude-agent-acp
# Then speaks ACP over stdin/stdout
```

## Native API Stack

| Component | API | macOS Req | Notes |
|-----------|-----|-----------|-------|
| Audio capture | `AVAudioEngine` + `inputNode.installTap` | 10.15+ | System default mic; CoreAudio for device selection |
| STT (Phase 1) | `SFSpeechRecognizer` | 13+ | On-device with `requiresOnDeviceRecognition = true`; 1-min session limit, restart periodically |
| STT (Phase 2) | ElevenLabs Scribe v2 | Any | ~150ms, WebSocket streaming, server-side VAD |
| TTS (Phase 1) | `AVSpeechSynthesizer` | 10.14+ | Premium voices; buffer full sentences before speaking |
| TTS (Phase 2) | ElevenLabs Flash v2.5 | Any | ~75ms, streaming chunks, much better voice quality |
| Menu bar | `MenuBarExtra(.window)` | 13+ | Full SwiftUI, `LSUIElement` hides from Dock |
| Global hotkey | `KeyboardShortcuts` (sindresorhus) | 10.15+ | CGEventTap-based, Input Monitoring permission |
| Subprocess | `Foundation.Process` + `Pipe` | All | NDJSON line parsing; buffer partial lines on `\n` |
| File watching | `DispatchSource.makeFileSystemObjectSource` or FSEvents | All | Watch working directory for changes |
| Editor integration | `Process("/usr/local/bin/zed", args: ["file:line"])` | All | Opens Zed at specific line |

### Known Gotchas

1. **Bluetooth mic → SCO codec** — Degrades audio quality. Default to built-in mic.
2. **AVSpeechSynthesizer can't stream** — Buffer complete sentences before speaking.
3. **SFSpeechRecognizer 1-min limit** — Restart recognition task periodically.
4. **No AVAudioSession on macOS** — Device routing uses CoreAudio, not AVFoundation.
5. **Sentence boundary detection** — Detect `.!?` + whitespace in streaming text to trigger TTS.
6. **Pipe buffering** — `readabilityHandler` may deliver partial JSON lines. Buffer on `\n`.
7. **Zed CLI must be installed** — User runs `cli: install` from Zed command palette first.

## Implementation Phases

### Phase 1: Headless Voxcode with Activity Log (Apple-native)

**Goal**: Menu bar app. Push-to-talk → Apple STT → Claude (stream-json) → Apple TTS + activity
log with clickable file links that open in Zed.

**Swift Package structure**:
```
Voxcode/
├── Package.swift
├── Sources/
│   ├── VoxcodeCore/                ← shared library
│   │   ├── VoiceEngine.swift           ← orchestrator (@Observable, @MainActor)
│   │   ├── VoiceState.swift            ← enum: idle, listening, thinking, speaking
│   │   ├── STTEngine.swift             ← protocol
│   │   ├── AppleSTT.swift              ← SFSpeechRecognizer implementation
│   │   ├── TTSEngine.swift             ← protocol
│   │   ├── AppleTTS.swift              ← AVSpeechSynthesizer implementation
│   │   ├── ClaudeTransport.swift       ← stream-json subprocess manager
│   │   ├── ClaudeEvent.swift           ← parsed stream-json event types
│   │   ├── PermissionHandler.swift     ← control_request/response manager
│   │   ├── ActivityLog.swift           ← event log model (@Observable)
│   │   ├── ActivityEntry.swift         ← log entry types (tool call, response, etc.)
│   │   ├── FileChangeTracker.swift     ← tracks edited/written files with line numbers
│   │   ├── AudioDeviceManager.swift    ← CoreAudio device enumeration
│   │   └── EditorIntegration.swift     ← open file:line in Zed (or other editors)
│   │
│   └── VoxcodeApp/                 ← standalone menu bar app
│       ├── VoxcodeApp.swift        ← @main, MenuBarExtra(.window)
│       ├── ActivityLogView.swift       ← scrolling event log with clickable files
│       ├── FileChangesView.swift       ← changed files section with Zed links
│       ├── PermissionAlertView.swift   ← native alert for tool approval
│       ├── VoiceStatusView.swift       ← state indicator + push-to-talk prompt
│       ├── SettingsView.swift          ← provider, hotkey, permissions config
│       └── SessionPickerView.swift     ← new/resume/continue session
│
├── Tests/
│   └── VoxcodeCoreTests/
│       ├── ClaudeTransportTests.swift  ← stream-json round-trip
│       ├── ClaudeEventTests.swift      ← JSON parsing for all event types
│       ├── PermissionHandlerTests.swift
│       ├── ActivityLogTests.swift
│       └── FileChangeTrackerTests.swift
│
└── Resources/
    ├── Info.plist                       ← LSUIElement, privacy descriptions
    └── Voxcode.entitlements         ← sandbox disabled
```

**VoiceEngine state machine**:
```
idle ──(push-to-talk down)──▶ listening
listening ──(push-to-talk up)──▶ processing_stt
processing_stt ──(transcript ready)──▶ thinking
thinking ──(claude response complete)──▶ speaking
speaking ──(TTS complete)──▶ idle

thinking ──(control_request)──▶ awaiting_permission
awaiting_permission ──(user responds)──▶ thinking

Any state ──(error)──▶ idle (with error display)
```

**Acceptance criteria**:
- [ ] Menu bar icon shows voice state (idle/listening/thinking/speaking)
- [ ] Menu bar icon changes color in autonomous mode
- [ ] Global push-to-talk hotkey (default: ⌥Space) works from any app
- [ ] Apple STT transcribes speech on-device
- [ ] Transcript sent to Claude via stream-json
- [ ] Claude's text responses spoken via AVSpeechSynthesizer
- [ ] Activity log shows all tool calls with icons and timestamps
- [ ] File paths in activity log are clickable → opens in Zed at correct line
- [ ] Files Changed section lists all modified files
- [ ] Permission alerts show all options: Allow, Allow All, Deny, Deny All
- [ ] Permission alerts include text input field for custom instructions
- [ ] Permission alerts support voice input (push-to-talk in dialog)
- [ ] Settings toggle for autonomous mode (dangerously-skip-permissions)
- [ ] Settings show current runtime allow list
- [ ] Session controls: new session, resume last, pick working directory
- [ ] Quit gracefully terminates Claude subprocess
- [ ] Activity logs persisted to ~/.voxcode/logs/

### Phase 2: ElevenLabs Integration

**Goal**: Swap in ElevenLabs for better voice quality and lower latency.

**New files**:
```
VoxcodeCore/
├── ElevenLabsSTT.swift    ← Scribe v2 WebSocket streaming
├── ElevenLabsTTS.swift    ← Flash v2.5 streaming chunks
└── ElevenLabsConfig.swift ← API key (Keychain), voice selection
```

**STT upgrade**:
- Apple: record full utterance → send buffer → wait for `isFinal`
- ElevenLabs: WebSocket streaming with server-side VAD → transcript arrives as speech ends
- ~150ms latency vs Apple's 500-2000ms

**TTS upgrade — sentence-level streaming**:
```swift
// Accumulate tokens from stream_event deltas
var sentenceBuffer = ""
for await event in claudeOutput {
    if let delta = event.textDelta {
        sentenceBuffer += delta
        if let range = sentenceBuffer.range(of: /[.!?]\s/) {
            let sentence = String(sentenceBuffer[..<range.upperBound])
            sentenceBuffer = String(sentenceBuffer[range.upperBound...])
            await ttsEngine.speak(sentence)  // queues playback
        }
    }
}
if !sentenceBuffer.isEmpty {
    await ttsEngine.speak(sentenceBuffer)
}
```

ElevenLabs Flash v2.5 can start speaking a sentence while Claude is still generating
the next one. First words come out ~75ms after the sentence text is sent.

**Acceptance criteria**:
- [ ] ElevenLabs STT works with WebSocket streaming
- [ ] ElevenLabs TTS speaks first sentence before full response is generated
- [ ] Provider selection in settings (Apple / ElevenLabs)
- [ ] API key stored in macOS Keychain
- [ ] Voice selection UI (George, Sarah, Daniel, Charlotte, or custom)
- [ ] Fallback to Apple providers if ElevenLabs unavailable

### Phase 3: Advanced Features

- **Barge-in**: Detect speech during TTS playback, stop speaking, send new transcript
- **Wake word**: Optional "Hey Claude" activation (no push-to-talk needed)
- **Conversation export**: Save voice transcripts as markdown
- **Session continuity**: `--resume` to continue conversations across app restarts
- **Multi-directory**: Switch working directory without restarting Claude
- **Cost tracking**: Show token usage and estimated cost in activity log footer
- **Notification integration**: macOS notifications for completed long-running tasks

### Phase 4: Workspaces Integration

**Goal**: Add voice to Workspaces app. Push-to-talk in any workspace.

**Approach**: Add `VoxcodeCore` as dependency to Workspaces' `Package.swift`.

**Integration points**:
1. Voice button in workspace toolbar — toggle voice mode per workspace
2. Push-to-talk — global hotkey, same as standalone
3. Voice Q&A mode: dedicated stream-json Claude session alongside the terminal
4. Activity log as a panel in the workspace (right pane or overlay)
5. File changes integrate with existing file browser

**New files in Workspaces**:
```
Sources/WorkspaceManager/Voice/
├── VoiceOverlayView.swift          ← floating status indicator over terminal
├── WorkspaceVoiceController.swift  ← per-workspace voice state
├── VoiceActivityPanel.swift        ← activity log in right pane
└── VoiceSettingsView.swift         ← voice config in workspace settings
```

## Dependencies

### VoxcodeCore (Swift Package)

```swift
dependencies: [
    .package(url: "https://github.com/sindresorhus/KeyboardShortcuts", from: "2.0.0"),
],
```

Apple frameworks (linked, not SPM):
- `Speech` (SFSpeechRecognizer)
- `AVFoundation` (AVAudioEngine, AVSpeechSynthesizer)
- `CoreAudio` (device management)

ElevenLabs (Phase 2): `URLSession` + `URLSessionWebSocketTask` — no SDK dependency.
The REST and WebSocket APIs are simple enough to call directly.

## Repo Structure

```
~/code/voxcode/           ← new repo, Swift Package, standalone app
~/code/workspaces/             ← existing, adds VoxcodeCore dependency (Phase 4)
~/.claude/skills/vocal/        ← existing Python scripts, unchanged
~/.claude/backlog/voxcode-swift-plan.md  ← this plan
```

**Why its own repo** (not in `~/.claude/skills/vocal/`):
- Skills are things **Claude calls** — Python scripts invoked via Bash tool
- Voxcode is something that **calls Claude** — a standalone macOS app wrapping the CLI
- Different build system (SPM vs uv scripts), different lifecycle, different distribution
- The Python vocal skill stays unchanged — they serve opposite directions

**Scaffolded at `~/code/voxcode/`** with working build (`swift build` passes):
```
Sources/
├── VoxcodeCore/
│   ├── ACPClient.swift           ← ACP JSON-RPC client (stdio transport)
│   ├── ACPTypes.swift            ← ACP protocol message types (Codable)
│   ├── CodingAgent.swift         ← internal AgentEvent types (UI binds to these)
│   ├── VoiceEngine.swift         ← orchestrator (@Observable, @MainActor)
│   ├── VoiceState.swift          ← state machine enum
│   ├── STTEngine.swift           ← STT protocol
│   ├── TTSEngine.swift           ← TTS protocol
│   ├── ActivityLog.swift         ← log model + file change tracker
│   └── EditorIntegration.swift   ← open file:line in Zed/VS Code/Cursor
│
└── VoxcodeApp/
    ├── VoxcodeApp.swift      ← @main, MenuBarExtra(.window)
    └── ContentView.swift         ← activity log + status + controls (placeholder)

Tests/VoxcodeCoreTests/
    └── ClaudeEventTests.swift    ← placeholder for JSON parsing tests
```

Workspaces adds VoxcodeCore as a Swift package dependency in Phase 4.

## Permissions & Entitlements

```xml
<!-- Voxcode.entitlements -->
<dict>
    <key>com.apple.security.app-sandbox</key>
    <false/>
</dict>
```

```xml
<!-- Info.plist -->
<key>LSUIElement</key>
<true/>

<key>NSSpeechRecognitionUsageDescription</key>
<string>Voxcode uses speech recognition to transcribe your voice for Claude Code.</string>

<key>NSMicrophoneUsageDescription</key>
<string>Voxcode needs microphone access to hear your voice commands.</string>
```

Input Monitoring permission (global hotkey) requested at runtime via
`CGPreflightListenEventAccess()` / `CGRequestListenEventAccess()`.

## Self-Eval Checklist

### Phase 1 gates
1. `swift build` succeeds with zero warnings
2. `swift test` passes all unit tests
3. Menu bar icon appears, popover opens with activity log
4. Global hotkey triggers listening state change
5. Apple STT transcribes "hello world" correctly
6. Stream-json round-trip: send message, receive structured response
7. Activity log renders tool calls with correct icons
8. Clicking file path in log opens Zed at correct line
9. Apple TTS speaks Claude's text response audibly
10. Permission alert appears for non-allowed tools
11. Permission alert text input sends feedback to Claude
12. Autonomous mode toggle works (skips all permissions)
13. Full loop: push-to-talk → speak → see activity → hear response → push again
14. Quit gracefully terminates Claude subprocess
15. `swift build -c release` succeeds for distribution

### Phase 2 gates
16. ElevenLabs STT transcribes via WebSocket streaming
17. ElevenLabs TTS speaks first sentence before full response arrives
18. Provider toggle works in settings
19. API key persisted in Keychain
20. Graceful fallback when ElevenLabs unavailable

## Existing Python Vocal Skill — Unchanged

The Python scripts at `~/.claude/skills/vocal/scripts/` remain as-is. They serve a different
purpose: tools that Claude calls from within a terminal session (`/vocal` command).

The two coexist:
- **Python vocal skill**: Claude-initiated ("Claude, speak this")
- **Swift Voxcode**: Human-initiated ("Hey Claude, listen to me")

## References

### ACP (Agent Client Protocol)
- ACP spec: https://agentclientprotocol.com
- ACP docs index: https://agentclientprotocol.com/llms.txt
- claude-agent-acp: https://github.com/zed-industries/claude-agent-acp
- ACP TypeScript SDK: `@agentclientprotocol/sdk` (npm)

### Voice / Audio
- Apple SFSpeechRecognizer: https://developer.apple.com/documentation/speech/sfspeechrecognizer
- Apple AVSpeechSynthesizer: https://developer.apple.com/documentation/avfaudio/avspeechsynthesizer
- ElevenLabs TTS: https://elevenlabs.io/docs/overview/capabilities/text-to-speech
- ElevenLabs STT: https://elevenlabs.io/realtime-speech-to-text
- ElevenLabs WebSocket: https://elevenlabs.io/docs/developers/websockets

### Swift / macOS
- KeyboardShortcuts: https://github.com/sindresorhus/KeyboardShortcuts
- SwiftUI skill: `~/.claude/skills/swiftui-expert-skill/`
- Zed CLI: `zed path/to/file:line:column` — opens at specific line

### Related
- Vocal skill (Python): `~/.claude/skills/vocal/`
- Workspaces app: `~/code/workspaces/`
- Scaffolded repo: `~/code/voxcode/`
