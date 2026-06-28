Status: Deferred research

## Objective

Research whether Kiln can become the canonical configuration and capability
plane for every supported harness while projecting only the minimum native
material each harness needs. This is a post-release architecture initiative,
not a remaining slice of skill parity.

## Scope

- Skills and procedural context.
- Global and project instructions.
- Agents and subagent profiles.
- MCP servers, tools, resources, and capability metadata.
- Provider/model defaults and route preferences.
- Permissions, approvals, hooks, and harness-specific policy.
- Install state, drift, origin, admission, and omission diagnostics.

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

## Promotion Gate

Promote this roadmap to active only after the capability matrix and projection
benchmarks show that a federated plane reduces meaningful duplication without
weakening native discovery, governance, or standalone reliability.
