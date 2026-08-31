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

## Conceptual Model

Capability Fabric is a shared catalog of **what** governed work may request. It
is not a registry that copies each harness's private tools into every other
harness. A caller asks for a stable, provider-neutral capability; Kiln resolves
that request to one currently admitted implementation and returns a typed result
with provenance.

| Concept | Responsibility | Example |
| --- | --- | --- |
| Capability identity | Names the outcome the caller needs, independently of provider or transport. | `web.search`, `vision.analyze` |
| Descriptor | Defines the schemas, effects, limits, compatibility, and evidence required to consider that capability. | `vision.analyze/v1` with a structured `VisionAnalysis` result |
| Implementation | Identifies the concrete tool, service, local function, or specialist agent that can perform the work. | a native harness tool, MCP tool, official API, admitted CLI, or vision-capable agent |
| Execution route | Reaches the selected implementation under its owning authority and lifecycle. | direct portable invocation or governed agent-backed delegation |
| Result contract | Returns validated output, artifact identity, settlement, and executor provenance to the caller. | a typed search result or image analysis |

Resolution happens per invocation:

1. The caller searches for or requests a capability by its canonical identity.
2. Core exposes only descriptors supported by current, bounded evidence.
3. Runtime selects one exact implementation after authority, compatibility,
   data, network, budget, freshness, and result-contract checks.
4. Runtime invokes a portable implementation directly, or delegates to a
   governed agent when the implementation is private to another model or
   harness.
5. The caller receives the validated result and provenance. It does not receive
   the implementation's credentials, permissions, private schema, or lifecycle
   ownership.

For example, a Claude workflow may request `web.search`. If the admitted
implementation is a Codex-native search tool, Kiln can send a bounded request to
a governed Codex agent and return the agent's validated result to Claude. Claude
does not acquire or execute the Codex tool itself. The same capability identity
could instead resolve to MCP or an official API without changing the caller's
contract.

This model defines the architectural boundary, not blanket availability. Kiln
advertises only implementations whose discovery, authority, execution, and
settlement paths have been proven. The current verticals establish direct
verification execution and the first agent-backed `vision.analyze` contract;
other cross-harness capabilities remain incremental roadmap work.

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

Rejected descriptor content is not retained, but every bounded rejection remains
visible in the catalog's `decisions` as an `ineligible` status. Decisions expose
only a validated capability ID, revision, descriptor digest when safe, and a
bounded reason code. A malformed or secret-bearing candidate may therefore
produce a visible reason without identity or a descriptor.

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

## Harness Compatibility Discovery

The Core harness-compatibility adapter consumes exact, inert v1 compatibility
records for Codex, Claude, and OpenCode V2. It performs no file, package,
harness, command, or network discovery. The CLI integration reads the real
checked-in records and synthetic fixtures, computes caller-supplied record and
fixture digests, and passes those settled snapshots to Core.

Each declaration produces a deterministic `catalog.decisions` entry with
`status: "ineligible"`; the adapter produces no capability candidates or
descriptors. Source-eligible declarations carry `native_route_deferred`
evidence, while source-ineligible or experimental declarations retain their
bounded rejection reason. Native search and execution routes remain deferred
until later slices prove them; compatibility evidence alone never advertises a
native route.

## MCP Tool Discovery

The MCP adapter consumes only a settled, plain-data snapshot produced by the
Kiln-owned client. It has no transport, configuration, filesystem, credential,
or execution access. Kiln supports only the exact MCP `2026-07-28` revision:
clients pin it without negotiation fallback, servers reject legacy traffic,
and a snapshot without proven modern negotiation is unavailable evidence.

Productive canonical MCP configuration owns exact, case-sensitive per-tool
bindings globally. Project configuration can narrow admission but cannot add or
replace those bindings. The Kiln-owned projection derives a stable,
secret-free server-binding digest from structural and reference-shaped material
only. Raw `command`, ordered `args`, `cwd`, and `url` values are not included in
that digest; only their configured/length markers and environment/header
reference shapes participate. It then derives separate opaque owner, source,
and implementation identity digests from that binding digest.

The credential authority captures one process-private keyed authorization
attestation for a client lifecycle. Its one-time lease binds the raw transport,
command, ordered arguments, cwd, and URL together with resolved environment and
header values, freezes the environment view and resolver, and supplies only an
opaque authorization-context digest and exact revision to the pure adapter.
Value or key rotation changes that digest without exposing a raw secret, raw
secret-derived hash, or credential store to the adapter.

The Core MCP client stores that authorization evidence together with the exact
server-binding digest outside the public snapshot, deeply freezes the settled
observation, and process-brands it. Productive projection accepts only that
branded observation and requires both attestations to match the current server
and authorization lease; copying, serializing, or replaying a snapshot after
either changes cannot restore eligibility.

An eligible MCP tool binds an operator-owned server identity, both opaque
projection digests, a complete non-invalidated tool-list observation, and
current TTL-bounded freshness. The snapshot must carry the exact
`mcp-authorization-context/v1` authorization revision, and each local binding's
`bindingDigest` must equal the settled snapshot `bindingDigest`. MCP bindings
advertise exactly `supportedCallers: ["kiln-runtime"]`; native callers remain
deferred. Discovery requests a fresh list and list-change notifications
invalidate the prior catalog. Missing, stale, expired, unknown, or
contradictory TTL evidence; authorization rotation; binding or protocol
revision changes; and cross-server snapshot/binding mismatches fail closed.
Discovery pagination also fails closed on malformed pages, repeated or
non-progressing cursors, excess pages, oversized pages, or exhaustion of the
shared tool/resource/prompt capability budget. A partial prefix is never
stamped complete.

The exact local binding supplies capability identity, kind, postures, limits,
and opaque identities. `admission.effects` is the sole effect owner: the
projector copies the complete canonical effect for the case-sensitive tool name
from that map, and a missing or malformed entry is unavailable. Tool
declarations, annotations, and any other source cannot override it. Rejected
or unavailable tools remain visible through bounded ineligible catalog
decisions and diagnostics, while no rejected descriptor is admitted.

Self-reported `serverInfo`, tool descriptions, schemas, `_meta`, and annotations
are retained only as untrusted declaration evidence. They cannot select a
capability ID, effect, permission, approval, data, network, or ownership
posture.

Provider-neutral capability identity and governance posture come from an
explicit local binding for the exact case-sensitive tool name. The adapter
validates a bounded JSON Schema 2020-12 object input, refuses external schema
references, and includes the complete source declaration plus protocol,
binding, and authorization context in deterministic revision evidence. An
absent output schema remains absent and visible; it is never replaced by an
empty schema or inferred from prose. Resources and prompts remain distinct MCP
contexts and are not synthesized as executable capabilities by this adapter.

## OpenAPI Discovery

The OpenAPI adapter consumes only an inert, already-settled operation snapshot;
it is not a document parser or execution port. It admits the exact `3.1.x`
feature line with a canonical `3.1.<patch>` revision, a complete document
digest, an explicit non-invalidated state, and current bounded freshness. Each
operation must use the exact `openapi:<source>:<method>:<path>` selector and an
exact local binding for the same source and selector. The binding supplies the
capability ID, effect, permissions, approval, network/data posture, limits,
and explicit owner/source/implementation identities; HTTP method, prose, and
extensions cannot select policy or identity.

The adapter never resolves `$ref` or related references (including internal
fragments), parses a document, calls an operation, or accepts an execution
callback. OpenAPI callbacks and webhooks are observed as event declarations but
are explicitly ineligible for executable capability candidates. Request and
response schemas pass the bounded inert JSON Schema 2020-12 safety contract;
malformed, secret-bearing, instruction-injecting, cyclic, exotic, or oversized
schemas fail closed. A missing response schema remains visible as unavailable
evidence rather than being inferred or replaced with an empty schema.

## GraphQL Discovery

The GraphQL adapter consumes only settled root-operation evidence for the exact
`September2025` specification revision. A complete, non-invalidated, fresh
snapshot must carry a schema digest. Each operation is qualified by its source,
root kind and type, field name, exact coordinate, and selector, and carries a
document digest plus an operation evidence attestation digest. The attestation
binds the specification and source, schema and operation-document digests,
root kind/type, field and coordinate, input/output schema digests, deprecation
evidence, and every custom-scalar resolution and schema digest. Every
`resolved: true` custom scalar must carry a valid `schemaDigest`; unresolved
scalars may carry an optional digest. A changed settled field with a reused
attestation is therefore unavailable.

An exact local binding supplies the capability identity, effect, postures,
limits, and explicit owner/source/implementation identities. Descriptions,
directives, and root kind do not choose policy or capability identity.
Introspection fields are rejected; deprecated fields are ineligible; and
missing or contradictory deprecation evidence, missing or unresolved custom
scalar evidence, stale or invalidated snapshots, and attestation mismatches
fail closed. Input and output schemas use the bounded JSON Schema 2020-12
safety contract with no reference resolution, secret or instruction-injection
content, accessors, executable values, proxies, cycles, exotic objects, or unbounded
data. This boundary performs no network request, introspection call, parser,
query execution, or schema inference. The legacy `deprecated` and
`customScalarResolutions` aliases are removed from the contract and rejected;
no compatibility alias is read or honored.

## Deferred Search And Materialization

Core owns the bounded provider-neutral `capability.search/v1` and
`capability.describe/v1` contracts. Search accepts a maximum 256-character
query and returns at most 64 descriptors; the default is 16. Search and
description expose descriptor and schema digests plus replay evidence, never
implementation references, callbacks, credentials, commands, endpoints, or
paths. Adapter observations enter one aggregate catalog as branded
`CapabilityCatalogContribution` values. Duplicate contribution identities,
revision drift, stale evidence, and malformed schemas reject rather than
selecting a partial result.

Runtime prepares one immutable capability generation for an exact catalog,
evaluation instant, project, application, surface, caller, schema set,
implementation identity, and process-local executor. A generation initially
projects only the fixed `capability.search` and `capability.describe` tool
definitions. Its size is therefore independent of catalog size within the Core
catalog and search bounds. `capability.describe` can select one exact
descriptor, but its tool definition and executor are materialized only into the
next provider round after the current authority bundle admits the same
generation, catalog, candidate projection, route, surface, and caller.

`EffectiveAuthorityAdmissionBundle` revision 2 requires an explicit
`capabilityParticipation` state. A participating turn persists generation,
catalog, candidate-projection, route, surface, caller, and linkage digests.
Runtime rejects an absent or stale generation, a changed schema or executor
identity, a name collision, an omitted authority candidate, a widened effect,
unsupported data/network/retention/budget/artifact evidence, or any linkage
contradiction. Generations invalidate monotonically; there is no mutable global
registry and no post-admission reselection.

The first executable vertical is the canonical direct CLI session over the
configured verification producers. The CLI binds Core's exact verification
input/output schemas to the attached Runtime executors and prepares a
generation only when the composing surface explicitly identifies itself.
Other surfaces do not infer support from shared configuration: an unsupported
native or surface-local search request remains unavailable or fails closed.

Selected tools execute through the Runtime-owned
[portable capability execution](portable-capability-execution.md) contract.
The immutable invocation binds the admitted generation, exact implementation,
schemas, tool-call identity, input digest, limits, and replay posture. Runtime
validates both sides of the invocation and persists sanitized settlement apart
from the producer's domain observation. CLI and trusted local function are the
first concrete ports; reserved protocol kinds do not imply an executable
adapter.

The permanent builtin `verification-evidence` skill is projected through the
existing native-skill lifecycle to Codex, Claude Code, and OpenCode when enabled.
It consumes `capability.search` and `capability.describe` when the current
harness can reach the fabric. Otherwise it permits only repository-owned
verification commands and labels their results as ordinary command evidence;
skill presence never grants tool authority or selects a verifier.

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
- Core deferred search: `packages/core/src/capabilities/capability-search.ts`
- Verification discovery: `packages/core/src/capabilities/verification-capability-discovery.ts`
- Harness compatibility discovery: `packages/core/src/capabilities/harness-compatibility-capability-discovery.ts`
- MCP tool discovery: `packages/core/src/capabilities/mcp-tool-capability-discovery.ts`
- MCP configuration and client: `packages/core/src/mcp/index.ts` and `packages/core/src/mcp/client/index.ts`
- MCP productive projection: `packages/core/src/capabilities/mcp-tool-capability-projection.ts`
- JSON Schema safety: `packages/core/src/capabilities/capability-json-schema-safety.ts`
- OpenAPI discovery: `packages/core/src/capabilities/openapi-capability-discovery.ts`
- GraphQL discovery: `packages/core/src/capabilities/graphql-capability-discovery.ts`
- Canonical MCP CLI discovery and authorization lease: `packages/cli/src/config/canonical-mcp-capability-discovery.ts` and `packages/cli/src/config/mcp-credentials.ts`
- CLI evidence projection: `packages/cli/src/config/verification/discovery.ts`
- Public schema: `packages/gateway-contracts/src/capability-catalog.ts`
- Runtime projection: `packages/runtime/src/capabilities/capability-catalog-projector.ts`
- Runtime generation and materialization: `packages/runtime/src/capabilities/runtime-capability-composition.ts`
- Portable binding, ports, and settlement: `packages/runtime/src/capabilities/portable-execution.ts`, `portable-cli.ts`, and `portable-local-function.ts`
- Canonical CLI composition: `packages/cli/src/application/canonical-run-session-dispatcher.ts`
- Permanent verification skill: `packages/core/src/skill/builtin-skills.ts`
- Core focused tests (8 files): `packages/core/tests/capabilities/capability-catalog.test.ts`, `capability-json-schema-safety.test.ts`, `harness-compatibility-capability-discovery.test.ts`, `mcp-tool-capability-discovery.test.ts`, `mcp-tool-capability-projection.test.ts`, `openapi-capability-discovery.test.ts`, `graphql-capability-discovery.test.ts`, and `packages/core/tests/mcp/mcp-config-resolution.test.ts`
- Public contract tests: `packages/gateway-contracts/tests/capability-catalog.test.ts`
- Projection tests: `packages/runtime/tests/capabilities/capability-catalog-projector.test.ts`
- CLI focused tests (4 files): `packages/cli/tests/commands/mcp-config.test.ts`, `packages/cli/tests/config/mcp-credentials.test.ts`, `packages/cli/tests/config/mcp-resolution.test.ts`, and `packages/cli/tests/research/capability-fabric-baseline.test.ts`

Slice 2's verification discovery, harness compatibility adapter, exact MCP
transport migration, productive MCP binding/authorization projection, OpenAPI
settled-snapshot adapter, and GraphQL settled-operation adapter are
implementation-complete. Post-fix focused tests, full Core, workspace
typechecks, and documentation validation pass. Independent Sol review closed
with no unresolved high or medium findings.
Deferred search and the first portable execution vertical are complete.
Additional protocol ports and cross-surface presentation remain owned by later
slices.
