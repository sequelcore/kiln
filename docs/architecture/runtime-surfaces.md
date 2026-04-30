# Runtime Surfaces

## Purpose

Kiln has one control-plane runtime and multiple surfaces that operate it. This
document is the canonical vocabulary for those surfaces across app deployment,
local GUI workflows, Studio, CLI, TUI, SDK, widget, and MCP.

The control-plane owner for deployed apps is the app gateway started from
`gateway.yaml`. Operator surfaces may run helper servers or use separate ports,
but they must not become separate app control planes.

## Canonical Surface Taxonomy

| Surface | Owner | Configuration | Primary protocol | Scope |
|---------|-------|---------------|------------------|-------|
| App Gateway | `startGateway(gateway.yaml)` | `gateway.yaml` plus bound `app.yaml` files | HTTP, WebSocket, channels, MCP | Deployable runtime for real apps, tenants, sessions, memory, safety, events, triggers, and tool gates. |
| Operator Gateway | `startGuiGateway()` / `startTuiGateway()` | CLI flags and local operator state | HTTP and WebSocket operator contract | Local human-operator bridge for coding/dev sessions. It is not a deployable app host and must attach to an App Gateway when operating deployable YAML apps. |
| Studio Dev Server | `kiln dev` | `.kiln/gateway.yaml` or local `app.yaml` | `/studio/*` and `/dev/*` | Development and inspection surface. With `gateway.yaml`, it runs the App Gateway in dev mode. Without it, it is a lightweight editor/inspector server. |
| CLI | `@kilnai/cli` commands | CLI flags plus projected global config | Local process, HTTP/WS attach, MCP projection | Automation, validation, launch, sync, and scripting surface. CLI does not own app runtime semantics. |
| GUI | `@kilnai/gui` | Operator preferences plus gateway attach target | HTTP/WS operator contract | First-party human operator UI. It should attach to an existing App Gateway when operating YAML apps. |
| TUI | `@kilnai/tui` | Operator preferences plus gateway attach target | WebSocket operator contract | Frozen legacy terminal surface. It must not define future runtime architecture. |
| SDK / Widget | `@kilnai/react`, `@kilnai/widget` | Consumer app config | Public app/channel contracts | Embedding and product integration surfaces. |
| MCP | Gateway MCP endpoint or projected MCP servers | Gateway/config projection | MCP | External tool and host contract for agents, IDEs, and wrappers. MCP is not the internal GUI-to-gateway operator protocol. |

## Ownership Rules

1. `startGateway(gateway.yaml)` is the app-runtime owner for YAML apps.
2. `gateway.yaml` binds deployable apps, channels, auth, MCP exposure, and
   runtime wiring.
3. `app.yaml` declares a domain app that the App Gateway instantiates at
   runtime.
4. GUI, CLI, and TUI are operator surfaces. They may launch or attach to a
   gateway, but they do not redefine session, memory, safety, cost, event, or
   tool semantics.
5. Operator helper gateways may use separate local ports. Separate ports are
   acceptable; duplicate app control planes are not.
6. MCP is the external tool/host boundary. GUI, CLI, and TUI should use the
   operator HTTP/WS contract for administrative state, live sessions, logs,
   replay, approvals, config diagnostics, and telemetry.
7. A local machine may run multiple App Gateways only when they represent
   distinct environments, projects, or isolation boundaries.

## Canonical Local Topology

For a versioned deployable repo such as `kiln-gateway`:

```text
kiln-gateway :3800
  - startGateway(gateway.yaml)
  - loads apps/*/app.yaml
  - owns app sessions, tenant state, memory, safety, channels, events, MCP

kiln gui --connect http://localhost:3800
  - attaches to the existing App Gateway
  - renders and operates sessions, logs, approvals, memory, policy, telemetry
  - selects the app/tenant target published by the App Gateway dashboard
  - does not start another app runtime

kiln cli commands
  - validate, inspect, replay, deploy, or operate the same gateway

MCP clients
  - connect to http://localhost:3800/mcp when they need Kiln tools
```

`kiln gui` without an attach target starts a local Operator Gateway for
developer/operator sessions. That mode is separate from operating YAML apps and
does not own app runtime topology.

## App YAML Capability Position

YAML apps remain a first-class deployable surface for Kiln. They are not made
obsolete by GUI, CLI, TUI, SDK, or MCP work.

The canonical relationship is:

```text
app.yaml + gateway.yaml
  -> App Gateway control plane
  -> operator HTTP/WS contract
  -> GUI / CLI / TUI

App Gateway
  -> MCP
  -> external agents, IDEs, wrappers, and tool hosts
```

Capabilities converge in core/runtime and are projected outward. They are not
reimplemented independently in each surface.

## Memory Lattice Surface Rule

Memory Lattice follows the same ownership model:

```text
@kilnai/core memory bounded context
  -> memory graph resources
  -> App Gateway / Operator Gateway contract
  -> GUI / CLI / TUI / SDK / MCP
```

The GUI is the first visual consumer, not the owner. No surface may create a
private memory graph, bypass core scope validation, or decide model-context
admission locally. YAML apps may declare memory policy in the future, but they
do not declare GUI layout.

## Naming Guidance

Use precise names in new docs and code:

- `App Gateway` for the deployable `startGateway(gateway.yaml)` runtime.
- `Operator Gateway` for local GUI/TUI bridge servers.
- `Studio Dev Server` for `kiln dev` without a gateway config.
- `operator API` or `operator HTTP/WS contract` for GUI/CLI/TUI control.
- `MCP endpoint` for external tool-host integration.

Avoid using "the gateway" without a qualifier when a document discusses both
deployable apps and operator surfaces.
