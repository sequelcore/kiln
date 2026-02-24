# Kiln Studio

Kiln Studio is a development UI served in dev mode. It provides a visual interface for inspecting app topology, running agent conversations, monitoring events, managing memory, and reviewing evaluation results.

Studio is an internal package (`@kilnai/studio`, private) built with React 19, Vite, TanStack Router, TanStack Query, and `@xyflow/react`. It is not published to npm.

## Accessing Studio

```bash
kiln dev
```

Studio is served at `http://localhost:4800/studio/`. The `--playground` flag opens the browser automatically:

```bash
kiln dev --playground
```

### Two Startup Modes

**With `gateway.yaml`** (Mode B consumers): `kiln dev` calls `startGateway()` with full app loading, channels, providers, and triggers. Studio has access to live sessions and the Playground view.

**Without `gateway.yaml`** (Mode A consumers): `kiln dev` calls `startDevServer()` -- a lightweight Bun/Hono server with Studio + dev API endpoints only. No providers, channels, or sessions. Graph View and YAML editor work from `app.yaml` if present.

Both modes serve the built SPA at `/studio/*` using Hono's `serveStatic` middleware with SPA fallback. The `/dev/` path redirects to `/studio/` when the SPA is available.

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

### Graph View

Renders the app topology as an interactive `@xyflow/react` canvas. Nodes represent the Router, Teams, and Agents. Edges show routing relationships and agent-to-capability bindings.

Click any node to open a detail panel showing the full configuration of that entity. Topology data is fetched from `GET /dev/app-graph`. Live YAML editing is available via `GET /dev/yaml` and `PUT /dev/yaml`.

### Playground

A chat interface backed by the `useKilnChat` hook. Send messages to any loaded App and inspect responses inline.

A side panel displays tool calls and events from `useKilnEvents` in real time. Tool call entries show the capability name, arguments, result, and duration.

**Phase state indicator:** When `phase_changed` events arrive, a pill next to the Playground header displays the current phase name and description.

**Approval cards:** When an `approval_requested` event arrives, an inline card appears in the message stream with the task description and Approve / Reject buttons. Reject reveals a text input for the rejection reason. Cards are hidden once an `approval_received` event confirms the action, or after manual resolution via the buttons. Calls `POST /dev/approve` and `POST /dev/reject` via `ApiClient`.

### Timeline

A waterfall visualization of `trace_span` events received from `useKilnEvents`. Each span is displayed as a horizontal bar proportional to its `durationMs`. Spans are grouped by session and phase.

Click a span to open a detail inspector showing the full span payload: phase, agent, tool, tokens, and cost.

### Memory Inspector

Displays memory entries grouped by scope. Tabs correspond to the five memory scopes: `user`, `agent`, `team`, `project`, `org`.

Each tab uses `useKilnMemory(scope)` to fetch and display entries. Supports:
- Viewing all entries in the selected scope
- Creating new entries with optional tags and metadata
- Deleting entries by ID

### Eval Dashboard

Displays experiment results and score comparisons. Experiments are fetched from `GET /dev/eval/experiments`. Individual results from `GET /dev/eval/experiments/:name/results`.

Score visualization shows per-scorer averages across all dataset items. When an experiment declares a `compare` field, a side-by-side table is rendered with delta indicators for each scorer.

## Dev API Endpoints

All dev endpoints are mounted at `/dev/` when the Gateway starts in dev mode (`devMode: true`).

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/dev/state` | Current gateway and session state. |
| `GET` | `/dev/events` | SSE stream of all engine events (32 types). |
| `GET` | `/dev/memory/:scope` | List memory entries for a scope. |
| `POST` | `/dev/memory` | Create a memory entry. |
| `DELETE` | `/dev/memory/:id` | Delete a memory entry by ID. |
| `GET` | `/dev/cost` | Cumulative cost tracking data by role and model. |
| `GET` | `/dev/apps` | List loaded App names. |
| `GET` | `/dev/triggers` | List all registered triggers across all Apps. |
| `GET` | `/dev/app-graph` | Serialized App composite for the Graph View. |
| `GET` | `/dev/yaml` | Read the current `app.yaml` content. |
| `PUT` | `/dev/yaml` | Write and validate an updated `app.yaml`. |
| `GET` | `/dev/safety` | Safety pipeline metrics (enabled, counters). |
| `GET` | `/dev/eval/experiments` | List all configured experiments. |
| `GET` | `/dev/eval/experiments/:name/results` | Fetch results for a named experiment. |
| `POST` | `/dev/approve` | Approve a pending phase gate. Body: `{ sessionId? }`. |
| `POST` | `/dev/reject` | Reject a pending phase gate. Body: `{ reason?, sessionId? }`. |

Dev endpoints are only active when `devMode: true`. They are not mounted in production.

## Fallback: Inline HTML Debugger

When Studio is not built, `GET /dev/` serves a self-contained HTML page with zero external dependencies. It connects to `/dev/events` via `EventSource` and provides read-only views of:

- Event stream (real-time, all 32 types)
- Current state (`/dev/state`)
- Memory entries (`/dev/memory`)
- Cost data (`/dev/cost`)
- Loaded apps (`/dev/apps`)
- Registered triggers (`/dev/triggers`)

The fallback debugger is generated by `createDevInspectorHtml()` in `packages/runtime/src/gateway/dev-inspector.ts`.
