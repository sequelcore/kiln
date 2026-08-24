# Local Operator Gateway Security

## Purpose

This document owns the network and browser-origin boundary for the local GUI
and TUI Operator Gateways. These gateways are local human-operator adapters;
they are not the deployable App Gateway and are not a remote-access boundary.

## Current Boundary

- GUI and TUI listeners bind explicitly to `127.0.0.1`. The runtime never
  relies on Bun's default hostname.
- Returned local URLs use `127.0.0.1`, so the advertised origin and listener
  address cannot diverge through `localhost` resolution.
- The bundled GUI admits only its exact runtime-selected HTTP origin.
- The external Vite GUI admits one additional exact `http://127.0.0.1:<port>`
  origin supplied by the source-development startup composition. Arbitrary
  schemes, hosts, credentials, paths, queries, fragments, and origin aliases
  fail before the listener starts.
- GUI API requests with a browser `Origin` receive a response only when that
  origin is in the startup-bound set. Successful CORS responses echo the exact
  origin and send `Vary: Origin`; unexpected, opaque, malformed, and stale
  origins return `403` without CORS admission headers.
- GUI preflight accepts only `GET` and `POST` plus `Accept`, `Content-Type`, and
  `X-Kiln-Operator-Token`. A preflight without an origin or with another method
  or header returns `403`.
- The GUI WebSocket upgrade crosses the same origin middleware. WebSocket CORS
  headers are not treated as enforcement.
- TUI is a native terminal client. Its WebSocket accepts no browser `Origin`;
  browser-originated handshakes return `403`.
- Local non-browser requests without an `Origin` remain admissible. Loopback
  reachability and origin checks do not authenticate a local process and do
  not replace Runtime authority, operator capabilities, or per-effect checks.

There is no production listener-host option, remote-mode flag, wildcard
origin, `localhost` alias, or retained `/gui-api/*` compatibility route. A
future remote surface must use the authenticated application-session boundary
owned by Roadmap 08 and the connector boundary owned by Roadmap 08.5; it must
not widen this listener.

## HTTP Route Inventory

The final remote scope vocabulary is owned by Roadmap 08 Slice 0. This table is
its route-complete input, not implementation authority. `Initial disposition`
uses only the initial profile already recorded by that roadmap and explicitly
marks everything else as denied pending a separate decision.

| Method and route | Current local effect | Initial disposition |
| --- | --- | --- |
| `GET /gui`, `GET /gui/*` | Redirect or serve static GUI assets. | Public bootstrap only; no Runtime data or mutation. |
| `GET /health` | Read GUI listener health and connection count. | Minimal bootstrap health, provided the payload remains non-sensitive. |
| `GET /gui/api/dashboard` | Read the operator workspace, provider discovery, route catalog, and dashboard projection. | `session:read` only after remote-safe projection review. |
| `GET /gui/api/memory/graph` | Read the scoped Memory Lattice graph through Runtime resources. | `session:read`, still constrained by resource scope. |
| `GET /operator/api/sessions` | List canonical operator sessions. | `session:read`. |
| `GET /gui/api/sessions/:sessionId` | Read one canonical session detail. | `session:read`, bound to the authenticated principal and runtime. |
| `POST /gui/api/resources/read` | Read a resource admitted to a committed session target. | `session:read` plus the existing target/resource admission; never arbitrary URI authority. |
| `GET /gui/api/config/setup` | Read setup, effective configuration, and repair evidence. | Denied initially; configuration-read scope remains a Slice 0 decision. |
| `POST /gui/api/config/setup/actions` | Execute an admitted setup repair action. | Denied initially; setup mutation requires a separate scope and approval contract. |
| `GET /gui/api/config/onboarding` | Read onboarding state. | Denied initially; configuration-read scope remains a Slice 0 decision. |
| `POST /gui/api/config/onboarding` | Apply onboarding mutation with the local operator capability. | Denied initially; setup/configuration mutation is explicitly outside the initial profile. |
| `GET /gui/api/config/settings` | Read governed settings and provenance. | Denied initially; configuration-read scope remains a Slice 0 decision. |
| `POST /gui/api/config/settings/proposals` | Create a governed settings mutation proposal. | Denied initially; configuration mutation is outside the initial profile. |
| `POST /gui/api/config/settings/apply` | Apply an approved settings proposal. | Denied initially; configuration mutation and approval remain distinct authorities. |
| `GET /gui/api/workspace/tree` | Read a bounded local workspace directory projection. | Denied initially as filesystem access. |
| `GET /gui/api/workspace/file` | Read a bounded local workspace file preview. | Denied initially as filesystem access. |
| `GET /gui/ws` | Upgrade to the GUI operator WebSocket. | Authenticated operator session plus exact origin before any operation scope is evaluated. |

## GUI WebSocket Operation Inventory

Every browser-to-gateway operation is listed below. Authentication and origin
admit the connection only; the named operation scope and existing Runtime
authority must still be checked immediately before its effect.

Adding, removing, or changing a protected HTTP route or browser-to-gateway
frame requires updating this inventory and its focused boundary tests in the
same change.

| Frame or message | Current local effect | Initial disposition |
| --- | --- | --- |
| text `ping` | Connection liveness response. | Connection-level only after session admission. |
| `operator_theme_set_result` | Resolve a gateway-requested, connection-local theme callback. | Connection protocol response; cannot persist settings by itself. |
| `clear` | Abort the active local turn, detach the active session, and clear local surface state. | Denied until session-detach semantics are assigned explicitly. |
| `refresh_execution_routes` | Refresh and return the execution-route catalog. | Denied until a remote-safe target-discovery read scope is assigned. |
| `execution_target_wizard` | Preview or create execution-target configuration. | Denied initially as route/configuration mutation. |
| `provider_auth` | Start provider authentication and refresh discovery. | Denied initially; provider authentication is explicitly excluded. |
| `execution_route` | Select an already admitted execution route for subsequent turns. | Candidate `turn:submit` operation; exact route admission remains independent. |
| `continue` | Select a canonical session continuation target. | `session:read`, bound to the authenticated principal and runtime. |
| `turn_cancel` | Cancel the active Runtime turn. | Candidate `turn:submit` control; Slice 0 must make cancellation explicit. |
| `goal_control` | Pause, resume, edit, or cancel the foreground goal. | `goal:control`. |
| `execution_mode_transition` | Transition plan/execute mode and, where required, approve a plan transition. | Denied until `turn:submit`, approval, and residual-risk semantics are assigned explicitly. |
| `managed_agent_control` | Prompt, cancel, or join a managed child invocation. | Denied initially; managed-child control requires a separate scope decision. |
| `voice_synthesis_request` | Perform on-demand synthesis through Runtime media authority. | Denied initially; it can incur provider/economic effects. |
| `approve` | Resolve one pending approval as approved. | `approval:resolve`, preserving exact approval identity. |
| `reject` | Resolve one pending approval as rejected. | `approval:resolve`, preserving exact approval identity. |
| `message` | Submit a new or continued operator turn. | `turn:submit`; route, account, credential, tool, economic, and dispatch authority remain Runtime-owned. |

## Cross-Surface Boundary

The defect was cross-surface at the listener layer: both GUI and TUI inherited
Bun's wildcard bind. The correction is shared there. Browser-origin behavior
remains adapter-specific because GUI is a browser client and TUI is not.

The deployable App Gateway, Model Gateway, Operator Runtime, SDK/widget, and
MCP listeners have distinct owners and were reviewed but not changed:

- Model Gateway already binds its local listener explicitly to `127.0.0.1`.
- App Gateway exposure is deployment configuration, not a local Operator
  Gateway default.
- Operator Runtime already owns an authenticated loopback application
  protocol and does not consume this GUI/TUI browser-origin policy.
- SDK/widget and MCP surfaces do not start the affected local listener.

## Standards Basis

Reviewed 2026-08-23 against the repository's Bun `1.4.0` line and current
authoritative web documentation:

- [Bun HTTP server configuration](https://bun.com/docs/runtime/http/server)
  documents `0.0.0.0` as the default hostname and `hostname` as the listener
  boundary.
- [Fetch Standard CORS responses](https://fetch.spec.whatwg.org/#http-responses)
  defines literal-origin response admission and `403` as an explicit failure
  response; its cache guidance requires `Vary: Origin` for dynamic origins.
- [RFC 6455 section 10.2](https://www.rfc-editor.org/rfc/rfc6455.html#section-10.2)
  requires servers intended for specific sites to verify `Origin` and
  recommends `403` for an unacceptable WebSocket origin.

Origin checks protect browsers from cross-site use of loopback services. They
are not authentication for non-browser clients, which can forge or omit the
header.
