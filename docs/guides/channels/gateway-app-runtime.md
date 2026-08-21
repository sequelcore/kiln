# Gateway App Runtime

## Purpose

Use Kiln Gateway when you want Kiln to power governed AI behavior inside an
application.

The Gateway is the app runtime surface. It hosts declared apps, tenants,
channels, sessions, tools, memory, safety, provider routing, events, handoff,
and MCP exposure. Operator surfaces attach to that runtime; they do not replace
it with GUI, TUI, CLI, or SDK-specific behavior.

For surface ownership doctrine, see
[`runtime-surfaces.md`](../../architecture/surfaces/runtime-surfaces.md) and
[`execution-surfaces.md`](../../architecture/surfaces/execution-surfaces.md).

## Runtime Shape

A deployable app uses one App Gateway process:

```text
gateway.yaml
  -> binds apps, channels, auth, MCP, and runtime wiring

app.yaml
  -> declares one domain app loaded by the gateway

startGateway(gateway.yaml)
  -> owns app sessions, tenants, memory, safety, provider routes, events,
     channel adapters, tool gates, and MCP exposure

GUI / TUI / CLI / native / SDK / widget
  -> operate or embed the same runtime through shared contracts
```

This keeps app behavior governed in one place. Rich surfaces may improve how
operators inspect or act on the runtime, but they must consume shared contracts
instead of rebuilding private app state.

## When To Use It

Use the Gateway app runtime for:

- product chat, assistant, support, booking, research, or workflow agents
- multi-tenant apps where each tenant needs isolated configuration and memory
- channel-backed apps such as web widgets, API endpoints, WhatsApp, Instagram,
  Messenger, email, or future integrations
- app-owned MCP tools and read-only resources
- governed handoff from AI to a human operator
- provider/model routing that must be observable and policy-bound

Use a local Operator Gateway instead when you are only running local developer
or operator sessions and do not have a deployable app declaration.

## Canonical Local Development Path

1. Create an app declaration.

   ```text
   apps/support/app.yaml
   ```

2. Bind it from a gateway declaration.

   ```text
   gateway.yaml
   ```

3. Start the gateway from the app repo or example.

   ```bash
   bun run start
   ```

4. Attach operator surfaces to the running gateway.

   ```bash
   kiln gui --connect http://localhost:3000
   kiln tui --connect http://localhost:3000
   kiln gateway inspect --connect http://localhost:3000
   ```

5. Embed product surfaces through the declared channel or SDK/widget contract.

The example repos under `docs/examples/` show this shape from source. Start
with [`multi-app-gateway`](../../examples/multi-app-gateway/README.md) when you
need multiple apps on one gateway, or
[`booking-assistant`](../../examples/booking-assistant/README.md) when you need a
tenant-backed app with MCP tools and billing hooks.

## Operator Attachment

Operator surfaces attach to a concrete gateway target. A target identifies the
gateway kind, app, tenant, URL, and trust level so actions do not rely on
ambiguous labels or local assumptions.

The shared target contract is `OperatorGatewayTargetIdentity` in
`@kilnai/gateway-contracts`.

Expected target kinds:

- `local-operator-gateway` for local operator sessions
- `local-app-gateway` for an app gateway on the same machine
- `remote-app-gateway` for a deployed app gateway
- `simulated-app-gateway` for fixture-backed and test surfaces

Surface code should pass target identity through the shared operator contracts.
It should not infer app/runtime identity from display text, port numbers, or
surface-local state.

## App And Tenant Boundaries

The App Gateway is the authority for app and tenant isolation.

- `gateway.yaml` binds apps and channel routes.
- each app has its own runtime session scope
- tenant resolution happens through the channel-specific identifier
- tenant memory, tools, safety, and handoff state remain app-scoped
- operator surfaces inspect and act through gateway contracts

Do not store tenant state in a GUI, CLI cache, widget, IDE extension, or
harness transcript. Those surfaces may cache presentation state, but runtime
truth belongs to the Gateway.

## MCP Boundary

MCP is the external tool and host integration boundary.

Use the App Gateway MCP endpoint when external agents, IDEs, wrappers, or tool
hosts need Kiln tools or resources. Do not use MCP as the internal GUI-to-
gateway operator protocol. GUI, TUI, and CLI surfaces should use the
operator HTTP/WS contract for sessions, approvals, health, telemetry, resource
inspection, replay, and operator actions.

## Production Checklist

Before exposing an App Gateway outside a trusted local network, configure:

- TLS or trusted tunnel termination
- authenticated admin/operator routes
- origin controls for browser and widget channels
- channel-specific webhook signature verification
- rate limits and abuse protection
- remote-safe tool authority
- provider credential policy
- tenant secret encryption
- persistent storage for tenant config, memory, and audit state
- health and telemetry collection

The source examples are deployment shapes, not complete production security
profiles.

## Long-Term Surface Rule

Build app behavior in the Gateway first, then project it outward.

If a feature affects sessions, tools, memory, safety, provider routes, costs,
events, approvals, resources, or replay, it belongs in core/runtime/gateway
contracts before any GUI, TUI, CLI, native, SDK, widget, or harness-specific
surface consumes it.
