# Capture Screens

Screenshot each screen in an app's user flow and generate an HTML gallery.

## Steps

### 1. Capture each screen

For each screen in the flow:

1. **Screenshot the current state:**
   ```bash
   xcrun simctl io "<device>" screenshot docs/screens/<NN>-<name>.png
   ```

2. **Navigate to next screen** using cliclick. See `references/simulator-interaction.md` for coordinate mapping.

3. **For deeper screens**, terminate and relaunch the app, then navigate forward from root.

### 2. Create screens.yaml

Create `docs/screens/screens.yaml` describing the flow:

```yaml
screens:
  - file: 01-home.png
    label: Home
    desc: Main screen with list of items
    action: Tap item
  - file: 02-detail.png
    label: Detail
    desc: Item detail view
    action: Tap edit
  - file: 03-edit.png
    label: Edit
    desc: Edit form
```

Each screen entry:
- `file` — screenshot filename
- `label` — short screen name
- `desc` — one-line description
- `action` — what the user does to reach the next screen (omit on last screen)

### 3. Generate gallery

```bash
bash ~/.claude/skills/ios-simulator/scripts/gallery.sh docs/screens "App Name"
```

Opens as `docs/screens/index.html`. Verify with `open docs/screens/index.html`.

### 4. Update when app evolves

Re-run the capture process for affected screens only. Update `screens.yaml` entries and regenerate the gallery. Keep screenshot filenames with numeric prefixes for ordering.
