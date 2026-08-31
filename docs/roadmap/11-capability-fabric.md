# 11 - Capability Fabric

Status: In progress capability-portability track
Priority: High
Execution: In progress - Slices 3 and 4 are complete as of 2026-08-30. Core
owns aggregate contributions, bounded provider-neutral search/describe, and
exact executable schemas; Runtime owns immutable authority-linked generations,
next-round materialization, portable invocation bindings, and terminal
settlement. Canonical direct CLI verification is the first executable vertical,
and the permanent `verification-evidence` builtin projects to supported native
skill targets with an ordinary-command fallback. The
2026-08-28 operator priority decision
moves this track ahead of Roadmap 08; remote pairing remains Ready but is no
longer the current operational priority.
Created: 2026-08-14
Reprioritized: 2026-08-28

## Objective

Let a model running in any admitted Kiln surface discover and request the
capability best suited to its task without requiring the operator to copy
context into another harness. Kiln must resolve that request to a portable
tool, a harness-native tool, an API, or a governed specialist agent while
preserving permissions, effects, cost, evidence, and result identity.

The intended operator experience is continuous: a text-only parent may pass an
existing image artifact to a vision-capable worker, receive a typed analysis,
and continue in the same workflow without asking the operator to upload the
image again or reconstruct the prompt. The evidence must still identify which
model, harness, service, and tool performed each effect. Capability composition
must not become a claim that every model natively possesses every modality or
tool.

## Current Position

Kiln already has the foundations this track must reuse:

- Model Gateway projects one governed model catalog into native harnesses and
  Kiln-owned surfaces.
- Codex virtual models use the verified direct function-tool path; Codex
  remains the executor of its native shell and namespaced tools.
- OpenCode native sessions use `@opencode-ai/sdk/v2`; OpenCode V1 is not an
  admitted target. The exact admitted SDK baseline is `1.18.18`.
- Agent Tasks govern bounded local delegation, and managed external-harness
  routes govern admitted remote execution.
- Available Models separates discovery from execution authority.
- route capability, data-policy, economic, budget, permission, and lifecycle
  evidence already fail closed at their owning boundaries.

These foundations do not yet form a shared tool catalog. Harness tools remain
surface-specific, large inventories may be projected eagerly, and a capability
owned by one harness or model cannot yet be requested portably from another.
Slice 2 now records exact compatibility evidence for the three admitted
harnesses, but that evidence produces no native executable route.

The verification plane exposes the most mature local gap. Kiln already owns
typed, globally configured producers for Dafny, Oxlint, Kiln Quality, and
Gentle AI. Kiln-owned sessions can register those tools, but a standalone
Codex, Claude, or OpenCode session cannot discover or request the same
capabilities through a portable contract. Native skills can teach procedure;
they cannot grant the missing executable capability or turn an ordinary shell
result into Assurance evidence.

## Interface Position

Capability Fabric does not standardize on MCP or CLI as the universal tool
interface. It owns a canonical capability identity and chooses an admitted
implementation only after discovery, policy, and current execution evidence
are resolved.

The architectural direction is hybrid:

- MCP, OpenAPI, GraphQL, and official APIs provide portable discovery,
  structured contracts, remote authentication, and service transport.
- Admitted CLIs provide efficient local execution where a mature executable
  already has stable machine-readable behavior, such as source control,
  builds, tests, and package management.
- Deferred tool search and progressive disclosure control what enters model
  context independently of the implementation protocol.
- Programmatic or code-mode composition may reduce round trips for large APIs,
  but runs only inside an admitted sandbox with explicit resource, network,
  data, and effect limits.
- Narrow typed tools remain the preferred boundary for consequential effects;
  a generic shell or code executor is not a substitute for approval and
  authority.

The trend this track responds to is the move away from eagerly projecting one
model-facing schema per discovered operation. It is not evidence that MCP is
obsolete. A capability such as `web.search` may be implemented by a hosted
tool, MCP server, official API, admitted CLI, or specialist agent without
changing its model-facing identity or its governance semantics.

Tool search precedes implementation selection. The resolver must first reduce
the catalog to relevant eligible capabilities, then choose an implementation
using compatibility, permission, data, network, cost, latency, freshness, and
result-contract evidence. Adapter availability alone is never authority.

## Goals

- Define stable provider-neutral capability identities such as `web.search`,
  `vision.analyze`, `image.generate`, and `workspace.shell` only when an
  admitted implementation and current consumer justify them.
- Discover capabilities from Codex, Claude, OpenCode V2, Kiln surfaces, MCP,
  OpenAPI, GraphQL, admitted CLIs, and local services without duplicating
  execution policy in adapters.
- Load only the tool definitions needed for the current turn.
- Execute portable tools directly and use governed agent-backed capabilities
  when a modality or native tool belongs to another model or harness.
- Preserve structured inputs, correlated results, artifact identity,
  approvals, cancellation, replay safety, and content-free audit evidence.
- Provide the same capability semantics through CLI, GUI, TUI, SDK, Codex,
  Claude, and OpenCode V2 even when their wire representations differ.
- Make globally configured verification producers discoverable by capability
  rather than provider name while preserving their existing candidate-bound
  observations and Assurance boundary.
- Provide one portable operator-question lifecycle for clarification and
  decision elicitation, with correlated pause, answer, cancellation, expiry,
  and resume semantics across every admitted surface.
- Measure correctness, latency, cost, context reduction, and tool-selection
  quality before promoting defaults.

## Ownership

This track owns the canonical capability catalog, capability discovery,
deferred tool selection, implementation resolution, and cross-harness result
contract.

It consumes but does not replace these owners:

- Model Gateway owns model ingress, native model projection, routing, and
  provider protocol compatibility.
- Prompt Governance owns when admitted prompt, instruction, skill, and tool
  schema content enters model context.
- Agent Tasks owns governed local delegation and durable run settlement.
- Managed invocation owns admitted remote-harness transport.
- existing permission, data-policy, economic, budget, and capacity authorities
  own admission and settlement for their concerns.
- native harnesses own execution of their private tools and enforcement of
  their native sandbox or permission contract.

No adapter may become a second capability-selection or policy authority.

## Scope

- Canonical, versioned, secret-free capability descriptors.
- Capability kinds: portable tool, hosted tool, harness-native tool, and
  agent-backed capability.
- Typed input, output, artifact, effect, permission, network, data,
  provenance, freshness, cost, and compatibility evidence.
- Read-only discovery adapters for exact admitted harness and provider
  revisions.
- Provider-neutral `search`, `describe`, and invocation planning contracts.
- Native hosted tool search when proven and deterministic client-executed
  selection for harnesses or models without it.
- Globally configured local verification producers and their existing typed
  Kiln tool adapters.
- MCP, OpenAPI, GraphQL, admitted CLI, local function, and approved service
  execution ports.
- Server-side code-mode execution for large API surfaces when its sandbox and
  data-flow contract are admitted.
- Structured delegation to a model or harness that owns a required modality.
- Cross-surface progress, approval, provenance, result, and artifact
  projection.
- Bounded operator-question requests and responses for single choice, multiple
  choice, freeform, optional, conditional, and resumable clarification flows.
- Vertical proofs for web search, vision analysis, image generation, and
  cross-harness artifact handoff. Each proof must use an admitted implementation
  and a current workflow rather than creating a product feature only to exercise
  the fabric.

## Non-Goals

- No expansion of Model Gateway into a universal tool proxy or orchestrator.
- No claim that a model natively supports a delegated capability.
- No copying a private harness implementation into another harness.
- No OpenCode V1 path, alias, compatibility reader, or duplicated client.
- No adoption of an experimental OpenCode plugin hook as a stable contract
  before an exact released OpenCode V2 version exposes and proves it.
- No dependency requiring every Kiln user to create an Executor account.
- No durable dependency on private or alpha provider endpoints.
- No eager projection of every discovered tool to every model.
- No ambient `PATH`, shell interpolation, or operator-local executable state as
  durable CLI execution authority.
- No executable paths, provider routing, or Assurance claims encoded in a
  projected verification skill.
- No unrestricted client-side code mode for remote SaaS or consequential
  operations.
- No credentials, raw tokens, operator paths, unbounded payloads, or raw
  private results in catalog or audit evidence.
- No automatic execution of destructive capabilities without their owning
  approval authority.
- No shared React component tree or assumption that a GUI control is portable
  to terminal or native harness surfaces.
- No conversion of an ordinary questionnaire answer into durable approval for
  a consequential effect.

## Dependencies And Decisions

- Roadmap 06 remains the owner of progressive prompt and schema disclosure.
  This track decides which capability is eligible and selected; Roadmap 06
  decides when admitted descriptive content enters the prompt.
- OpenCode integration targets only the official V2 SDK and stable V2 plugin
  contracts. The repository pins `@opencode-ai/sdk` `1.18.18`, resolved to
  official tag `v1.18.18` and its generated V2 client/types; experimental tool
  discovery remains ineligible.
- Executor's `search -> describe -> execute` shape and OpenAI deferred tool
  search are research inputs, not adopted authorities.
- CLI and MCP are implementation transports, not capability identities. A
  provider or surface cannot select one by bypassing the Runtime resolver.
- The first implementation vertical is local verification. Exact
  provider-neutral capability ids are frozen by Slice 2 rather than inferred
  from current tool names. Dafny, Oxlint, Kiln Quality, and Gentle AI remain
  implementation identities and keep their distinct evidence semantics.
- `verification-evidence` is a permanent procedural skill, not a temporary
  bridge. It maps claims to evidence classes and consumes a Runtime-resolved
  capability decision. Before that resolver exists, native harnesses may use
  repository-owned verification commands and must report advanced capabilities
  as unavailable; the skill never embeds global binary paths or directly
  selects a provider.
- Mature local developer operations may prefer an admitted CLI. Remote SaaS,
  OAuth, structured multimodal results, and portable cross-harness services
  normally prefer MCP or an official API. High-risk mutations use the narrowest
  typed contract regardless of transport.
- The experimental `opencode-chatgpt-websearch` plugin demonstrates a useful
  provider adapter, but its alpha endpoint and manually described plugin
  surface are not a release contract for Kiln.
- A capability implemented by another model is represented as agent-backed
  delegation with explicit executor provenance, not as a fabricated local
  tool implementation.
- Operator questions and approvals are distinct contracts. A question obtains
  information or preference; approval authorizes an exact proposed effect
  under its owning authority. A surface may present both in one workflow, but
  it cannot merge their evidence or lifecycle.
- shadcn Questionnaire is a candidate GUI presentation primitive, not a Core
  or Runtime dependency. Its own contract deliberately leaves persistence,
  transport, branching, cancellation, and containing-surface behavior to the
  host, which matches Kiln's boundary.

## Ordered Slices

### Slice 0 - Exact Harness Contract Baseline

Status: Complete.

Resolve and freeze the exact supported Codex, Claude, and OpenCode V2 tool and
plugin contracts. Inventory which native definitions are portable functions,
which are hosted/provider tools, which remain harness-private, and which cannot
be represented without loss. Align the OpenCode SDK only after its exact stable
source and generated V2 contract pass focused session, permission, resume, and
tool-projection tests. Delete any V1 consumer found during the audit.

Acceptance: one versioned compatibility record exists per harness; each
capability claim is backed by source, fixture, and bounded live evidence; no
experimental plugin API or private endpoint is treated as stable.

Recovery: a failed version admission leaves the existing exact pinned adapter
and projections unchanged.

Evidence: the versioned schema, per-harness records, and synthetic event
fixtures live under
`docs/research/fixtures/capability-fabric/v1/`. The executable validator is
`packages/cli/tests/research/capability-fabric-baseline.test.ts`. Records bind
SDK and runtime versions separately, exact official source revisions and
artifact digests, npm integrity, semantic-loss classifications, fixture
digests, and bounded live-evidence status. Codex `0.147.0`, Claude `0.3.237`,
and OpenCode V2 `1.18.18` pass focused wrapper compatibility tests. The Codex
read-only and approved-write proofs both completed through the SDK's exact
bundled CLI with `gpt-5.6-sol`; the write produced canonical evidence without
retaining an absolute workspace path. Claude read-only and OpenCode
cancellation remain bounded observed provider evidence. OpenCode executable
`1.18.16` is recorded separately from SDK `1.18.18`; runtime parity and stable
tool-schema discovery are not claimed. Experimental discovery endpoints remain
ineligible, and no OpenCode V1 production consumer was found or retained.

Verification boundary: workspace typecheck, documentation validation, Slice 0
compatibility tests, focused wrapper/runtime tests, and both Codex live proofs
pass. The repository-wide CLI and Runtime suites still expose two failures
outside this slice: the frontend benchmark verifier source digest is out of
sync with its locked value, and the configured execution-account test expects
`dispatch-fenced` while the production diagnostic says `dispatch fence
identity`. Neither failing subsystem is changed by this slice; they remain
separate repository verification work and must not be reported as green.

### Slice 1 - Canonical Capability Catalog

Status: Complete.

Define the Core capability identity and decision values plus the public
secret-free projection contract. A descriptor must bind capability id,
revision, kind, owner, input and output schema digests, artifact types, effects,
permission and approval posture, network and data posture, supported callers,
freshness, provenance, limits, and implementation references. Discovery is not
execution authority; unavailable, stale, malformed, or contradictory evidence
fails closed.

Acceptance: duplicate identities, revision drift, schema mismatch, unsupported
effects, stale evidence, and secret-bearing fields are rejected; projection
contains no credential or dispatch method that bypasses Runtime admission.

Evidence: Core owns deterministic, deeply immutable capability descriptors,
identity-wide fail-closed decisions, bounded inert candidate inspection, and
content-addressed snapshots. Gateway Contracts owns the strict
`kiln.capability-catalog/v1` secret-free wire schema. Runtime projects only
Core-branded admitted snapshots and omits implementation references. The
architecture and contract are documented in
[`capability-catalog.md`](../architecture/tooling/capability-catalog.md).
Focused catalog tests and affected package builds pass; the foundation suites
pass with 375 Gateway Contract, 11 Tools, and 3,956 Core tests. Workspace
typecheck and documentation validation pass. The Runtime suite has 3,362
passing and 5 skipped tests plus the pre-existing configured execution-account
diagnostic mismatch recorded in the Slice 0 verification boundary; no new
Runtime failure was introduced.

### Slice 2 - Read-Only Discovery Adapters

Status: Complete with post-fix verification and independent Sol review closed.

Implement read-only adapters for Codex, Claude, OpenCode V2, MCP, OpenAPI,
GraphQL, admitted CLIs, and Kiln-owned tools. Normalize their declarations into
catalog candidates without mutating harness configuration or executing tools.
Preserve source-specific effect semantics such as safe reads, mutations,
destructive hints, and provider-hosted execution.

Begin with the four existing verification implementations before broad
protocol discovery:

1. inventory the registered `formal_verify`, `static_analyze`,
   `quality_analyze`, and `gentle_review` contracts without executing them;
2. define provider-neutral formal, static, artifact-quality, and inferential
   review capability candidates while preserving distinct input, output,
   authority, and evidence semantics;
3. bind configured implementations to the exact version and artifact digest
   evidence already owned by global verification configuration; and
4. represent an unavailable or invalid configured producer as an ineligible
   candidate with its existing diagnostic rather than omitting or guessing it.

`quality_analyze` is a Kiln local-function implementation and has no binary to
discover. Gentle AI remains a read-only active-transaction observer. Neither is
flattened into the deterministic CLI contract used by Dafny or Oxlint.

CLI discovery must bind an exact implementation artifact, version, digest,
provenance, and portable machine-readable contract. It must not execute an
arbitrary command resolved from ambient `PATH`. MCP discovery must bind an
exact server identity, protocol revision, selected-tool allowlist, schema
digest, and freshness. An upstream schema change cannot silently become
current execution authority. Harness compatibility discovery must consume the
real Codex, Claude, and OpenCode V2 records as inert evidence, emit
deterministic ineligible decisions without descriptors, and leave native routes
deferred.

Acceptance: the same source revision yields deterministic descriptors; unknown
fields or semantics remain visible as ineligible rather than guessed; adapter
tests prove no external effect during discovery; and all four verification
implementations retain their current tool, observation, and Assurance
boundaries. Exact Codex, Claude, and OpenCode V2 compatibility records produce
bounded ineligible catalog decisions with no descriptors, and native search and
execution remain deferred. MCP, OpenAPI, GraphQL, and admitted-CLI adapters
consume only their settled evidence contracts.

Evidence: Core now owns four deterministic provider-neutral candidates and
keeps missing, invalid, stale, or mismatched producers visible as ineligible.
The CLI projects settled global-config evidence without paths, commands, raw
diagnostic messages, or callbacks. Oxlint is resolved only from Kiln's exact
platform package with archive, executable, and fixed-profile digests; Dafny
binds its configured installation digest; Gentle AI binds its configured
executable digest; Kiln Quality binds the running release and
ordered compiled profiles. Focused Core and CLI tests cover inert inspection,
distinct effect and evidence semantics, safe failure projection, and all-four
eligibility. Current global operator configuration resolves all four
capabilities as eligible. `supportedCallers` remains `kiln-runtime` until the
search and execution slices prove native harness access.

The Core harness-compatibility adapter consumes the exact checked-in Codex,
Claude, and OpenCode V2 records as settled inert snapshots. The CLI integration
reads each real record and synthetic fixture, supplies their record and
fixture digests, and projects every declaration to a deterministic ineligible
catalog decision. It emits no capability descriptors or native candidates;
source-eligible declarations carry `native_route_deferred`, and native routes
remain deferred to later slices.

The current MCP delivery migrates every Kiln-owned consumer and producer from the
monolithic SDK v1 contract to the split TypeScript SDK `2.0.0` packages and
admits only protocol revision `2026-07-28`. Clients pin the revision without
probe fallback; HTTP and stdio servers reject legacy openings. Core also owns
a pure MCP tool adapter over settled plain-data snapshots and explicit local
bindings. Productive canonical configuration owns exact, case-sensitive
per-tool bindings globally; project configuration cannot add or replace them.
The projector derives a stable secret-free server-binding digest from effective
configuration shape and policy, then derives separate opaque owner, source, and
implementation identities from that digest. A process-private keyed
authorization context captures one-time credential and environment lease values
for the client lifecycle and supplies only its opaque digest and revision to the
adapter. Raw values and raw or unkeyed secret hashes never cross the boundary.

The productive operation joins that binding evidence to one exact fresh,
complete, non-invalidated tool snapshot. The client refreshes discovery and
invalidates the catalog on list changes; missing, expired, unknown, or
contradictory TTL evidence, authorization rotation, binding changes, and
cross-server or revision mismatches fail closed. The adapter validates bounded
JSON Schema 2020-12 object inputs without external references, preserves an
absent output schema as absent, treats descriptions, annotations, `_meta`, and
`serverInfo` as untrusted, and never synthesizes resources or prompts as tools.

The client deeply freezes and process-brands each settled observation while
keeping its exact server-binding and authorization attestations outside the
public snapshot. Projection rejects copied or serialized snapshots and makes a
branded snapshot ineligible after either attestation rotates. Pagination is
bounded by page, cursor, per-page, and shared catalog limits; malformed later
pages and repeated or non-progressing cursors fail the operation instead of
turning a partial prefix into complete evidence. All Slice 2 inert adapters
reject proxies before reflective inspection, so caller-defined traps cannot run
at the discovery boundary.

OpenAPI discovery now consumes a pure settled-snapshot adapter contract for the
`3.1.x` feature line. It admits canonical patch revisions only, requires a
complete document digest, non-invalidated fresh snapshot, and an exact local
binding for each `openapi:<source>:<method>:<path>` selector. The binding, not
the HTTP method, prose, or extension metadata, supplies capability identity,
effect, posture, and explicit policy identities. The adapter does not resolve
references, call operations, parse documents, or accept execution callbacks;
callbacks and webhooks remain observed but ineligible event declarations.
Request and response schemas use the bounded JSON Schema safety contract;
external and internal references, malformed or secret-bearing data, and
instruction injection fail closed, while missing response evidence remains
visible and ineligible.

GraphQL discovery consumes settled root-operation evidence for the exact
`September2025` revision. Each operation is bound to its source, schema digest,
operation-document digest, root kind/type, field, exact coordinate,
input/output schema digests, deprecation evidence, and resolved custom-scalar
schema evidence through an operation evidence attestation digest. An exact
local binding supplies policy, effect, and explicit identities; descriptions,
directives, and root kind do not choose capability identity. Introspection
fields and deprecated fields are ineligible; missing or contradictory
deprecation evidence, unresolved custom scalars, missing or unsafe schemas,
stale or invalidated snapshots, and evidence-digest mismatches fail closed.
This adapter also consumes only inert settled data and performs no network,
introspection, parsing, execution, or schema inference.

The installed dependency graph still contains the monolithic SDK v1 only as a
transitive implementation detail of the pinned Anthropic agent SDK and shadcn.
No Kiln-owned module imports it, exposes its entry points, or admits its legacy
wire contract. Physical removal of those transitive bytes depends on an
admitted vendor upgrade or replacement and is not retained legacy support.

Verification discovery covers the exact admitted CLI-backed producers Dafny and
Oxlint, the Kiln Quality local function with ordered profiles, and the Gentle AI
read-only hosted observer. Their provider-neutral identities and distinct
observation contracts remain separate; unavailable or invalid configuration is
retained as an ineligible candidate. Frozen Codex, Claude, and OpenCode V2
compatibility records preserve unsupported and harness-private classifications.
Native callers, deferred search, and portable execution remain later slices;
Slice 2 does not advertise them as supported execution routes.

Post-review evidence: the eight-file focused Core
capability/discovery/configuration set passes 179 tests, and the four-file CLI
MCP plus real harness-record integration set passes 26 tests. Workspace
production and test typechecks pass, documentation validation passes, and the
full Core suite passes 285 files with 3,544 tests. The full CLI suite passes 249
files and 2,684 tests with one skip while reproducing exactly two pre-existing
baseline failures already owned outside this slice: the overbroad whole-body
`model` assertion that matches MCP response metadata, and the configured Dafny
diagnostic expectation of `version_mismatch` when the current environment
settles `digest_probe_failed`. Neither failure is reclassified as Slice 2
evidence.

### Slice 3 - Deferred Tool Search

Status: Complete as of 2026-08-30.

Introduce small provider-neutral `capability.search` and
`capability.describe` contracts. Resolve candidates against the current route,
surface, permission, data, network, budget, artifact, and freshness evidence.
Inject only the selected tool definitions. Use a native deferred-tool protocol
where an exact model/harness contract proves it; otherwise perform a bounded
client-owned search step before the next model turn.

Acceptance: initial prompt/tool-schema cost is independent of total catalog
size within defined bounds; the selected descriptors and search evidence are
replayable; required safety or authority information is present before the
effect it governs; unsupported native tool-search requests fail closed.

After the resolver is executable, project `verification-evidence` to supported
native harnesses. The skill consumes `capability.search` and
`capability.describe`; it does not inspect global configuration, resolve a
binary, choose Dafny/Oxlint/Gentle directly, or treat skill availability as tool
authority. Its repository-command fallback remains useful for harnesses that
cannot reach the fabric and produces ordinary verification evidence only.

Closure evidence: the initial provider projection contains only the two fixed
discovery schemas regardless of catalog size; Core search is bounded to 64
results and carries catalog/request/descriptor digests; exact verification
schemas, implementation identity, and executor are bound into one immutable
Runtime generation; authority evidence persists generation, catalog,
candidate-projection, route, surface, caller, and linkage digests; tampering,
staleness, collision, missing authority, and unsupported native paths fail
closed; and selected tools enter only the next provider round. Focused Core,
Runtime, CLI, and native-skill projection tests pass, as do workspace typecheck,
the full Foundation and Runtime suites, and all surface suites. The full CLI
suite advanced without a reported test failure but did not terminate during the
closure run; focused affected CLI tests are the executable Slice 3 oracle.

### Slice 4 - Portable Tool Execution

Status: Complete as of 2026-08-30.

Add Runtime execution ports for admitted MCP, OpenAPI, GraphQL, CLI, local
function, and approved service tools. Keep credentials host-side. Validate
inputs and outputs against exact schemas, enforce time and size bounds,
preserve idempotency and replay posture, and settle every admitted invocation
with sanitized terminal evidence. Model-facing adapters translate only the
admitted portable contract.

An admitted CLI port uses argv arrays without shell interpolation, an explicit
working directory and environment allowlist, bounded output, timeout and
cancellation, stable exit and signal mapping, and structured output for
governed mutations. Credentials cannot appear in argv or model context. An MCP
port enforces server identity, selected schema revision, scopes, approval,
bounded structured or multimodal results, and cache freshness. Code mode is a
separate sandboxed execution port, not an alias for unrestricted shell access.

The first vertical proof is configured local verification. Start with Oxlint
static analysis because it already has an exact executable version, immutable
candidate bytes, a closed profile, bounded JSON output, and a facts-only
observation. Add Kiln Quality, Dafny, and Gentle AI only through their existing
distinct adapters; a shared execution port must not erase their different
candidate, lifecycle, or evidence contracts. Global executable paths stay
host-side and project repositories do not repeat them.

Acceptance: one provider-neutral static-analysis request resolves to the
configured Oxlint implementation and returns the existing candidate-bound
observation without changing its Assurance authority; unavailable, mismatched,
cancelled, timed-out, malformed, and candidate-mutation cases settle exactly as
the current producer does. The equivalent local-function proof covers Kiln
Quality. Dafny and Gentle AI then demonstrate that the resolver preserves
formal and inferential semantics rather than generalizing them into one lint
result.

`web.search` remains the next portable-service proof. It must use a documented,
supported provider or local service contract; an experimental ChatGPT alpha
endpoint may be used for research only, never as release authority.

Closure decision: the provider-neutral port contract admits CLI, local
function, MCP, OpenAPI, GraphQL, approved-service, and code-mode identities,
but this slice implements only the CLI and trusted local-function ports needed
by the verification proof. The remaining kinds are reserved identities rather
than empty adapters. Their real transport authority, credentials,
cancellation, and conformance work remains with the slice that admits each
productive integration.

Closure evidence: Core compiles and enforces the exact verification input and
output schemas and binds each tool to one implementation digest. Runtime binds
generation, catalog, descriptor, implementation, schemas, tool-call identity,
input, limits, and replay posture into an immutable invocation; validates input
before dispatch and output before return; and records sanitized terminal
settlement separately from producer metadata in canonical session events. The
CLI port uses absolute executables, canonical working directories, argv-only
spawning, an explicit environment allowlist, bounded output, and Runtime-owned
TERM-to-KILL escalation. The local port uses the same settlement contract.
Oxlint, Kiln Quality, Dafny, and Gentle AI preserve their distinct facts-only,
formal, and inferential observations. The configured Kiln Quality vertical
proves discovery through materialization, exact output validation, and
settlement; focused producer, Core-schema, Runtime-port, and direct CLI tests
cover the other verification semantics plus schema rejection, context
propagation, replay, timeout, cancellation, overflow, process failure,
candidate mutation, and settlement persistence. Package and workspace gates
are recorded by the closing commit.

### Slice 5 - Agent-Backed Capabilities

Status: Ready; not started.

Allow the resolver to choose a governed specialist agent when no direct tool
can satisfy a capability. The parent remains responsible for the user-facing
workflow. It supplies a bounded typed request; the child receives only admitted
context and authority; the result returns as a typed tool result or artifact.
Local work uses Agent Tasks and remote work uses configured managed external-harness routes.

The first proof is `vision.analyze`: a text-only parent delegates image analysis
to a vision-capable route, receives structured `VisionAnalysis`, and continues
without claiming it inspected the image itself.

Acceptance: executor model, route, harness, policy, budget, and artifact
provenance are explicit; failed, partial, cancelled, and unknown outcomes do
not become successful capability results; the parent cannot inherit the
child's broader permissions.

### Slice 6 - Cross-Harness Artifact Continuity

Status: Blocked on Slice 5.

Extend capability invocation and result contracts to carry references to
artifacts already owned by the context resource plane. Preserve canonical
artifact identity, content digest, media type, lineage, storage authority,
retention, and safe preview metadata across model and harness boundaries. Do
not create capability-specific artifact types until an admitted implementation
and current consumer require their distinct semantics.

The first proof extends `vision.analyze`: a text-only parent passes an existing
image through its canonical artifact reference to a vision-capable route,
receives a correlated `VisionAnalysis`, and continues without duplicating the
payload or asking the operator to reconstruct context. Additional transform or
generated-artifact contracts remain deferred until a second real workflow
proves that the shared semantics are reusable.

Acceptance: no manual context reconstruction or payload duplication is
required; artifact access is bounded to the admitted child; identity and
content digest survive the handoff; provenance identifies the caller,
executor, and any produced result; cancellation or failed access cannot become
a successful result; unsupported surface presentation never changes execution
truth.

### Slice 7 - Cross-Surface Promotion

Status: Blocked on vertical proofs.

Project the same catalog, search, approval, progress, provenance, and artifact
semantics into CLI, GUI, TUI, SDK, Codex, Claude, and OpenCode V2. Native wire
formats may differ, but capability identity and terminal evidence must remain
equivalent. Add operator controls for implementation preference, cost ceiling,
network posture, approval, and disablement through canonical configuration.

Add a shared operator-question contract before any surface-specific
implementation. It binds the request, ordered questions, answer modes,
validation revision, session and turn identity, lifecycle state, and correlated
response without carrying a view tree. Runtime owns pause, durable correlation,
expiry, cancellation, and resume; a skill may decide what to ask but cannot own
transport or continuation state.

Promote interaction surfaces in this order:

1. stabilize the complete GUI flow as the product reference, using an admitted
   accessible component such as shadcn Questionnaire where it fits;
2. recreate each stable interaction in TUI-native controls with behavioral and
   evidence parity rather than attempting to port React components or visual
   layout;
3. map the same contract to native Codex, Claude, and OpenCode controls when
   their exact admitted versions expose them; and
4. produce a typed pause for a surface that cannot collect the requested input
   without semantic loss.

GUI-first is a promotion sequence, not an ownership exception. Runtime and the
shared contracts remain authoritative throughout. The GUI is considered stable
only after its keyboard, accessibility, narrow-layout, persistence, resume,
cancel, validation, error, and correlation behavior passes the shared
conformance fixtures. TUI and native adapters then reuse those fixtures while
presenting interaction appropriate to their environment.

Acceptance: verification, web search, vision analysis, and artifact-handoff
workflows pass cross-surface conformance fixtures; a fresh Codex, Claude, and
OpenCode session can request admitted verification without knowing a binary
path or provider tool name; no surface recomputes capability policy;
operator status shows the actual executor rather than implying native model
support; a clarification flow started by the same canonical request can pause
and resume through GUI, TUI, and every supported native harness with equivalent
answers and terminal state; an ordinary answer never satisfies an approval
requirement.

### Slice 8 - Capability-Aware Orchestration Promotion

Status: Blocked on Slices 3 through 7 and stable work-governance contracts.

Replace the current orchestration assumption that a parent first chooses
direct work or a worker with a capability-first decision. The parent declares
the outcome and required capability. Runtime resolves the admitted
implementation and returns one of these execution shapes:

- a portable or hosted tool callable in the current session;
- a harness-native tool owned and executed by the active harness;
- a governed local implementation;
- an agent-backed capability requiring an Agent Task;
- a remote agent-backed capability requiring a managed external-harness route; or
- a typed missing-capability pause.

Direct tool execution and delegation are not interchangeable. If the admitted
implementation is available in the current execution boundary, orchestration
must not create a child merely because another model or harness originally
owned the capability. If the implementation is agent-backed, orchestration
must preserve the bounded child contract, attenuated authority, lifecycle,
artifact, and adoption rules. The parent remains the accountable conductor and
closer in both cases.

Update the canonical work-governance decision, handoff contracts, native
instruction projections, `orchestration-workflow`, and
`kiln-control-plane-workflow` only after the executable resolver is current.
The skills teach how to consume the resolved decision; they never inspect the
catalog to choose an implementation, select a route or model, widen authority,
or simulate a missing tool. Remove obsolete worker-first and managed-job
vocabulary in the same slice rather than preserving aliases or parallel
procedures.

Roadmap 06 owns progressive disclosure of the updated procedural text. This
slice owns its semantics and conformance with executable orchestration. A skill
projection cannot become the mechanism that grants a model access to a
capability.

Acceptance: equivalent tasks exercise direct portable, harness-native,
agent-backed local, and managed remote-harness implementations through one capability
request; no path double-delegates, reselects an implementation after admission,
or fabricates child evidence; missing capability produces the exact typed pause;
the parent correlates and adopts the result or artifact using canonical
lifecycle evidence; all admitted harnesses consume the same procedure without
surface-local routing logic.

Recovery: procedural projections are updated only after the new Runtime and
work-governance contracts pass cross-surface conformance. Projection failure
leaves executable authority unchanged and reports drift; there is no fallback
to the former workflow or tool names.

### Open Follow-Up - Native Harness Permission Assurance

Status: Open from the 2026-08-30 global configuration audit.

Owner: this track owns exact harness capability evidence and the integration
surface owns each native adapter. Prompt or skill projection is not an
enforcement owner.

Current risks:

- Codex has persisted native permission intent, but its version-bound effective
  Runtime attestation is stale. Stale proof must not authorize unattended or
  higher-risk execution.
- Claude Code permission modes and rules do not yet prove exact approval,
  filesystem-sandbox, or network enforcement parity with Kiln.
- OpenCode permission rules govern approval behavior but do not provide a
  Codex-equivalent filesystem sandbox. This is a durable harness limitation,
  not a translation detail that Kiln may approximate.

Required outcome:

- Renew Codex evidence through the existing content-free, version-bound Runtime
  attestation path and invalidate it whenever the executable revision,
  effective permission configuration, or proof contract changes.
- Keep approval control, filesystem isolation, network isolation, and
  authorization as separate evidence dimensions for every harness.
- Preserve `unsupported-semantic-translation`, `stale-evidence`, and
  `rules-only` classifications until an exact live proof supports a stronger
  classification; do not convert operator acceptance into technical proof.
- Make CLI, TUI, GUI, Gateway, and managed-invocation admission consume the same
  classification and remediation evidence.
- Add negative fixtures for stale attestations, unsupported granular rules,
  absent filesystem isolation, dangerous bypass modes, and conflicting native
  versus Runtime evidence.

Closure evidence: Codex reports current effective proof for its pinned revision;
Claude Code and OpenCode either gain separately proven enforcement dimensions
or continue to fail closed with explicit limitations; no surface claims generic
cross-harness permission or sandbox parity.

### Ready Follow-Up - Native MCP Product Identity

Status: Naming decision accepted; implementation pending.

Decision: the user-visible MCP server identity projected into Codex, Claude
Code, and OpenCode becomes `kiln`. `kiln-control-plane` exposes internal
architecture in an operator-facing namespace and produces unnecessarily long
qualified tool names. “Control plane” remains valid architecture vocabulary;
it is not part of the product-facing server id.

Scope:

- Replace the one managed native MCP server id with `kiln` in all three harness
  projections, status contracts, documentation, and conformance fixtures.
- Keep the internal `control-plane-mcp` command, adapter identifiers, server
  implementation names, existing `kiln_*` tool names, and
  `kiln-control-plane-workflow` skill unchanged unless each receives a separate
  naming decision.
- Replace the old identity outright. Do not retain an alias, duplicate server,
  compatibility shim, or two-server transition state.

Migration and recovery:

- Inspect native config and global install-state before mutation. If `kiln` is
  already present and is not proven to be Kiln-managed, fail closed and leave
  `kiln-control-plane` untouched.
- For a proven managed projection, back up the native file, remove only the
  recorded old field, write `kiln`, and atomically replace install-state with
  current provenance and hashes.
- Drifted, malformed, or contradictory ownership evidence blocks migration.
  Uninstall removes only the currently recorded managed identity.
- A failed write restores the prior file and install-state; it never leaves
  both identities installed.

Acceptance: clean install, managed replacement, unmanaged collision, drift,
malformed config, rollback, status, and uninstall fixtures pass for Codex,
Claude Code, and OpenCode; a live global sync leaves exactly one managed `kiln`
declaration per admitted harness; discovered tools and Runtime authority are
otherwise unchanged.

## Promotion Gates

- One canonical owner exists for capability identity, eligibility, selection,
  execution planning, evidence, and public projection.
- Model Gateway remains independent from tool execution and orchestration.
- Exact Codex, Claude, and OpenCode V2 compatibility evidence exists; OpenCode
  V1 has no production consumer.
- Tool search reduces measured schema/context cost without lowering task,
  safety, or tool-selection outcomes on representative model routes.
- Interface promotion is based on outcome evidence, not protocol preference.
  Evaluations hold model, harness, task, and authority constant; verify the
  interface actually used; and compare durable completion, context and cache
  cost, latency, failure and unknown-outcome rate, approval correctness,
  credential exposure, replay, and portability.
- The evaluation set includes a mature local CLI task, a SaaS without a mature
  CLI, a large API surface, a consequential approved mutation, and a
  multimodal artifact result. No single GitHub or token-count benchmark may
  establish a universal default.
- The mature local CLI evaluation begins with the existing Oxlint verifier and
  compares current direct-tool execution with capability-resolved execution
  over identical candidates, profiles, versions, permissions, and oracles.
- Discovery performs no external effect, and execution cannot begin before all
  owning authorities admit it.
- Every execution has bounded input, output, time, cancellation, settlement,
  and replay behavior.
- Credentials remain host-side and absent from prompts, schemas, artifacts,
  events, and durable public evidence.
- Agent-backed capabilities preserve executor attribution and attenuated
  authority.
- Work governance and orchestration consume the canonical capability decision;
  they do not independently choose tools, implementations, routes, models, or
  workers.
- `orchestration-workflow`, `kiln-control-plane-workflow`, native instruction
  projections, and executable work contracts use one current capability-first
  lifecycle vocabulary with no retained worker-first or managed-job procedure.
- Cross-surface conformance proves equivalent semantics without requiring
  identical wire payloads.
- GUI reference stability precedes TUI and native interaction promotion;
  downstream surfaces reproduce behavior and evidence, not React components or
  GUI layout.
- Independent security, architecture, provider-contract, and findings-first
  reviews have no unresolved high or medium findings.

## Research Basis

- OpenAI Agents SDK distinguishes hosted tools, local/runtime tools, function
  tools, agents as tools, and deferred tool search:
  <https://openai.github.io/openai-agents-python/tools/>.
- OpenAI keeps MCP as a first-class hosted, Streamable HTTP, SSE, and stdio
  integration with filtering, caching, and approval controls:
  <https://openai.github.io/openai-agents-python/mcp/>.
- Anthropic's code-execution guidance treats MCP servers as discoverable APIs
  and loads definitions on demand rather than replacing MCP with shell tools:
  <https://www.anthropic.com/engineering/code-execution-with-mcp>.
- Cloudflare's Code Mode demonstrates a small `search` and `execute` surface
  while explicitly naming the sandbox requirement and the broader attack
  surface of CLI execution:
  <https://blog.cloudflare.com/code-mode-mcp/>.
- The MCP 2026-07-28 specification adds stateless operation and dynamic server
  discovery, so the protocol remains an active transport and discovery input:
  <https://blog.modelcontextprotocol.io/posts/2026-07-28/>.
- The official TypeScript SDK v2 migration contract requires explicit 2026
  opt-in and documents exact pinning without legacy fallback:
  <https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28>.
- MCP tool declarations and annotations are untrusted hints, and current
  security guidance treats recursive tool schemas as a tool-poisoning surface:
  <https://modelcontextprotocol.io/specification/2026-07-28/server/tools> and
  <https://owasp.org/www-community/attacks/MCP_Tool_Poisoning>.
- Anthropic's tool-writing guidance supports narrow, namespaced, high-signal
  contracts rather than exposing implementation inventories directly:
  <https://www.anthropic.com/engineering/writing-tools-for-agents>.
- Recent tool-poisoning research reinforces binding reviewed declarations and
  detecting post-review changes rather than trusting server text at runtime:
  <https://arxiv.org/abs/2603.22489>.
- The 2026 preprint *The Scaffolding Matters More Than the Interface* finds no
  stable universal MCP-versus-CLI cost winner across its tested scaffolds. Its
  evidence is limited to one GitHub task with a mature `gh` CLI and therefore
  informs Kiln's evaluation design rather than establishing a default:
  <https://arxiv.org/abs/2608.08654>.
- OpenAI documents manager-owned agents as tools and handoffs as separate
  orchestration patterns:
  <https://openai.github.io/openai-agents-python/multi_agent/>.
- Executor demonstrates a compact `search -> describe -> execute` surface over
  MCP, OpenAPI, GraphQL, and custom integrations:
  <https://executor.sh/>.
- The experimental OpenCode V2 ChatGPT web-search plugin demonstrates
  provider-backed search while remaining explicitly experimental:
  <https://github.com/neriousy/opencode-chatgpt-websearch>.
- shadcn Questionnaire provides controlled, resumable, conditional,
  keyboard-accessible multi-step question flows while explicitly leaving
  persistence, transport, branching, and cancellation to the containing host:
  <https://ui.shadcn.com/docs/components/base/questionnaire>.
- Stable Kiln ownership boundaries are documented in
  [Model Gateway](../architecture/providers/model-gateway.md),
  [Agent Tasks](../architecture/coordination/agent-tasks.md),
  [Work Governance](../architecture/core/work-governance.md), and
  [Prompt Governance](06-prompt-governance-plane.md).

## Verification

Each slice begins with focused behavioral failures for its owning contract and
ends with its affected package tests, typecheck, public-schema validation,
privacy and serialization checks, and `git diff --check`. Shared contracts
require downstream adapter and surface conformance gates. Live proofs use
portable synthetic inputs where possible and operator-authorized credentials,
quota, network, and artifacts where real provider evidence is required.

The track-level evidence set must include:

- exact harness compatibility fixtures and live version reports;
- capability catalog validation and deterministic projection;
- no-effect discovery tests;
- verification-capability discovery and execution across Kiln-owned and native
  Codex, Claude, and OpenCode surfaces, with exact producer attribution and no
  binary paths in projected context;
- deferred versus eager schema-token measurements;
- paired CLI, MCP, API, and code-mode outcome measurements with the actual
  execution transport recorded;
- tool selection and malformed-call recovery evals;
- permission, data, network, budget, cancellation, and replay negatives;
- local Agent Task and remote managed-invocation settlement;
- direct-versus-agent-backed orchestration selection, missing-capability pause,
  child lifecycle, result adoption, and no-double-delegation conformance;
- current orchestration and control-plane skill projections across Codex,
  Claude, OpenCode V2, and Kiln-owned surfaces;
- cross-model artifact lineage and restore tests;
- CLI, GUI, TUI, SDK, Codex, Claude, and OpenCode V2 parity;
- operator-question pause, validation, answer, skip, cancel, expiry, resume,
  and approval-separation conformance, promoted GUI first and then reproduced
  in TUI and native harness interactions;
- end-to-end verification, `web.search`, `vision.analyze`, and presentation
  workflows.

## Completion Criteria

A user can begin a task with any admitted model in any supported surface,
discover only relevant capabilities, invoke a portable tool or governed
specialist without restating context, and continue with a correlated typed
result or artifact. Kiln reports the actual executor, permissions, cost,
provenance, and terminal outcome. Stable contracts and operations are promoted
to architecture and guides. Work governance and the projected orchestration
skills consume the same capability-first execution decision, so moving between
direct, native, portable, local-agent, and remote-agent implementations does
not require the operator or parent model to reconstruct the workflow.
The permanent `verification-evidence` skill consumes that decision across
surfaces; repository-owned commands remain the fallback for an unsupported
standalone harness and never impersonate Kiln Assurance.
Experimental research paths and superseded procedures are removed, and this
roadmap closes or splits only when no duplicated owner or unnamed residual
remains.
