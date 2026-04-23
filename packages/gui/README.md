# @kilnai/gui

Primary web operator surface for the Kiln control plane.

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
