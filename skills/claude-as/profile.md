# Claude profile

This session runs as a named Claude profile (`claude-as $CLAUDE_PROFILE`; config in
`$CLAUDE_CONFIG_DIR`). The shared instructions above apply; this and the profile's own layer
add what differs. The tooling is the `claude-as` skill; this machine's profile layers live
in `$CLAUDE_PROFILES` (default `~/.config/claude-profiles/`). `claude-as --help` explains it.

## Browsers belong to the profile (macOS)

Each profile has its own Chrome and Safari profile, named in `$CLAUDE_CHROME_PROFILE` and
`$CLAUDE_SAFARI_PROFILE`. Use that one and no other.

- Chrome: `open -na "Google Chrome" --args --profile-directory="$CLAUDE_CHROME_PROFILE_DIR"`.
  With the claude-in-chrome tools, list the connected browsers first and select this profile's;
  don't drive another profile's window.
- Safari has no command-line flag for profiles. Open a window from the menu
  File > New Window > New <profile> Window, matching `$CLAUDE_SAFARI_PROFILE` in any case.
- If `CLAUDE_CHROME_PROFILE_DIR` is empty, the mapping isn't resolved. Say so and ask; don't
  fall back to whatever Chrome window is open.
