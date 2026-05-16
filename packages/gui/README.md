# @kilnai/gui

Rich web operator surface for the Kiln control plane.

## Distribution

`@kilnai/gui` publishes the built static GUI assets consumed by
`@kilnai/runtime`. Install `@kilnai/cli` for normal operator use:

```bash
bun add -g @kilnai/cli
kiln gui
```

The package includes `dist/` for runtime serving. Development dependencies are
only needed when working on the GUI source in this repository.

## Development

```bash
bun run dev          # Vite dev server on http://localhost:5183
bun run build        # Production bundle → dist/
bun run typecheck    # TypeScript check
bun run lint         # ESLint
bun run test:run     # Vitest unit/component tests (single run)
```

## Design system

The GUI uses shadcn with Base UI primitives. Project configuration lives in
`components.json`, generated UI components live in `src/components/ui/`, and
shared class merging lives in `src/lib/utils.ts`.

Use semantic shadcn/Kiln tokens (`bg-card`, `text-muted-foreground`,
`border-border`, `ring-ring`) rather than raw colors. The global token bridge
is `src/styles.css`; update it instead of creating a second palette.

The current product direction is a dense operator surface, not a generic
dashboard: compact rows, hairline dividers, provider glyphs, clear active
continuation state, and visible telemetry where it helps supervision.

The visual direction follows Kiln's restrained biocybernetic cyberpunk identity:
Obsidian dark surfaces, graphite layering, precise signal color, and controlled
ember accents. It should read as a serious control plane, not a decorative
sci-fi skin or a borrowed code-editor theme.

## Layout ownership

The shell is split into a left operator rail, an optional mode panel, and the
main chat column. Keep ownership boundaries explicit:

- the left rail owns operator mode navigation and collapse state
- the mode panel owns mode-specific navigation, currently canonical sessions
  plus the event-backed changed-files review panel
- the main chat column owns conversation, active document surfaces, and turn
  composition
- operator modes own diagnostics such as activity, changed files, approvals,
  memory, setup, and workspace navigation
- the composer owns draft input, slash commands, file affordances, plan mode,
  provider/model route, reasoning effort, and send behavior

Do not repeat the same summary telemetry in multiple headers. If a value helps
diagnose why a turn behaved a certain way, it belongs in the relevant
event-backed operator mode instead of persistent chrome.

Inspector data should come from canonical timeline projections, not separate
GUI-maintained caches for files, approvals, or continuity.

The changed-files mode is intentionally honest about current runtime evidence:
it can show canonical file-change records and line deltas, but full diff hunks
must stay gated until the runtime emits structured diff payloads.

## Commands

`Ctrl+K` or `Cmd+K` opens the global command palette. Typing `/` into an empty
composer opens the composer-attached command surface. Both surfaces should use
the same command model, but their placement is intentional: global commands are
navigation/action commands, while slash commands are message-composition
commands.

## E2E tests (Playwright)

Install the browser once:

```bash
bun run playwright:install
```

Then run the e2e suite:

```bash
bun run test:e2e
```

Or from the repo root:

```bash
bun run test:e2e
```

The e2e suite starts a Vite dev server automatically (reuses an existing one if
already running outside CI). A lightweight mock gateway boots on port 4810 for
each test worker so the Vite proxy resolves `/gui-api/*` correctly.

To run with the Playwright UI:

```bash
bun run test:e2e:ui
```
