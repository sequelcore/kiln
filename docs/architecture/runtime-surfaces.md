# Runtime Surfaces

## Purpose

Kiln has one control-plane runtime and multiple surfaces that operate it. This
document is the canonical vocabulary for those surfaces across app deployment,
local GUI workflows, native desktop, Studio, CLI, TUI, SDK, widget, and MCP.

The control-plane owner for deployed apps is the app gateway started from
`gateway.yaml`. Operator surfaces may run helper servers or use separate ports,
but they must not become separate app control planes.

## Canonical Surface Taxonomy

| Surface | Owner | Configuration | Primary protocol | Scope |
|---------|-------|---------------|------------------|-------|
| App Gateway | `startGateway(gateway.yaml)` | `gateway.yaml` plus bound `app.yaml` files | HTTP, WebSocket, channels, MCP | Deployable runtime for real apps, tenants, sessions, memory, safety, events, triggers, and tool gates. |
| Operator Gateway | `startGuiGateway()` / `startTuiGateway()` | CLI flags and local operator state | HTTP and WebSocket operator contract | Local human-operator bridge for coding/dev sessions. It is not a deployable app host and must attach to an App Gateway when operating deployable YAML apps. |
| Studio Dev Server | `kiln dev` | `.kiln/gateway.yaml` or local `app.yaml` | `/studio/*` and `/dev/*` | Development and inspection surface. With `gateway.yaml`, it runs the App Gateway in dev mode. Without it, it is a lightweight editor/inspector server. |
| CLI | `@kilnai/cli` commands | CLI flags plus projected global config | Local process, HTTP/WS attach, MCP projection | Public install surface for automation, validation, launch, sync, and scripting. CLI does not own app runtime semantics. |
| GUI | `@kilnai/gui` | Operator preferences plus gateway attach target | HTTP/WS operator contract | Public first-party human operator UI served by runtime. It should attach to an existing App Gateway when operating YAML apps. |
| Native | `@kilnai/native` | Operator preferences plus gateway attach target | HTTP/WS operator contract plus local Electron process | Source-only experimental desktop operator surface in this release. It owns native window lifecycle and surface telemetry only; runtime truth remains in App/Operator Gateway. |
| TUI | `@kilnai/tui` | Operator preferences plus gateway attach target | WebSocket operator contract | Public terminal operator surface. It projects the shared runtime contract and must not define independent runtime architecture. |
| SDK / Widget | `@kilnai/react`, `@kilnai/widget` | Consumer app config | Public app/channel contracts | Embedding and product integration surfaces. |
| MCP | Gateway MCP endpoint or projected MCP servers | Gateway/config projection | MCP | External tool and host contract for agents, IDEs, and wrappers. MCP is not the internal GUI-to-gateway operator protocol. |

## Ownership Rules

1. `startGateway(gateway.yaml)` is the app-runtime owner for YAML apps.
2. `gateway.yaml` binds deployable apps, channels, auth, MCP exposure, and
   runtime wiring.
3. `app.yaml` declares a domain app that the App Gateway instantiates at
   runtime.
4. GUI, Native, CLI, and TUI are operator surfaces. They may launch or attach
   to a gateway, but they do not redefine session, memory, safety, cost, event,
   or tool semantics.
5. Operator helper gateways may use separate local ports. Separate ports are
   acceptable; duplicate app control planes are not.
6. MCP is the external tool/host boundary. GUI, Native, CLI, and TUI should use
   the operator HTTP/WS contract for administrative state, live sessions, logs,
   replay, approvals, config diagnostics, and telemetry.

   Context usage is one such session projection: Runtime normalizes it once
   from adapter evidence, emits it with the completed turn, and preserves it
   for replay. Surfaces must not calculate a replacement percentage.
7. A local machine may run multiple App Gateways only when they represent
   distinct environments, projects, or isolation boundaries.

`@kilnai/cli` is the public global install boundary for CLI, GUI, TUI, runtime,
gateway contracts, and GUI static assets. `@kilnai/native` remains source-only
experimental work in this release. Packaged executable distribution is a later
release-engineering concern, not a runtime-surface contract. Installer targets,
signing, update channels, rollback, and user-data migration must be decided in a
dedicated packaging roadmap after the native surface proves it has enough
product value to distribute.

Native helper binaries, Rust, WASM, or sidecars do not change surface ownership.
They may support packaging or measured hot paths behind TypeScript-owned ports,
but App Gateway and Operator Gateway remain the control-plane owners for
runtime, authority, provider routing, memory, config, and operator contracts.

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

## App Gateway MCP Discovery

At App Gateway startup, configured app MCP servers are discovered before their
tools are projected into the app tool context. If an app declares an explicit
agent tool list and the first MCP discovery response omits configured tool
names, the App Gateway retries discovery before accepting the surface. A warning
is emitted only after the final retry still lacks configured tools.

This retry is a startup consistency guard for app/MCP restart races. It does not
authorize undeclared tools, bypass app tool allowlists, or change the MCP
endpoint boundary described above.

## App YAML Capability Position

YAML apps remain a first-class deployable surface for Kiln. They are not made
obsolete by GUI, CLI, TUI, SDK, or MCP work.

The canonical relationship is:

```text
app.yaml + gateway.yaml
  -> App Gateway control plane
  -> operator HTTP/WS contract
  -> GUI / Native / CLI / TUI

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
  -> GUI / Native / CLI / TUI / SDK / MCP
```

The GUI is the first visual consumer, not the owner. No surface may create a
private memory graph, bypass core scope validation, or decide model-context
admission locally. YAML apps may declare memory policy in the future, but they
do not declare GUI layout.

When the resource provider is absent or cannot produce a valid operator graph,
visual surfaces show an empty unavailable state instead of a transport failure.
The absence is still explicit data in the graph response; invalid queries remain
hard errors.

## Naming Guidance

Use precise names in new docs and code:

- `App Gateway` for the deployable `startGateway(gateway.yaml)` runtime.
- `Operator Gateway` for local GUI/TUI bridge servers.
- `Studio Dev Server` for `kiln dev` without a gateway config.
- `operator API` or `operator HTTP/WS contract` for GUI/Native/CLI/TUI
  control.
- `native operator surface` for the Electron-backed `@kilnai/native` surface;
  it is not a runtime and not a wrapper around `@kilnai/gui`.
- `MCP endpoint` for external tool-host integration.

Avoid using "the gateway" without a qualifier when a document discusses both
deployable apps and operator surfaces.
