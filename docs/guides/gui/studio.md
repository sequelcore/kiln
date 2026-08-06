# Kiln Studio

Kiln Studio is the private development UI served by `kiln dev`. It inspects
App Gateway development state through `/studio/*` and `/dev/*`; it is not an
SDK package and is not published to npm.

Studio is implemented by `@kilnai/studio` with React 19, Vite, TanStack Query,
and `@xyflow/react`.

## Accessing Studio

```bash
kiln dev
```

Studio is served at `http://localhost:4800/studio/`. The `--playground` flag opens the browser automatically:

```bash
kiln dev --playground
```

### Two Startup Modes

**With `gateway.yaml`**: `kiln dev` starts an App Gateway in dev mode with app
loading, channels, providers, triggers, dev routes, and Studio static assets.

**Without `gateway.yaml`**: `kiln dev` starts the Studio Dev Server, a
lightweight Bun/Hono editor and inspector server. It is not an App Gateway and
does not own deployable app runtime semantics.

Both modes serve the built SPA at `/studio/*` using Hono's `serveStatic` middleware with SPA fallback. The `/dev/` path redirects to `/studio/` when the SPA is available.

These modes are intentionally different from the local GUI/TUI Operator Gateway
path. With `gateway.yaml`, Studio is inspecting an App Gateway in dev mode. Without
`gateway.yaml`, Studio is only an editor/inspector server and does not own app
runtime semantics. GUI/CLI/TUI should attach to an existing App Gateway when the
goal is to operate deployable YAML apps.

### Locating Studio

Studio is a pre-built static asset, not a runtime dependency. The runtime locates it by path, not by package resolution. Three mechanisms, checked in order:

1. **Explicit path via `KilnAppConfig.studioDistPath`** -- consumer apps set this to point at the `dist/` directory. This is the recommended approach for external consumers:

```typescript
const config: KilnAppConfig = {
  // ...
  studioDistPath: join(__dirname, "../../kiln/packages/studio/dist"),
};
```

2. **Auto-resolution via `require.resolve`** -- within the Kiln monorepo, `resolveStudioDist()` finds `@kilnai/studio` through workspace resolution. No configuration needed.

3. **Fallback** -- when Studio is not found, both modes fall back to an inline HTML debugger at `/dev/`. The console warns with the specific cause:
   - `@kilnai/studio not installed` -- set `studioDistPath` in your config or install the package
   - `@kilnai/studio found but dist/ not built` -- run `bun run build` in `packages/studio`

## Views

### App Graph

Renders the app topology as an interactive `@xyflow/react` canvas. Nodes represent the Router, Teams, and Agents. Edges show routing relationships and agent-to-capability bindings.

Click any node to open a detail panel showing the full configuration of that entity. Topology data is fetched from `GET /dev/app-graph`.

### Playground

A chat interface backed by the `useKilnWsChat` hook over WebSocket. Send messages to any loaded App and receive responses in real time.

A side panel displays tool calls and events from `useKilnEvents` in real time. Tool call entries show the capability name, arguments, result, and duration.

**Phase state indicator:** When `phase_changed` events arrive, a pill next to the Playground header displays the current phase name and description.

**Approval cards:** When an `approval_requested` event arrives, an inline card appears in the message stream with the task description and Approve / Reject buttons. Reject reveals a text input for the rejection reason. Cards are hidden once an `approval_received` event confirms the action, or after manual resolution via the buttons. Calls `POST /dev/approve` and `POST /dev/reject` via `ApiClient`.

### Timeline

A waterfall visualization of `trace_span` events received from `useKilnEvents`. Each span is displayed as a horizontal bar proportional to its `durationMs`. Spans are grouped by session and phase.

Click a span to open a detail inspector showing the full span payload: phase, agent, tool, tokens, and cost.

### Cost

Displays cost tracking data from `GET /dev/cost`. Summary grid shows total cost (USD), input tokens, output tokens, cache read/write tokens, and tool calls. A by-role breakdown table shows per-agent-role usage with model, token counts, and call counts. Auto-refreshes via `cost_update` SSE events from `useKilnEvents`.

### Safety

Displays safety pipeline metrics from `GET /dev/safety`. When the pipeline is configured, shows per-app metric cards in a 3-column grid: input/output scans, input/output blocks, PII detections, content blocks, and policy evaluations. Non-zero warning metrics are highlighted. Auto-refreshes every 5 seconds. Shows "Safety pipeline is not configured" when no pipeline is active.

### Eval

Displays experiment configurations and score comparisons. Experiments are fetched from `GET /dev/eval/experiments`.

Score visualization shows per-scorer averages across all dataset items. When an experiment declares a `compare` field, a side-by-side table is rendered with delta indicators for each scorer.

## Dev API Endpoints

All dev endpoints are mounted at `/dev/` when the Gateway starts in dev mode (`devMode: true`).

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/dev/state` | Current gateway and session state. |
| `GET` | `/dev/events` | SSE stream of all engine events (31 types). |
| `GET` | `/dev/cost` | Cumulative cost tracking data by role and model. |
| `GET` | `/dev/apps` | List loaded App names as `{ apps: string[] }`. |
| `GET` | `/dev/triggers` | List all registered triggers across all Apps. |
| `GET` | `/dev/app-graph` | Serialized App composite for the Graph View. |
| `GET` | `/dev/yaml` | Read the current `app.yaml` content. |
| `PUT` | `/dev/yaml` | Write and validate an updated `app.yaml`. |
| `GET` | `/dev/safety` | Safety pipeline metrics (enabled, counters). |
| `GET` | `/dev/eval/experiments` | List all configured experiments. |
| `POST` | `/dev/approve` | Approve a pending phase gate. Body: `{ approvalId }`. |
| `POST` | `/dev/reject` | Reject a pending phase gate. Body: `{ reason?, approvalId }`. |
| `POST` | `/dev/token` | Issue a dev-mode WebSocket auth token. Body: `{ userId? }`. |
| `POST` | `/dev/run` | Start a dev orchestrator run. Body: `{ task }`. |
| `GET` | `/dev/run` | Current orchestrator run status. |

Dev endpoints are only active when `devMode: true`. They are not mounted in production.

## Fallback: Inline HTML Debugger

When Studio is not built, `GET /dev/` serves a self-contained HTML page with zero external dependencies. It connects to `/dev/events` via `EventSource` and provides read-only views of:

- Event stream (real-time, all 31 types)
- Current state (`/dev/state`)
- Cost data (`/dev/cost`)
- Loaded apps (`/dev/apps`)
- Registered triggers (`/dev/triggers`)

The fallback debugger is generated by `createDevInspectorHtml()` in `packages/runtime/src/gateway/dev-inspector.ts`.
