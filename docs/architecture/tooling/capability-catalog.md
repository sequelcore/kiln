# Capability Catalog

## Purpose

The capability catalog is Kiln's canonical, provider-neutral discovery
contract for tools and agent-backed capabilities. It records what a current,
bounded observation proves without granting permission to execute it.

`@kilnai/core` owns descriptor normalization, identity, deterministic digests,
eligibility decisions, and fail-closed catalog construction. Runtime owns the
public projection. Discovery adapters, operator surfaces, model harnesses, and
execution ports consume those decisions; none may reclassify a rejected
candidate or treat adapter availability as authority.

The developer-tool `ToolCatalogIndex` remains a separate lexical index over the
builtin tool surface. It is not a capability catalog, eligibility authority, or
portable execution contract.

## Canonical Descriptor

A descriptor binds one lowercase namespaced capability ID and explicit revision
to:

- capability kind and a typed owner with an opaque SHA-256 identity;
- input and output schema digests;
- artifact media types and optional artifact schema digests;
- the canonical `ActionEffectEnvelope`;
- permission and approval posture;
- network, data-classification, and retention posture;
- supported callers from Kiln's closed caller vocabulary;
- observed, expiry, availability, and provenance evidence;
- bounded input, output, duration, and artifact limits; and
- one or more opaque implementation references with matching schema digests.

The descriptor digest is computed from the normalized descriptor candidate and
is separate from its declared revision. Reusing the same capability ID and
revision for different normalized content is revision drift. Multiple identical
descriptors for the same identity are duplicates. Both conditions reject every
candidate in that identity group.

Canonical serialization orders object keys and normalized collections by
explicit UTF-16 code-unit order, independent of host locale or ICU behavior.
SHA-256 content identity is owned by Core's neutral content-addressing concern,
not by any capability, context, or Runtime bounded context.

Owner, provenance-source, and implementation identities are opaque SHA-256
digests. Implementation references identify Runtime-resolvable implementations.
They are not commands, endpoints, credentials, environment variables,
filesystem paths, raw adapter identifiers, or permission grants.

## Admission

Core constructs a catalog only for an explicit evaluation timestamp. Candidate
objects use strict allowlisted shapes, bounded collections and limits, canonical
timestamps and SHA-256 identities, and the existing action-effect vocabulary.
The untrusted boundary snapshots only inert plain-data properties without
invoking accessors, rejects cyclic or exotic object graphs, and enforces both
per-candidate and catalog-wide inspection budgets.

An eligible descriptor requires current available evidence, matching descriptor
and implementation schemas, known effects, internally consistent permission,
approval, network, and effect postures, and at least one implementation
reference. Unknown effect semantics, stale or unavailable evidence, malformed
content, contradictory posture, schema mismatch, duplicate identity, revision
drift, and secret-bearing content fail closed.

Approval consistency consumes the canonical action-effect authority derivation;
the catalog does not maintain a second approval policy. Candidate-specific
permission and network checks validate descriptor consistency only and do not
authorize execution.

Rejected content is not retained. Decisions expose only a validated capability
ID, revision, descriptor digest when safe, and a bounded reason code. A malformed
or secret-bearing candidate may therefore produce a reason without identity.

Catalog snapshots are deterministic, deeply immutable, content-addressed, and
branded by Core for their in-process lifetime. Runtime accepts only a branded
snapshot. Serialization does not preserve that authority; a restored catalog
must be reconstructed and revalidated by Core.

## Public Projection

`@kilnai/gateway-contracts` defines `kiln.capability-catalog/v1`. Runtime projects
eligible descriptors and sanitized rejection decisions into this strict
contract and validates the completed projection before returning it.

The public entry contains descriptive identity, schemas, artifacts, effects,
postures, callers, freshness, provenance, limits, and descriptor identity. It
does not contain implementation references, dispatch methods, credentials,
commands, endpoints, environment values, or paths. Public discovery therefore
cannot bypass later Runtime selection, permission, data-policy, budget,
approval, or execution admission.

## Verification Discovery

The first read-only adapter projects the four configured verification
producers into provider-neutral candidates without carrying executable paths,
commands, callbacks, repositories, or raw diagnostic messages:

| Implementation | Capability | Current caller | Evidence posture |
| --- | --- | --- | --- |
| Dafny / `formal_verify` | `verify.formal` | `kiln-runtime` | exact external version and complete installation digest |
| Oxlint / `static_analyze` | `verify.static` | `kiln-runtime` | exact Kiln-managed version, binary digest, archive provenance, and fixed profile |
| Kiln Quality / `quality_analyze` | `verify.artifact-quality` | `kiln-runtime` | running Kiln release and ordered compiled profiles |
| Gentle AI / `gentle_review` | `verify.inferential-review` | `kiln-runtime` | exact external version, executable digest, and review contract |

Configuration resolution remains the owner of executable validation. The CLI
adapter consumes only its settled evidence and reduces failures to stable safe
codes. Core preserves unavailable or invalid producers as ineligible
candidates rather than omitting them or guessing an implementation.

Codex, Claude, and OpenCode are intentionally not listed as supported callers
yet. Slice 2 makes the candidates portable and discoverable inside Kiln; the
deferred-search and portable-execution slices must prove each native harness
route before those callers can be advertised.

## MCP Tool Discovery

The MCP adapter consumes only a settled, plain-data snapshot produced by the
Kiln-owned client. It has no transport, configuration, filesystem, credential,
or execution access. Kiln supports only the exact MCP `2026-07-28` revision:
clients pin it without negotiation fallback, servers reject legacy traffic,
and a snapshot without proven modern negotiation is unavailable evidence.

An eligible MCP tool binds an operator-owned server identity, secret-free
server-binding and authorization-context digests, a complete non-invalidated
tool-list observation, and current TTL-bounded freshness. Self-reported
`serverInfo`, tool descriptions, schemas, `_meta`, and annotations are retained
only as untrusted declaration evidence. They cannot select a capability ID,
effect, permission, approval, data, network, or ownership posture.

Provider-neutral capability identity and governance posture come from an
explicit local binding for the exact case-sensitive tool name. The adapter
validates a bounded JSON Schema 2020-12 object input, refuses external schema
references, and includes the complete source declaration plus protocol,
binding, and authorization context in deterministic revision evidence. An
absent output schema remains absent and visible; it is never replaced by an
empty schema or inferred from prose. Resources and prompts remain distinct MCP
contexts and are not synthesized as executable capabilities by this adapter.

## Invariants

- Discovery is evidence, never execution authority.
- Core is the only eligibility and normalization owner.
- Runtime projects decisions but does not recompute them.
- Adapters report candidates and never select or authorize implementations.
- Unknown, stale, unavailable, malformed, or contradictory evidence is never
  admitted optimistically.
- Public projections enumerate safe fields instead of serializing internal
  descriptors or adapter objects.
- No compatibility reader, legacy alias, or fallback catalog exists.

## Implementation

- Core catalog: `packages/core/src/capabilities/capability-catalog.ts`
- Verification discovery: `packages/core/src/capabilities/verification-capability-discovery.ts`
- MCP tool discovery: `packages/core/src/capabilities/mcp-tool-capability-discovery.ts`
- CLI evidence projection: `packages/cli/src/config/verification/discovery.ts`
- Public schema: `packages/gateway-contracts/src/capability-catalog.ts`
- Runtime projection: `packages/runtime/src/capabilities/capability-catalog-projector.ts`
- Core behavior tests: `packages/core/tests/capabilities/capability-catalog.test.ts`
- Public contract tests: `packages/gateway-contracts/tests/capability-catalog.test.ts`
- Projection tests: `packages/runtime/tests/capabilities/capability-catalog-projector.test.ts`

The verification discovery delivery is complete. The exact MCP transport
migration and pure tool-adapter primitive are complete, but Slice 2 still owns
the productive projection that supplies operator-owned server-binding and
authorization-context digests to that adapter. OpenAPI and other protocol
adapters follow that closure. Execution ports, deferred search, persistence,
and surface presentation remain owned by later slices.
