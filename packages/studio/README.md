# @kilnai/studio

Development UI for [Kiln](https://github.com/sequelcore/kiln). Private package -- not published to npm. Served at `/studio` when running in dev mode.

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

## Development

```bash
cd packages/studio
bun run dev        # Vite dev server (standalone, proxies to gateway)
bun run build      # Production build (output served by gateway at /studio)
bun run typecheck  # Type checking
```

In normal usage, Studio is accessed through `bunx @kilnai/cli dev`, which
serves the built output at `http://localhost:{port}/studio`.

## Documentation

- [Studio Overview](https://github.com/sequelcore/kiln/blob/main/docs/guides/studio.md)
- [Dev Mode](https://github.com/sequelcore/kiln/blob/main/docs/getting-started.md)
