# 11 - Capability Fabric

Status: Research capability-portability track
Execution: Research - define the cross-harness contract before admitting implementation.
Created: 2026-08-14

## Objective

Let a model running in any admitted Kiln surface discover and request the
capability best suited to its task without requiring the operator to copy
context into another harness. Kiln must resolve that request to a portable
tool, a harness-native tool, an API, or a governed specialist agent while
preserving permissions, effects, cost, evidence, and result identity.

The intended operator experience is continuous: a planning model may produce a
typed slide specification, an image-capable worker may render its visual, and
the original model may review the result in the same workflow. The evidence
must still identify which model, harness, service, and tool performed each
effect. Capability composition must not become a claim that every model
natively possesses every modality or tool.

## Current Position

Kiln already has the foundations this track must reuse:

- Model Gateway projects one governed model catalog into native harnesses and
  Kiln-owned surfaces.
- Codex virtual models use the verified direct function-tool path; Codex
  remains the executor of its native shell and namespaced tools.
- OpenCode native sessions use `@opencode-ai/sdk/v2`; OpenCode V1 is not an
  admitted target.
- Agent Tasks govern bounded local delegation, and A2A v1 governs admitted
  remote delegation.
- Available Models separates discovery from execution authority.
- route capability, data-policy, economic, budget, permission, and lifecycle
  evidence already fail closed at their owning boundaries.

These foundations do not yet form a shared tool catalog. Harness tools remain
surface-specific, large inventories may be projected eagerly, and a capability
owned by one harness or model cannot yet be requested portably from another.

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
  `vision.analyze`, `image.generate`, `presentation.render`, and
  `workspace.shell`.
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
- A2A owns admitted remote-agent transport.
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
- MCP, OpenAPI, GraphQL, admitted CLI, local function, and approved service
  execution ports.
- Server-side code-mode execution for large API surfaces when its sandbox and
  data-flow contract are admitted.
- Structured delegation to a model or harness that owns a required modality.
- Cross-surface progress, approval, provenance, result, and artifact
  projection.
- Vertical proofs for web search, vision, image generation, and presentation
  rendering.

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
- No unrestricted client-side code mode for remote SaaS or consequential
  operations.
- No credentials, raw tokens, operator paths, unbounded payloads, or raw
  private results in catalog or audit evidence.
- No automatic execution of destructive capabilities without their owning
  approval authority.

## Dependencies And Decisions

- Roadmap 06 remains the owner of progressive prompt and schema disclosure.
  This track decides which capability is eligible and selected; Roadmap 06
  decides when admitted descriptive content enters the prompt.
- OpenCode integration targets only the official V2 SDK and stable V2 plugin
  contracts. The repository currently pins `@opencode-ai/sdk` `1.18.16`; the
  first slice must re-resolve the exact stable version and its source before
  changing the integration.
- Executor's `search -> describe -> execute` shape and OpenAI deferred tool
  search are research inputs, not adopted authorities.
- CLI and MCP are implementation transports, not capability identities. A
  provider or surface cannot select one by bypassing the Runtime resolver.
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

## Ordered Slices

### Slice 0 - Exact Harness Contract Baseline

Status: Research; next admissible work.

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

### Slice 1 - Canonical Capability Catalog

Status: Blocked on Slice 0.

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

### Slice 2 - Read-Only Discovery Adapters

Status: Blocked on Slice 1.

Implement read-only adapters for Codex, Claude, OpenCode V2, MCP, OpenAPI,
GraphQL, admitted CLIs, and Kiln-owned tools. Normalize their declarations into
catalog candidates without mutating harness configuration or executing tools.
Preserve source-specific effect semantics such as safe reads, mutations,
destructive hints, and provider-hosted execution.

CLI discovery must bind an exact executable, version, digest, provenance, and
portable machine-readable contract. It must not execute an arbitrary command
resolved from ambient `PATH`. MCP discovery must bind an exact server identity,
protocol revision, selected-tool allowlist, schema digest, and freshness. An
upstream schema change cannot silently become current execution authority.

Acceptance: the same source revision yields deterministic descriptors; unknown
fields or semantics remain visible as ineligible rather than guessed; adapter
tests prove no external effect during discovery.

### Slice 3 - Deferred Tool Search

Status: Blocked on Slice 2 and Roadmap 06 progressive-disclosure admission.

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

### Slice 4 - Portable Tool Execution

Status: Blocked on Slice 3.

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

The first vertical proof is `web.search`. It must use a documented, supported
provider or local service contract; an experimental ChatGPT alpha endpoint may
be used for research only, never as the release authority.

Acceptance: one `web.search` request works from every admitted surface with the
same semantic result contract; destructive or credential-bearing variants are
rejected; cancellation, timeout, malformed response, and provider failure settle
honestly.

### Slice 5 - Agent-Backed Capabilities

Status: Blocked on Slice 3 and existing Agent Task/A2A admission.

Allow the resolver to choose a governed specialist agent when no direct tool
can satisfy a capability. The parent remains responsible for the user-facing
workflow. It supplies a bounded typed request; the child receives only admitted
context and authority; the result returns as a typed tool result or artifact.
Local work uses Agent Tasks and remote work uses A2A v1.

The first proof is `vision.analyze`: a text-only parent delegates image analysis
to a vision-capable route, receives structured `VisionAnalysis`, and continues
without claiming it inspected the image itself.

Acceptance: executor model, route, harness, policy, budget, and artifact
provenance are explicit; failed, partial, cancelled, and unknown outcomes do
not become successful capability results; the parent cannot inherit the
child's broader permissions.

### Slice 6 - Artifact Continuity

Status: Blocked on Slices 4 and 5.

Define reusable artifact contracts such as `VisionAnalysis`, `SlidePlan`,
`SlideSpec`, `GeneratedImage`, and `PresentationArtifact`. Preserve artifact
identity, content digest, media type, dimensions, lineage, storage authority,
and safe preview metadata across model and harness boundaries. Pass structured
artifacts instead of asking the operator to restate prompts.

The vertical proof is a presentation workflow: a planning model creates a
`SlideSpec`, an image-capable implementation produces a `GeneratedImage`, a
renderer produces a presentation artifact, and the original model reviews the
result.

Acceptance: no manual context reconstruction is required; artifacts remain
content-addressed and access-controlled; provenance identifies every producer
and transform; unsupported surface presentation never changes execution truth.

### Slice 7 - Cross-Surface Promotion

Status: Blocked on vertical proofs.

Project the same catalog, search, approval, progress, provenance, and artifact
semantics into CLI, GUI, TUI, SDK, Codex, Claude, and OpenCode V2. Native wire
formats may differ, but capability identity and terminal evidence must remain
equivalent. Add operator controls for implementation preference, cost ceiling,
network posture, approval, and disablement through canonical configuration.

Acceptance: web search, vision analysis, and presentation workflows pass
cross-surface conformance fixtures; no surface recomputes capability policy;
operator status shows the actual executor rather than implying native model
support.

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
- Discovery performs no external effect, and execution cannot begin before all
  owning authorities admit it.
- Every execution has bounded input, output, time, cancellation, settlement,
  and replay behavior.
- Credentials remain host-side and absent from prompts, schemas, artifacts,
  events, and durable public evidence.
- Agent-backed capabilities preserve executor attribution and attenuated
  authority.
- Cross-surface conformance proves equivalent semantics without requiring
  identical wire payloads.
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
- deferred versus eager schema-token measurements;
- paired CLI, MCP, API, and code-mode outcome measurements with the actual
  execution transport recorded;
- tool selection and malformed-call recovery evals;
- permission, data, network, budget, cancellation, and replay negatives;
- local Agent Task and remote A2A delegation settlement;
- cross-model artifact lineage and restore tests;
- CLI, GUI, TUI, SDK, Codex, Claude, and OpenCode V2 parity;
- end-to-end `web.search`, `vision.analyze`, and presentation workflows.

## Completion Criteria

A user can begin a task with any admitted model in any supported surface,
discover only relevant capabilities, invoke a portable tool or governed
specialist without restating context, and continue with a correlated typed
result or artifact. Kiln reports the actual executor, permissions, cost,
provenance, and terminal outcome. Stable contracts and operations are promoted
to architecture and guides, experimental research paths are removed, and this
roadmap closes or splits only when no duplicated owner or unnamed residual
remains.
