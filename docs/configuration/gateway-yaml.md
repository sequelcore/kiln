# Gateway YAML Reference

This is the operator reference for the canonical `gateway.yaml` configuration
surface.

`gateway.yaml` describes how the deployable App Gateway is wired, but it does
not define Kiln's architecture. The control-plane doctrine lives in
[`docs/architecture/`](../architecture/README.md).

## Purpose

Use this page to understand the current deployment and wiring surface for:

- app bindings to `app.yaml` files
- channel bindings
- auth configuration
- MCP exposure
- session and handoff-related runtime wiring

## Schema And Admission

Core owns one strict TypeBox schema and derives the admitted TypeScript type,
editor JSON Schema, and field descriptors from it. The committed artifacts are
[`gateway-config-v1.json`](../../packages/core/schemas/gateway-config-v1.json)
and
[`gateway-config-descriptors-v1.json`](../../packages/core/schemas/gateway-config-descriptors-v1.json).
Run `bun run --cwd packages/core config:schema:generate` after changing the
schema owner.

Every production reader uses the same boundary. Unknown root or nested fields,
malformed values, and raw secret fields fail before semantic admission. Errors
name the source file and exact property path; unknown-field diagnostics also
identify the running Core schema build. Public examples are validation
fixtures.

Credential material is not valid YAML configuration. Store only canonical
environment-variable names in fields ending in `Env`, such as
`accessTokenEnv`, `secretEnv`, and `hmacKeyEnv`. The removed `botToken` field has
no compatibility alias.

All gateway fields currently activate at `restart-required`. There is no shared
gateway writer, so authoring remains explicit. Apply an admitted file revision
with `kiln gateway restart --config <path>` (or `start` when stopped). The
project-local supervisor fences the exact gateway and bound App source bytes,
authenticates loopback control, stops new admission, drains in-flight work,
starts the replacement, and accepts it only after read-back reports that exact
revision. A settings mutation surface must still not claim automatic restart
activation until it invokes this owner and settles the returned evidence.

## Architectural Position

The App Gateway is an execution and hosting surface. It is not the product
identity.

That means this file should be read as:

- a runtime binding layer
- a deployment surface
- an operator-facing infrastructure interface for deployed apps

It should not be read as the place where Kiln's conceptual model originates.
It also should not be confused with local Operator Gateway helpers used by GUI
or TUI commands.

## Canonical Crosswalk

When reading `gateway.yaml`, map it into the current architecture:

- app and channel bindings belong to runtime surfaces
- auth and policy wiring belong to safety and control boundaries
- session and handoff wiring belong to governed flows and operational modes
- provider selection belongs to execution policy, not identity
- GUI/CLI/TUI attachment belongs to the operator HTTP/WS contract, not MCP

Relevant docs:

- [Flows](../architecture/core/flows.md)
- [Safety](../architecture/safety/safety.md)
- [Tool Execution](../architecture/tooling/tool-execution.md)
- [Control Model](../architecture/core/control-model.md)
- [Runtime Surfaces](../architecture/surfaces/runtime-surfaces.md)

## Channel Public Media

Meta channels cannot consume Kiln internal artifact URIs or inline audio data.
When WhatsApp, Instagram, or Messenger must receive generated media, bind a
public gateway origin and signing secret on that channel:

```yaml
channels:
  - type: whatsapp
    multiTenant: true
    verifyTokenEnv: MY_WHATSAPP_WEBHOOK_SECRET
    publicMediaBaseUrlEnv: GATEWAY_PUBLIC_URL
    publicMediaSigningSecretEnv: GATEWAY_MEDIA_SIGNING_SECRET
  - type: instagram
    multiTenant: true
    verifyTokenEnv: META_VERIFY_TOKEN
    publicMediaBaseUrlEnv: GATEWAY_PUBLIC_URL
    publicMediaSigningSecretEnv: GATEWAY_MEDIA_SIGNING_SECRET
  - type: messenger
    multiTenant: true
    verifyTokenEnv: META_VERIFY_TOKEN
    publicMediaBaseUrlEnv: GATEWAY_PUBLIC_URL
    publicMediaSigningSecretEnv: GATEWAY_MEDIA_SIGNING_SECRET
```

`GATEWAY_PUBLIC_URL` must be the HTTPS origin that Meta can reach, for example
an ngrok URL in development or the production gateway origin. Kiln serves media
through short-lived signed `/media/{app}/{namespace}/{artifact}/content` URLs;
the signing secret must be private and stable for the gateway process. Use one
signing secret per app across channel bindings so the app-level media route can
verify every signed URL consistently.
