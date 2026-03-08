---
name: ios-simulator
description: Automate iOS Simulator tasks — capture screenshots, interact with apps, generate screen flow galleries. Use when the user asks to capture app screens, screenshot the simulator, document the app UI, create a screen flow, interact with the simulator, or automate iOS testing workflows.
license: Apache-2.0
metadata:
  status: experimental
---

# iOS Simulator

Automate iOS Simulator workflows: build, launch, interact with apps, and capture artifacts.

## Fundamentals

### Build and launch

```bash
cd <project-dir>
xcodegen generate 2>&1  # if project.yml exists
xcodebuild -project *.xcodeproj -scheme <scheme> \
  -destination 'platform=iOS Simulator,name=<device>' build 2>&1 | tail -5
xcrun simctl boot "<device>" 2>&1 || true
open -a Simulator
APP_PATH=$(find ~/Library/Developer/Xcode/DerivedData/<project>-*/Build/Products/Debug-iphonesimulator/*.app -maxdepth 0 | head -1)
xcrun simctl install "<device>" "$APP_PATH"
xcrun simctl launch "<device>" <bundle-id>
sleep 3
```

### Simulator interaction

See `references/simulator-interaction.md` for coordinate mapping, click patterns, and device info.

### Key constraints

- Simulator clicks are unreliable for nav bar buttons and back navigation
- Always relaunch app to navigate to deep screens rather than trying back buttons
- Wait 3+ seconds after launch before clicking
- Use focus click + real click pattern for reliable interaction
- Query window position fresh each time — it shifts between sessions

## Workflows

| Workflow | When to use |
|----------|------------|
| [Capture Screens](references/capture-screens.md) | Screenshot each screen in a user flow and generate an HTML gallery |
