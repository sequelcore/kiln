# ADR-007: Multimodal Transport and Capability Delegation

## Status

Accepted

## Context

Kiln sessions may include text, images, audio, documents, files, and
tool-result artifacts. Providers differ in which modalities they accept
natively. Some turns need a direct multimodal route, some need an auxiliary
managed child, some can use a governed transform, and some must fail closed.

Provider adapters must not silently drop unsupported artifacts.

## Decision

Kiln models multimodal transport explicitly in core and runtime. The canonical
planner is `planMultimodalRoute()` in
`packages/core/src/engine/domain/multimodal-routing.ts`.

The planner evaluates:

- `MultimodalArtifact`
- route/provider capability metadata
- required input and output modalities
- auxiliary managed routes
- governed transform candidates
- route health and authority metadata
- routing policy

It returns a `MultimodalRoutingDecision` with strategy, reason, diagnostics,
optional delegation route, and optional transform evidence.

## Routing Order

1. Use the active provider route natively when it supports all required
   modalities.
2. Delegate to an admitted auxiliary managed route when policy allows and the
   auxiliary route satisfies the modality requirement.
3. Apply an admitted transform such as OCR, document extraction, downsampling,
   thumbnailing, or transcription when policy allows.
4. Fail closed with an unsupported-modality decision.

## Provider Capability Rules

Capabilities are structured by modality and artifact kind. Legacy summary
fields such as vision/audio support may remain as compatibility projections,
but they must not be the only source used for routing decisions.

Runtime gateway ingestion persists artifact identity, provenance, media type,
size, hash, and transform evidence where available. Provider adapters must
dispatch only artifacts accepted by the selected route.

## Delegation Rules

Multimodal delegation uses governed managed-agent invocation. Delegated routes
must carry route id, provider, model, optional agent profile, authority profile,
health, and capability evidence. Delegated children receive only admitted
resources and context; no ambient parent transcript is implied.

## Consequences

Kiln can route multimodal work across heterogeneous providers without hidden
data loss. The cost is stricter artifact modeling, more route diagnostics, and
clear rejection when no governed route exists.

## Verification

Professional acceptance for this ADR requires tests that cover:

- native multimodal routing
- auxiliary managed delegation
- governed transform selection and degradation evidence
- unsupported modality rejection
- provider adapter rejection for unsupported artifacts
- event and transcript evidence for artifacts, delegation, and transforms

Canonical architecture reference: `docs/architecture/multimodal-transport.md`.
