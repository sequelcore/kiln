# Prompt-Driven Recorder Wiring

Status: completed on 2026-05-14.

## Objective

Make agent prompts that request QA/showcase videos produce recorder artifacts
end to end through the normal browser tool path. The runtime must create
recorder evidence during governed browser use, render the browser WebM, export
editor sidecars, and return artifact links on session stop.

## Scope

- Wire Playwright browser provider construction to a shared artifact store and
  `PlaywrightBrowserCaptureRecorder` across GUI/TUI prompt surfaces.
- Treat `browser_session_start.recordArtifacts=true` as the governed recorder
  opt-in for a browser session.
- Finalize capture, render WebM, export editor sidecars, and return one
  recorder proof payload from `browser_session_stop`.
- Update model-facing browser tool copy so agents know to set
  `recordArtifacts` when a user asks for a showcase/video.
- Preserve existing browser sessions that do not request recorder artifacts.
- Keep existing artifact resource registry behavior so returned URIs are
  readable through the normal resource tools and GUI resource path.

## Non-Goals

- No new in-app browser backend.
- No editor-specific application automation.
- No broad GUI redesign.
- No unrelated config, timeout, or roadmap changes.

## Verification

- Added CLI config coverage proving Playwright provider options include a
  recorder built from the shared artifact store.
- Added runtime provider coverage proving recorded session stop returns
  capture, rendered WebM, captions, markers, editor project, and exported
  manifest URIs.
- Added coverage proving unrecorded browser sessions do not emit recorder
  proofs.
- Passed `bun run --filter @kilnai/runtime test -- playwright-browser-use-provider`.
- Passed `bun run --filter @kilnai/cli test -- interactive-use-config builtin-tool-surface-config`.
- Passed `bun run --filter @kilnai/core test -- default-tool-surface`.
- Passed `bun run --filter @kilnai/runtime test -- recorder`.
- Passed `bun run --filter @kilnai/cli test`.
- Passed `bun run --filter @kilnai/core test`.
- Passed `bun run typecheck`.
