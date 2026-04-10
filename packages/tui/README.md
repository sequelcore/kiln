# @kilnai/tui

Terminal interface package for Kiln.

`@kilnai/tui` owns terminal rendering, keyboard handling, theme application,
sidebar state, and the WebSocket session adapter used by `kiln tui`.
It is still intentionally thin: orchestration, routing, persistence, and
provider execution stay outside this package.

What this package does:

- render the interactive two-column terminal UI
- expose built-in themes
- manage picker state for providers, themes, and session resume
- adapt gateway WebSocket frames into TUI session events
- preserve a stable TUI WebSocket user ID across reconnects

What this package does not own:

- provider execution
- permission translation
- runtime orchestration
- session persistence policy
- prompt construction

Those responsibilities stay in `@kilnai/core`, `@kilnai/runtime`, and
`@kilnai/cli`.
