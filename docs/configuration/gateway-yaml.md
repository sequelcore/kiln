# Gateway YAML Reference

This document is a transitional reference for the current gateway configuration
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

## Transitional Status

The older exhaustive deployment narrative centered Kiln too strongly around the
gateway/runtime stack. That is no longer acceptable as the primary framing.

The App Gateway remains important as the deployable execution surface beneath
the control plane.

## Future Direction

If this reference is rebuilt in detail later, it should:

- align configuration terms to the canonical runtime-surface taxonomy
- distinguish stable doctrine from implementation residue
- describe runtime surfaces as subordinate to the control plane

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
