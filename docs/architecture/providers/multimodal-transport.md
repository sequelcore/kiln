# Multimodal Transport and Capability Delegation

## Status

This is the canonical architecture record for Kiln's multimodal transport
foundation as of 2026-05-13.

ADR-007 is the accepted decision record for this subsystem. The implementation
covers the foundation contract, runtime admission, provider adapter
fail-closed behavior, routing evidence, governed transforms, managed capability
delegation, and cross-surface artifact normalization.

## Purpose

Kiln treats multimodal work as a governed runtime transport and routing
problem. Images, documents, audio, screenshots, and future modalities move
through explicit content parts, retained artifact resources, capability
requirements, route decisions, session events, and replayable evidence.

Surface behavior may differ in presentation, but it must not define different
multimodal semantics. GUI, TUI, CLI, SDK, webhooks, runtime sessions, provider
adapters, and managed agents all use the same artifact and route evidence.

## Doctrine

Multimodal handling is not a surface trick and not a prompt convention.

The runtime must preserve:

- the operator's requested capability
- the original content or retained artifact reference
- the active provider/model capability evidence
- the chosen route strategy
- the degradation or delegation evidence when native handling is unavailable
- the session events needed for replay and audit

Provider adapters must not silently discard unsupported modalities. Runtime
admission must choose a governed route or fail closed before provider execution.
OCR, transcription, document extraction, downsampling, and similar conversions
are explicit degradations with provenance; they are not hidden fallback paths.

## Canonical Contracts

The core multimodal contract is defined in `@kilnai/core` and consumed by the
runtime:

- `ContentPart`
  Represents text, image, audio, and file inputs in provider-neutral form.
- `ToolResultPayloadPart`
  Preserves model-visible multimodal tool-result payloads for later provider
  turns.
- `ArtifactResourceMultimodalMetadata`
  Records modality, MIME type, size, checksum, source provenance, optional
  dimensions or duration, retention policy, and replay metadata for stored
  artifacts.
- `ProviderModalityCapabilities`
  Projects provider/model transport constraints such as input modalities,
  output modalities, tool-result multimodality, base64 support, URL support,
  document support, and size or count limits.
- `MultimodalRoutingRequest`
  Captures the current turn's required capability and available artifacts.
- `MultimodalRoutingDecision`
  Chooses `native`, `delegated`, `transform`, or `unsupported` with a reason
  code and diagnostics.
- `MultimodalTransformEvidence`
  Records degradation output, source artifact URIs, output artifact URIs,
  transform name, limitations, and provenance.
- `MultimodalDelegationEvidence`
  Records the bounded managed child route, selected provider/model/profile,
  authority evidence, result handoff, uncertainty, limitations, and artifact
  URIs.

Legacy capability booleans are projections only. Runtime admission uses the
canonical capability matrix and route planner.

## Artifact and Replay Model

Multimodal inputs and outputs that need replay or cross-surface inspection are
stored in the artifact resource plane. The stable URI, not the original local
path or external URL, is the replay authority once Kiln has retained the
artifact.

Current namespaces include:

- `inbound-multimodal` for accepted user, SDK, WebSocket, GUI/TUI, and webhook
  ingress artifacts
- `audio-transforms` for transcription source and output artifacts
- `multimodal-transforms` for OCR, document extraction, and image transform
  outputs

Ingress capture preserves provider transport fields such as base64 or URL data
when native handling needs them, while adding `artifactUri` references for
replay. This lets a native vision route use supported provider transport and
still leaves a durable Kiln resource reference for audit and future turns.

Artifact reads are read-only context resources. A `kiln://artifacts/...` URI
does not grant mutation authority, provider authority, or filesystem authority.

## Routing and Admission

Runtime admission evaluates multimodal requirements before provider execution.
The planner uses this order:

1. Use native provider/model support when the selected route can faithfully
   accept the required modality and policy allows native handling.
2. Delegate to an admitted managed auxiliary route when native handling is not
   available or not preferred and a child route advertises the required
   capability.
3. Apply an admitted transform such as OCR, document extraction, downsampling,
   or transcription.
4. Fail closed with an unsupported-modality reason.

The same admission path applies to current user input and model-visible
multimodal session history. If a turn cannot be admitted, Kiln records
`multimodal_routed`, `error_recorded`, and failed `turn_completed` evidence
without committing the rejected multimodal input into future model-visible
history. Successful `model_routed` telemetry is emitted only after multimodal
admission succeeds.

Route decisions are evidence, not suggestions. Direct adapter calls and
runtime-selected provider routes must either satisfy the route constraints or
reject the request before network I/O.

## Governed Transforms

Transforms are runtime-owned degradations. They must record what changed, which
source artifact was used, which output artifacts were produced, and what
limitations apply.

Current transform routes include:

- OCR for image-to-text admission
- PDF document extraction
- image downsampling and compression for constrained vision routes
- transcription for audio ingress

Gateway audio preprocessing is represented as governed transcription evidence.
If audio cannot be downloaded, decoded, or transcribed under the configured
route, the channel request follows the app's voice failure policy instead of
sending placeholder text to the model.

Voice-specific provider selection, surface policy, artifact retention, and
output synthesis rules are defined in [Voice Capability](voice-capability.md).

## Capability Delegation

Capability delegation is bounded managed invocation used to satisfy a
multimodal capability that the active route cannot satisfy natively.

The parent records:

- requested capability
- required modalities
- artifact URIs and metadata sent to the child
- selected child route, provider, model, and agent profile
- authority profile and route-health evidence
- cost and policy admission evidence
- structured child result handoff
- uncertainty, limitations, and transform provenance when applicable

The child does not inherit ambient parent authority, raw parent context, or
unbounded filesystem access. Delegation is admitted through the managed-agent
runtime boundary and returns a bounded handoff to the parent session.

## Provider Adapter Rules

Provider adapters are serialization boundaries. They must preserve supported
content faithfully and reject unsupported content before dispatch.

Current adapter behavior includes:

- Anthropic serialization for supported multimodal user and tool-result
  payloads.
- OpenAI-compatible image transport for supported image URL parts, with
  fail-closed rejection for unsupported audio, file, and multimodal
  tool-result payloads.
- Ollama base64 image transport for supported image inputs, with fail-closed
  rejection for unsupported image URL, audio, file, and multimodal tool-result
  payloads.

Provider/model discovery projects capability evidence for operator controls and
runtime admission. Static provider claims, stale model lists, or prompt-only
instructions must not bypass the planner.

## Cross-Surface Projection

Every ingress surface normalizes accepted multimodal content through the same
artifact and routing model:

- HTTP API and SDK-backed API calls
- generic WebSocket chat
- tenant WebSocket chat
- App Gateway GUI chat
- CLI-backed GUI and TUI operator chat
- WhatsApp, Instagram, and Messenger webhook attachments

Operator surfaces render the same canonical evidence in surface-appropriate
forms. GUI may show previews, thumbnails, galleries, and inspector details.
CLI and TUI may show compact resource links, metadata, and deterministic text
fallbacks. These differences are presentation only.

`multimodal_routed` is the canonical runtime event for multimodal route
evidence. Gateway contracts project that event into operator-visible
presentation, and observability maps it into spans for audit and diagnostics.

## Implementation Map

Primary code owners:

- `packages/core/src/engine/domain/multimodal-routing.ts`
- `packages/core/src/tools/infrastructure/artifact-resource-store.ts`
- `packages/core/src/agents/model-capability-registry.ts`
- `packages/runtime/src/agents/provider-adapters/anthropic.ts`
- `packages/core/src/agents/infrastructure/openai-compat.ts`
- `packages/runtime/src/agents/provider-adapters/ollama.ts`
- `packages/core/src/events/index.ts`
- `packages/core/src/events/session-event.ts`
- `packages/core/src/observability/span-mapper.ts`
- `packages/runtime/src/gateway/multimodal-artifact-ingestion.ts`
- `packages/runtime/src/gateway/audio-preprocessor.ts`
- `packages/runtime/src/session/runtime-session-orchestrator-routing.ts`
- `packages/runtime/src/session/runtime-multimodal-transforms.ts`
- `packages/runtime/src/session/runtime-session-event-ledger.ts`
- `packages/gateway-contracts/src/operator-event-presentation.ts`

Webhook, WebSocket, gateway, GUI, TUI, and SDK-backed routes consume these
contracts instead of owning separate multimodal behavior.

## Invariants

- No surface-local multimodal contract.
- No implicit OCR, transcription, or placeholder text fallback.
- No provider adapter may drop unsupported modalities silently.
- No original local path or external URL is replay authority after a retained
  artifact URI exists.
- No managed child receives ambient parent authority for capability delegation.
- No route may claim native support without capability evidence for the active
  provider/model.
- No successful provider route telemetry is emitted for a rejected multimodal
  turn.

## Verification

Canonical deterministic verification:

```bash
bun run typecheck
bun run test
bun run build
```

Focused coverage lives in:

- `packages/core/tests/engine/domain/multimodal-routing.test.ts`
- `packages/core/tests/tools/domain/artifact-resource-store.test.ts`
- `packages/core/tests/agents/model-capability-registry.test.ts`
- `packages/runtime/tests/agents/provider-adapters/anthropic.test.ts`
- `packages/core/tests/agents/infrastructure/openai-compat.test.ts`
- `packages/runtime/tests/agents/provider-adapters/ollama.test.ts`
- `packages/core/tests/events/session-event.test.ts`
- `packages/core/tests/observability/span-mapper.test.ts`
- `packages/gateway-contracts/tests/operator-event-presentation.test.ts`
- `packages/runtime/tests/gateway/multimodal-artifact-ingestion.test.ts`
- `packages/runtime/tests/gateway/audio-preprocessor.test.ts`
- `packages/runtime/tests/gateway/message-pipeline.test.ts`
- `packages/runtime/tests/gateway/ws-routes.test.ts`
- `packages/runtime/tests/gateway/ws-tenant-routes.test.ts`
- `packages/runtime/tests/gateway/whatsapp-webhook-routes.test.ts`
- `packages/runtime/tests/gateway/instagram-webhook-routes.test.ts`
- `packages/runtime/tests/gateway/messenger-webhook-routes.test.ts`
- `packages/runtime/tests/session/runtime-session-multimodal-events.test.ts`
- `packages/runtime/tests/session/runtime-session-orchestrator-model-routing.test.ts`

Live provider and deployed OCR/STT availability checks are operational
conformance evidence. They do not change the canonical architecture contract.
