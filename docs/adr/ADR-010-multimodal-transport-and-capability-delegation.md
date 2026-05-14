# ADR-010: Multimodal transport and capability delegation

**Status:** Accepted (2026-05-13)
**Date:** 2026-05-13
**Author:** Ricardo Armenta
**Scope:** `packages/core/src/engine/domain/`, `packages/core/src/agents/`,
`packages/core/src/tools/`, `packages/runtime/src/session/`,
`packages/runtime/src/gateway/`, `packages/runtime/src/agents/managed-invocation/`,
`packages/cli/`, `packages/gui/`, `packages/tui/`,
`docs/architecture/context-resource-plane.md`,
`docs/architecture/provider-model-discovery.md`,
`docs/architecture/managed-agents.md`
**Follows:** ADR-004, ADR-009

---

## Context

Kiln already moves some multimodal values through `ContentPart` and tool result
content parts. Provider adapters can serialize images in selected paths, webhook
routes can normalize attachments, and the resource plane can store session
artifacts. These parts are not yet one governed end-to-end contract.

The active roadmap track requires images, documents, audio, screenshots, and
future modalities to preserve operator intent and replay evidence across
surfaces, tools, providers, managed agents, and transforms. Silent OCR,
provider-specific behavior, or string-only projection would make the control
plane unreviewable.

## Decision

Kiln will treat multimodal work as a runtime-governed transport and routing
problem, not as a surface trick.

The canonical contract has five parts:

1. `MultimodalArtifact`
   A stable artifact reference with URI, modality, MIME type, size, checksum,
   source provenance, retention policy, replay reference, and optional
   dimensions or duration.

2. `ProviderModalityCapabilities`
   A provider/model capability matrix covering accepted input modalities,
   accepted output modalities, tool-result multimodality, base64 support, URL
   support, document support, limits, and declared degradation behavior.

3. `MultimodalRoutingRequest`
   The runtime request to decide how a required capability should be satisfied
   for one or more artifacts under policy.

4. `MultimodalRoutingDecision`
   An auditable decision with one of four strategies:
   `native`, `delegated`, `transform`, or `unsupported`.

5. `MultimodalTransformEvidence` and `MultimodalDelegationEvidence`
   Explicit records for degraded transform output or bounded auxiliary managed
   agent handling.

## Routing Order

Runtime planning must use this order:

1. Prefer native provider/model support when the selected route can faithfully
   accept the required modality and policy allows native handling.
2. Delegate to an admitted managed auxiliary route when native support is absent
   or disallowed and a child route advertises the required capability.
3. Apply an admitted transform such as OCR, document extraction, thumbnailing,
   downsampling, or transcription.
4. Fail closed with an unsupported-modality reason.

Transforms are degradations. They must not pretend to preserve the original
modality unless they emit sidecar artifact evidence.

## Provider Capability Rules

Provider adapters must not silently discard modalities. A provider/model route
must either:

- serialize the modality faithfully,
- return a route plan that delegates,
- return a route plan that transforms,
- or fail closed.

Legacy fields such as `supportsVision` and `supportsAudio` may remain as
compatibility projections while the canonical matrix is adopted. They must not
become the only source of modality admission.

## Delegation Rules

Capability delegation is bounded managed invocation. The parent records the
artifact URIs, requested capability, selected child route, authority profile,
policy/cost decision, structured result, uncertainty, and limitations. The
child does not inherit ambient authority or raw parent context.

Candidate auxiliary profiles such as `vision-describer`,
`ui-screenshot-reviewer`, `diagram-reader`, `document-ocr-reviewer`, and
`visual-regression-agent` are profile content. The canonical contract is the
capability delegation record.

## Consequences

Positive:

- one vocabulary for CLI, TUI, GUI, webhooks, SDK, runtime, and managed agents
- clear fail-closed behavior for unsupported modalities
- adapter-specific constraints become data instead of prompt folklore
- replay can explain native, delegated, transformed, or unsupported outcomes

Negative:

- provider adapters need migration from booleans to a richer matrix
- tool result projection needs a staged migration away from string-only handoff
- full end-to-end parity requires several later runtime and surface slices

## Non-Goals

- Do not implement provider-specific OCR as the default image path.
- Do not require every surface to render binary previews.
- Do not make local file paths replay authority when a retained artifact URI
  exists.
- Do not add compatibility versions for internal contracts without consumers.

## Verification

The foundation contract is valid only when deterministic tests prove the planner
selects native, delegated, transformed, and unsupported routes with explicit
evidence and no implicit OCR fallback.
