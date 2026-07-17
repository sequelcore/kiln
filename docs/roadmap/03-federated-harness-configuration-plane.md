# 03 - Federated Harness Configuration Plane

Status: Deferred research
Execution: Deferred until capability matrices and projection benchmarks justify reopening.
Created: 2026-06-29

## Objective

Research whether Kiln can become the canonical configuration and capability
plane for every supported harness while projecting only the minimum native
material each harness needs. This is a post-release architecture initiative,
not a remaining slice of skill parity.

## Goals

- Determine whether Kiln should own one governed capability/configuration plane
  across supported harnesses.
- Reduce duplicated native projection only when evidence proves governance and
  standalone reliability are preserved.
- Keep native harness discovery, permissions, and offline operation explicit.
- Avoid lowest-common-denominator config that hides unsupported capabilities.

## Scope

- Skills and procedural context.
- Global and project instructions.
- Agents and subagent profiles.
- MCP servers, tools, resources, and capability metadata.
- Provider/model defaults and route preferences.
- Permissions, approvals, hooks, and harness-specific policy.
- Install state, drift, origin, admission, and omission diagnostics.

## Non-Goals

- No replacement of native harness discovery with prompt instructions.
- No silent import of unmanaged native state.
- No compatibility shim that pretends unsupported harness capabilities exist.
- No weakening of direct harness operation when Kiln is not running.

## Target Model

Use one governed Kiln source with capability-aware native adapters, not one
lowest-common-denominator config copied everywhere. A direct Codex, Claude
Code, or OpenCode session should discover the same intended capabilities as a
Kiln-managed invocation when its harness supports them. Unsupported,
unavailable, or policy-blocked features must remain explicit and fail closed.

The design must distinguish canonical authority from physical projection.
Sharing configuration does not mean silently importing unmanaged native state,
granting unsupported authority, or pretending that every harness has identical
runtime capabilities.

## Research Tracks

- Compare full native projection with thin manifests, shared agent-compatible
  locations, MCP/resource-backed dynamic lookup, and hybrid catalogs.
- Establish precedence and trust rules across global, project, plugin, native,
  and Kiln-owned sources.
- Determine which capabilities require native discovery metadata and which can
  be resolved dynamically after selection.
- Measure context pressure, startup cost, filesystem duplication, drift risk,
  and offline behavior for each projection strategy.
- Define adapter behavior for harness-specific formats without creating a
  second source of truth or a fake compatibility layer.

## Constraints

- Preserve native discovery and per-capability permissions.
- Preserve direct harness operation when Kiln is not running.
- Preserve project overrides and deterministic precedence.
- Keep origin, projection, admission, omission, and drift diagnostics canonical.
- Fail closed when an explicitly requested capability is unknown or unsupported.
- Do not replace native catalogs with a generic "read Kiln config" instruction
  unless the harness has proven runtime support for resolving the referenced
  capability before selection and admission.

## Sequel Standards

- No fake compatibility layer.
- No unmanaged native config import without approval and provenance.
- No weakening of native discovery, permissions, or direct harness operation.
- No promotion without capability matrices, projection benchmarks, tests,
  security review, and rollback design.

## Required Evidence

- An authoritative capability matrix for every supported harness and surface.
- Verified precedence and trust behavior for every supported source kind.
- Context-size and filesystem-duplication measurements for current full
  projections versus proposed thin or dynamic projections.
- Direct-harness and Kiln-managed live tests for discovery, invocation,
  permissions, drift, unavailable dependencies, and offline startup.
- Security review covering instruction injection, tool authority, plugin trust,
  native config import, and cross-harness privilege escalation.
- A migration and rollback design that does not silently import unmanaged
  configuration or break direct harness operation.

## Research Basis

Existing research is still required. This roadmap starts deferred until Kiln
has current harness capability matrices, projection benchmarks, and live tests
for direct and Kiln-managed operation.

## Delivery Slices

1. Capability matrix and source-precedence research.
2. Projection cost and duplication benchmark.
3. Security and trust-boundary review.
4. Thin or dynamic projection prototype behind fail-closed diagnostics.

## Promotion Gates

Promote this roadmap to active only after the capability matrix and projection
benchmarks show that a federated plane reduces meaningful duplication without
weakening native discovery, governance, or standalone reliability.

## Verification

- Capability matrix covers every supported harness and surface.
- Projection benchmark compares current full projection with proposed thin or
  dynamic projection.
- Direct-harness and Kiln-managed live tests pass for discovery, invocation,
  permissions, drift, unavailable dependencies, and offline startup.
- Security review covers instruction injection, tool authority, plugin trust,
  native config import, and cross-harness privilege escalation.

## Completion Criteria

This roadmap closes when a researched federated configuration model is either
promoted into architecture with implementation slices or rejected with evidence
and no production code retained.
