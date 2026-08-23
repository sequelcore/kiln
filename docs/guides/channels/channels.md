# Channels

Kiln receives channel traffic through Runtime gateway routes and sends external
messages through the canonical channel-egress action claim. A surface does not
instantiate a provider-specific channel class or own delivery lifecycle.

Sources: `packages/runtime/src/gateway/`, `packages/runtime/src/channels/`

## Current Ownership

| Concern | Owner |
| --- | --- |
| WebSocket connections and browser delivery | `WebChannel` |
| WhatsApp ingress and response projection | `whatsapp-webhook-routes.ts` |
| Instagram ingress and response projection | `instagram-webhook-routes.ts` |
| Messenger ingress and response projection | `messenger-webhook-routes.ts` |
| Email ingress and response projection | `email-webhook-routes.ts` |
| Outbound provider send | `dispatchChannelEgress` |
| Durable no-redispatch evidence | `ChannelEgressActionClaimStore` |

Legacy `WhatsAppChannel`, `InstagramChannel`, `MessengerChannel`,
`SlackChannel`, `EmailChannel`, `ApiChannel`, and `CliChannel` adapters do not
exist. Do not create new surface-owned delivery classes or bypass the gateway
route and channel-egress claim.

## Ingress

Provider webhooks terminate at the matching Runtime gateway route. Each route:

1. validates provider authentication and the incoming payload at the boundary;
2. derives the trusted application, tenant, user, and idempotency identity;
3. submits the admitted turn through Runtime; and
4. projects the response to the provider transport.

Meta providers share signature verification and webhook parsing support, but
their gateway routes retain provider-specific payload validation. Webhook
deduplication is ingress evidence; it is not outbound dispatch authority.

## Outbound Delivery

Every consequential channel send uses `dispatchChannelEgress`. Its caller must
supply:

- the persisted `EffectiveAuthorityAdmissionBundle` and durable readback;
- a stable caller and idempotency key;
- one logical send slot;
- the exact channel, destination, adapter identity, and payload fingerprint;
- the durable channel-egress claim store; and
- one already prepared provider send function.

The claim is fenced before the send and returns one process-local permit. A
permit is consumed immediately before the provider call. Exact replay or a
reopened claimed row produces no second permit. Provider ambiguity, settlement
failure, cancellation after the fence, and process loss preserve an unknown
tombstone; they never retry or fall back under the same attempt.

```typescript
import { dispatchChannelEgress } from "@kilnai/runtime";

await dispatchChannelEgress({
  context: channelEgressActionClaims,
  authorityAdmission,
  attemptId,
  callerId: "gateway:whatsapp",
  idempotencyKey: inboundMessageId,
  channel: "whatsapp",
  destination: recipientId,
  adapterIdentity: "whatsapp-graph-api:v21",
  logicalSendSlot: "turn-response",
  payload: projectedResponse,
  send: () => sendWhatsAppResponse(projectedResponse),
});
```

The concrete gateway composition supplies the durable store and admission
readback. Application code must not construct a process-local claim store as a
production substitute.

## Web Channel

`WebChannel` remains a connection-oriented projection for Runtime-owned
WebSocket sessions. It can attach and detach replaceable clients without
becoming model, tool, or channel-provider execution authority. Consequential
external sends still require their workload claim.

### Pre-chat Form

The web surface may collect operator-defined pre-chat fields before attaching a
session. Validate those values as untrusted ingress and project them into the
admitted turn context; they do not grant execution or delivery authority.

## Content And Handoff

Channel routes normalize supported text and media into canonical content parts
before Runtime admission. Provider limits and response formatting are applied
by the provider-specific projection at the route boundary.

Human handoff is a separate workload concern. Channel routes may project
handoff state, but channel delivery cannot mint, settle, or override handoff
authority.

## Verification

Channel changes must prove:

- invalid authentication and malformed payloads fail before Runtime dispatch;
- one caller/idempotency/send-slot identity produces at most one provider send;
- exact replay, restart, cancellation, and settlement failure do not redispatch;
- stale permits cannot execute after their store closes;
- unknown provider outcomes remain unknown; and
- no provider-specific legacy channel class or alternate send path is exported.
