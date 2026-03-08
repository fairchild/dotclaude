# iOS Simulator Interaction Reference

## Prerequisites

- `cliclick` (install via `brew install cliclick`)
- Xcode with Simulator
- `xcrun simctl` CLI

## Coordinate Mapping

The Simulator window renders the device screen within a macOS window. To click on device UI elements, map from screenshot pixel coordinates to macOS screen coordinates.

### Step 1: Get window geometry

```bash
osascript -e 'tell application "System Events" to tell process "Simulator" to get {position, size} of window 1'
# Returns: x, y, width, height (e.g., 890, 48, 412, 884)
```

### Step 2: Compute scale factor

The simctl screenshot is at native device resolution (e.g., 1206x2622 for iPhone 17 Pro).

```
scale = (window_height - title_bar) / screenshot_height
# title_bar ≈ 28px on macOS
# Example: (884 - 28) / 2622 = 0.3265
```

### Step 3: Map pixel to screen coordinate

```
screen_x = window_x + (window_width - screenshot_width * scale) / 2 + pixel_x * scale
screen_y = window_y + title_bar + pixel_y * scale
```

Simplified with precomputed offset:
```
x_offset = window_x + (window_width - screenshot_width * scale) / 2
y_offset = window_y + 28  # title bar
screen_x = x_offset + pixel_x * scale
screen_y = y_offset + pixel_y * scale
```

## Clicking Patterns

### Reliable click sequence

```bash
# 1. Activate Simulator
osascript -e 'tell application "Simulator" to activate'
sleep 0.5

# 2. Focus click (anywhere in content area)
cliclick c:$center_x,$center_y
sleep 0.3

# 3. Navigation click
cliclick c:$target_x,$target_y
sleep 1.5

# 4. Screenshot
xcrun simctl io "$DEVICE" screenshot output.png
```

### When single clicks fail: sweep

Small or hard-to-hit targets (nav bar buttons, back buttons) often need a sweep:

```bash
for y in $(seq $start_y 10 $end_y); do
  cliclick c:$target_x,$y
  sleep 0.3
done
```

### Back navigation is unreliable

Back buttons and edge swipes are hard to trigger via cliclick. Instead:

```bash
# Terminate and relaunch to reset to root
xcrun simctl terminate "$DEVICE" $BUNDLE_ID
sleep 0.5
xcrun simctl launch "$DEVICE" $BUNDLE_ID
sleep 3  # wait for full load
```

Then navigate forward from root to the desired screen.

## Common Device Info

| Device | Resolution | Logical Points |
|--------|-----------|---------------|
| iPhone 17 Pro | 1206x2622 | 402x874 @3x |
| iPhone 16 Pro | 1179x2556 | 393x852 @3x |
| iPhone 16 | 1179x2556 | 393x852 @3x |

## Tips

- Always query window position fresh — it changes between launches
- Wait 3+ seconds after app launch before interacting
- A focus click in the content area before the real click improves reliability
- The first click from the home screen is most reliable; deeper navigation is flaky
- For multi-level navigation, use the sweep pattern or relaunch between each level
