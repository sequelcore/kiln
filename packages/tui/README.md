# @kilnai/tui

Terminal interface package for Kiln.

> [!IMPORTANT]
> This is a provisional workspace package in a source-only development tree.
> There is no supported package installation for the current repository state.

From the repository root, start the TUI through the source CLI:

```bash
bun packages/cli/src/index.ts tui
```

`@kilnai/tui` owns terminal rendering, keyboard handling, theme application,
sidebar state, and the WebSocket session adapter used by `kiln tui`.
It is still intentionally thin: orchestration, routing, persistence, and
provider execution stay outside this package.

What this package does:

- render the interactive two-column terminal UI
- expose built-in themes
- manage picker state for providers, themes, and explicit session continuation
- adapt gateway WebSocket frames into TUI session events
- preserve a stable TUI WebSocket user ID across reconnects
- inspect settings with `/settings [query]`
- propose and apply admitted changes with
  `/settings set|reset [--global] [--approve] ...`

What this package does not own:

- provider execution
- permission translation
- runtime orchestration
- session persistence policy
- prompt construction
- settings governance, mutation settlement, or reconciliation policy

Those responsibilities stay in `@kilnai/core`, `@kilnai/runtime`, and
`@kilnai/cli`.
