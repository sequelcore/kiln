# App Gateway Runtime

## Purpose

Kiln App Gateway is the governed AI runtime developers embed or deploy for
their own applications.

The App Gateway owns app, tenant, session, channel, provider/model, tool, MCP,
memory, context, safety, approval, audit, event, replay, managed-agent, and
resource-plane runtime semantics. Operator surfaces attach to it; they do not
become substitute app runtimes.

## Runtime Ownership

An App Gateway process owns:

- app declarations loaded from gateway/app configuration
- tenant selection and tenant-scoped runtime state
- channel adapters and webhook/API boundaries
- provider/model routing and readiness evidence
- tool and MCP admission
- memory and context policy
- safety and authority policy
- session events and replay
- managed invocation lifecycle
- resource reads and resource links
- operator dashboard and websocket attach contracts

GUI, TUI, CLI, native, IDE, SDK, widget, and remote clients may observe or act
through published contracts. They must not store app truth, tenant truth, tool
authority, or approval lifecycle in local presentation state.

## Operator Attachment

Operator attachment uses shared target identity. The dashboard should publish
enough state for an Operator Workspace to select a local App Gateway, remote
App Gateway, app, and tenant without guessing from display labels or URLs.

The initial attach path is:

```bash
kiln gateway start --config ./gateway.yaml --port 3800
kiln gui --connect http://localhost:3800
```

The project-local App Gateway supervisor owns process identity, the exact
`gateway.yaml` plus bound App source revision, authenticated loopback control,
and restart read-back. Restart first stops new admission, gives in-flight work
a bounded drain interval, and only then uses forced process termination as a
recovery fallback. `kiln gateway serve` remains the explicit foreground
development path.

`/gui/api/dashboard` publishes app descriptors, active app/tenant selection,
and `operatorWorkspaceHome`. `/gui/ws` carries runtime operator frames.

## MCP Boundary

MCP is an external tool and host integration boundary. It is not the internal
operator protocol between GUI/TUI surfaces and the gateway.

Use App Gateway MCP endpoints for external clients that need governed tools or
resources. Use the operator HTTP/WS contracts for sessions, approvals,
dashboard state, target selection, resource inspection, and live supervision.

## Production Bar

Before exposing an App Gateway outside a trusted local network, configure:

- TLS or trusted tunnel termination
- authenticated operator/admin routes
- origin controls for browser/widget channels
- webhook signature verification
- rate limits and abuse protection
- remote-safe tool authority
- tenant secret encryption
- persistent audit and memory storage
- route/model health monitoring
- resource-read authorization

Development examples are topology examples, not complete production security
profiles.
