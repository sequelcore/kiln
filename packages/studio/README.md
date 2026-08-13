# Studio workspace

Development UI for [Kiln](https://github.com/sequelcore/kiln). Private package -- not published to npm. Served at `/studio` when running in dev mode.

> [!IMPORTANT]
> Studio is a private source workspace. The Kiln name and all `@kilnai/*`
> workspace coordinates are provisional during the planned rebrand.

## Views

| View | Purpose |
|------|---------|
| Graph | Interactive flow visualization of app structure (agents, teams, routing) via `@xyflow/react` |
| Playground | Send messages, test tools, inspect responses in real-time |
| Timeline | Chronological event stream with filtering and search |
| Eval | Run experiments, compare scorers, view dataset results |
| Cost | Per-model and per-role cost breakdown with usage charts |
| Safety | PII detections, content classifications, policy rail triggers |

## Stack

- React 19 + TypeScript 7+
- Vite 8+ (dev server and build)
- TanStack Query (server state)
- `@xyflow/react` (graph visualization)
- `@kilnai/react` (hooks for gateway communication)

## Develop from source

From the repository root:

```bash
bun install --frozen-lockfile
bun run --cwd packages/studio dev
bun run --cwd packages/studio build
bun run --cwd packages/studio typecheck
```

The standalone development server proxies gateway requests. The built output
is served by the runtime at `/studio` in development mode.

## Documentation

- [Studio guide](../../docs/guides/gui/studio.md)
- [Getting started from source](../../docs/getting-started.md)
