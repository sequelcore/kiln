# Managed Agent Invocation

Managed agent invocation is Kiln's provider-neutral substrate for bounded child
work. It allows a parent session to request a child execution surface while
preserving explicit authority, governed context, credential routing, lifecycle
evidence, replay, and write boundaries.

This subsystem is part of Kiln's biocybernetic control plane. It is a regulated
execution boundary, not an orchestration-first abstraction and not a compatibility
layer for provider-specific agent terminology.

## Doctrine

Kiln owns the managed invocation contract. Providers, harnesses, and local tools
may expose concepts such as subagents, delegates, tasks, sessions, patch
approval, sandbox policies, or ACP runtimes, but those terms remain adapter
inputs. Canonical Kiln state is expressed through managed invocation requests,
admission decisions, invocation records, write evidence, session events, and
resource URIs.

Subscription-backed direct providers are the preferred managed-agent route
family when they are authenticated, compliant for the requested workflow, and
live-proven for the required authority. Native CLI harnesses are fallback
adapters, not the normal economic path. Do not promote a harness route simply
because it can edit today if the operator's configured route strategy is
`codex-oauth`, `opencode-go`, and `opencode-zen`; direct write routes must use
the direct-provider runtime adapter and pass the same managed write evidence
contract as any harness route.

A managed invocation is admissible only when the runtime can prove the requested
authority is complete and bounded. Missing provider route, adapter kind,
execution mode, permission profile, tool authority, working directory, timeout,
credential route, memory scope, or write authority causes admission to fail
closed.

The parent session never lends ambient authority to the child. Context,
credentials, memory access, tool access, filesystem access, timeout, transcript
persistence, and result handoff are explicitly admitted per invocation. Agent
profile selection, skill access, and child context mode follow
[`agent-context.md`](agent-context.md); they are requests that the runtime must
resolve, admit, and record before execution.

Route identity and agent profile identity must not be inferred independently by
different surfaces. When a caller requests an `agentProfile`, that profile's
route hint is the route-selection authority unless the work item itself carries
an explicit route as part of its contract. Goal-level route policy cannot
combine `managedAgentProfile` with `preferredRouteId`; contradictory route and
profile pairs fail closed before child execution starts.

## Non-Boundaries

Managed invocation does not itself define conductor planning, fan-out/fan-in
scheduling, durable workflow execution, team topology mutation, or autonomous
multi-agent strategy. Work-governance policy may require the parent to use
managed invocation for non-trivial work, but that policy remains a caller-side
control decision. Managed invocation owns the child execution boundary once a
bounded child request is admitted.

Managed invocation also does not make provider-native permission behavior
authoritative. Provider sandbox and approval claims are telemetry until Kiln
observes filesystem state, canonical events, and recorded evidence inside the
admitted boundary.

## Canonical Contracts

The core contract is defined in `@kilnai/core`:

- `ManagedAgentInvocationRequest`
  Describes the requested child work, parent lineage, provider route, execution
  surface, authority profile, bounded input, and optional work handoff contract.
- `ManagedAgentAdmissionDecision`
  Records whether the request is admitted or denied and names the exact missing
  capabilities when denied.
- `ManagedAgentInvocationRecord`
  Records the terminal lifecycle state, provider route actually used, authority
  snapshot, child lineage, transcript pointer, diagnostics, usage, result
  handoff, and write evidence.
- `ManagedAgentAdapterDescriptor`
  Declares what an adapter can enforce: lifecycle, cancellation, timeout,
  transcript persistence, usage reporting, credential routing, memory context,
  cleanup, unsupported-field policy, and write authority.
- `ManagedAgentCapabilitySnapshot`
  Captures the immutable admission-time capability view: route id, route
  source, route health, provider/model proof, effective provider route, adapter
  kind, execution mode, adapter descriptor, authority profile, context mode,
  resource-plane availability, and projected child identity.

`ManagedAgentInvocationInput.handoff` carries the parent-side work contract
when a child is executing or reviewing a governed work item. It may include
`workItemId`, `roleIntent`, `expectedEvidence`, `requiredResultFields`,
`doneCriteria`, and `residualRiskRequired`. These fields make the child handoff
auditable across GUI, TUI, CLI, SDK, and replay consumers; they do not grant
authority and do not replace admission profiles.

Runtime execution is owned by `RuntimeManagedAgentInvocationService`. Adapters
must not be treated as authoritative when called outside the service. The service
re-evaluates admission immediately before execution using the admitted
capability snapshot, checks the adapter descriptor, and validates the returned
record against the admitted request and snapshot.

## Lifecycle And Parallel Execution

Managed invocations have a runtime-owned lifecycle. A parent may request a
nonblocking child, inspect status, join a terminal result, cancel an active
child, and list current children through the managed-agent runtime tools. Those
operations are projections over `RuntimeManagedAgentInvocationService`; they do
not create a second lifecycle in CLI, GUI, TUI, native, or provider adapters.

The canonical lifecycle states are requested, started, completed, failed,
cancelled, recovered, denied, and unavailable. Terminal states carry evidence:
capability snapshot, authority profile, route identity, child lineage,
transcript pointer, diagnostics, usage when available, result handoff, write
evidence, and resource leases. A child that cannot provide substantive handoff
evidence fails closed even when the provider process exits successfully.

Managed invocation tool results expose admitted authority as structured runtime
evidence. `managed_agent.start`, `managed_agent.status`, `managed_agent.list`,
`managed_agent.join`, and `managed_agent.cancel` project an `authoritySnapshot`
derived from the admitted request, not from route names or provider prose. The
snapshot includes the authority profile id, permission profile, allowed tool
names, explicit write and network flags, working-directory mode, timeout
evidence, credential route, and memory scope. Operator surfaces and parent
agents must use this snapshot as the inspectable authority evidence for a child
invocation.

Running and terminal snapshots may also carry `progressEvents`. These are
runtime-observed child events such as tool authorization, tool call, tool
result, tool cache hit, and runtime error. Direct-provider children emit these
events through the child `RuntimeSessionOrchestrator` event bus; the managed
invocation service retains a bounded recent event list for status, list, join,
cancel, and replay consumers. Progress events are evidence of observed
execution, not authority grants, and surfaces must not infer missing authority
from them.

Parallel execution is expressed as managed orchestration over the same child
lifecycle. Core owns typed orchestration requests for fan-out, decomposition,
review swarm, route comparison, and background job modes. Each request carries
parent lineage, child requests, expected evidence, isolation policy, merge or
adoption policy, and child-count limits. Runtime and CLI adapters may launch
children only after the shared admission contract accepts the request.

`kiln run --workers` is a compatibility command over this lifecycle, not an
independent worker implementation. It builds a typed fan-out request, admits it,
starts children through `RuntimeManagedAgentInvocationService`, observes and
joins terminal records, and reports normalized orchestration evidence. It must
not recursively invoke the CLI or maintain a separate worker registry.
Runtime lifecycle tools use the persisted operator turn id when constructing
child lineage. Hydrated GUI/TUI sessions may have more messages in memory than
the currently persisted turn ordinal; child `parentTurnId` and invocation id
must follow the transcript turn being executed, not a reconstructed runtime
message count.
The parent turn is first-class operator evidence. Start, status, list, join,
cancel, canonical session events, cockpit replay, CLI inspection, and transcript
resources must preserve the same `parentTurnId` instead of forcing operators to
derive lineage from invocation-id text.

Admission for parallel children fails closed when any required plane is
unavailable:

- child count exceeds configured limits
- no unique healthy lifecycle route is available
- budget admission denies every eligible route or live usage is unavailable
- workspace isolation cannot be acquired
- task risk is too high for unmanaged parallel execution

Runtime/session budget admission is the owning budget plane. CLI config may
project `routing.budget` into a `BudgetAdmissionPolicy`, but the admission
decision is evaluated by the runtime budget admission service. There is no
CLI-local, managed-orchestration-local, or gateway-billing shim for child
budget admission.

## Isolation, Leases, And Cleanup

Write-capable and long-running children require explicit resource leases. The
runtime owns lease acquisition, health evidence, cleanup evidence, stale
recovery, and dirty-worktree preservation. Leases include:

- isolated git worktrees
- policy-backed sandboxes
- artifact directories
- development-server ports
- environment bindings
- credential routes

Same-checkout parallel writes are denied unless the admitted write scope proves
there is no overlap. A write-capable child should normally run in an isolated
worktree with an invocation-scoped lease. Runtime startup recovery reconstructs
abandoned children, preserves leaked or dirty worktree evidence, and emits
review-required diagnostics instead of mutating the parent checkout silently.
Invalid, stale-contract, or non-regular filesystem recovery checkpoint entries
are quarantined with metadata at the recovery-store boundary; the runtime does
not synthesize missing route provenance, accept request-local timeout source
values, or adopt malformed checkpoint content.

Cleanup is evidence, not best effort background noise. Normal completion,
failure, cancellation, parent interruption, timeout, and restart recovery all
route through the same terminal finalization path so transcript records,
resource leases, and operator projections remain consistent.

## Capability Snapshots

Admission produces one immutable `ManagedAgentCapabilitySnapshot` for every
admitted invocation. The snapshot is part of the admitted decision, terminal
invocation record, canonical session events, and managed tool metadata. Later
provider health checks, model catalog changes, projection changes, or route
configuration edits must not rewrite what the invocation was admitted to use.

Long-running operator surfaces maintain a live route catalog before admission.
GUI and TUI staged catalogs must refresh provider model discovery and re-read
current global config instead of holding the process-start route objects
forever. This refresh may update future route availability, network/tool
authority, model selection, and agent route hints, but it never mutates an
already admitted capability snapshot.

Caller identity is admitted from the runtime attachment, not from the route
catalog. `ManagedInvocationToolOptions` is a caller-neutral catalog of routes,
unavailable diagnostics, agents, skills, context resolver, artifact store, and
shared invocation service. `ManagedInvocationToolAttachment` pairs that catalog
with explicit `callerIdentity` evidence at the surface that exposes
`managed_agent.*`. Kiln-owned surfaces attach `kiln-runtime` identity; external
harness adapters attach `external-harness` identity only when that harness is
proven. Provider id, model id, UI profile controls, and config filenames must
not be used to infer the parent caller.

For external harness callers, cross-harness provider admission is a shared core
capability contract. The runtime records `invocationCapabilityEvidence` in the
admitted snapshot with the adapter id, adapter descriptor id, decision, and
reason. Unsupported caller/provider pairs fail before adapter invocation, while
supported read-only pairs continue through the same authority profile, tool
policy, transcript, resource, and terminal-result evidence as any other managed
child. The first supported cross-harness slice is read-only managed invocation;
write authority, fan-out, and remote adapter expansion require separate
capability proof.

The snapshot is intentionally normalized rather than provider-native. It records:

- route id and admitted route-health reason
- route source: `ordered-routing`, `explicit-managed-route`,
  `managed-default-route`, or `enabled-engine-fallback`
- provider/model proof status and source
- effective provider route, adapter kind, and execution mode
- full adapter descriptor used for admission
- authority profile and context mode
- resource-plane availability and admitted resource URIs
- projected child identity, including requested/admitted agent profile and
  display name when available

Adapters must return records with the exact snapshot admitted by the runtime.
`RuntimeManagedAgentInvocationService` rejects terminal records that omit,
broaden, or replace the snapshot. Operator surfaces render selected snapshot
fields as human-readable details and keep the full object available for replay
and audit. Managed invocation transcript and diagnostic resources also embed
the snapshot summary, so `resource_read` does not need live route health or
provider catalog state to explain what happened.

## Authority Profiles

Kiln currently recognizes these managed invocation profiles:

| Profile | Purpose | Write authority |
| --- | --- | --- |
| `foundation-readonly-plan` | Read-only analysis, planning, review, and exploration. | Not present. Any non-denied write evidence is rejected. |
| `foundation-propose-writes` | Child may propose workspace, memory, or artifact changes but cannot apply them. | Required, proposal mode only. |
| `foundation-apply-approved-writes` | Child may apply a workspace write that has policy-approved evidence and bounded scope. | Required, `apply-approved` workspace mode. |
| `foundation-memory-write-proposals` | Child may propose governed memory mutations without directly mutating durable memory. | Required, memory proposal mode. |

Every authority profile includes:

- tool authority: allowed tool names, write flag, and network flag
- working directory: path and access mode
- timeout budget
- credential route: runtime-selected route ID or credentialless declaration
- memory scope: project/domain scope plus read-only or proposal access
- optional write authority: workspace, memory, artifact, and tool write scopes

The network flag is explicit route authority, and today it is admitted only for
read-only profiles. Web, browser, computer-use, source extraction, and image retrieval phases must
run through `foundation-readonly-plan` routes with `networkAllowed: true`.
Write-capable profiles fail closed when `networkAllowed` is true unless a future
ADR introduces a separate combined write+network authority profile with its own
proof obligations. This keeps frontend-reference research and file mutation as separate
auditable phases instead of giving one child both internet/browser and write
authority by accident.

## Write Authority

Write authority is Kiln-owned and provider-neutral. It has three responsibilities:

1. Scope the write before execution.
2. Record proposal, approval, attempt, denial, cleanup, and rollback evidence.
3. Preserve replayable references without embedding raw diffs or large payloads
   into session events.

Workspace writes are bounded by allowed and denied paths. Approved application
requires `foundation-apply-approved-writes`, `apply-approved` workspace scope,
approval evidence, rollback evidence support, cleanup evidence support, and
adapter scope reduction.
Runtime route projection must obtain that scope from explicit
`managedAgents.routes[].writeAuthority` configuration. `tools.writes: true` or
a write profile name is not sufficient by itself, because those fields do not
define allowed paths, denied paths, approval mode, artifact retention, or memory
proposal authority.
Task-aware operator configs should name write routes by the work they are
allowed to perform, for example `frontend-approved-write`,
`backend-approved-write`, `research-approved-write`, or
`mechanical-approved-write`. Model capability evidence can rank a route, but it
must not silently turn every read-only model route into a writer.

Memory writes are proposals unless explicitly admitted through the memory write
profile. Artifact writes are represented through resource URIs. Large diffs,
provider transcripts, tool payloads, and generated artifacts are linked through
`kiln://` resources instead of being inlined into canonical events.

Canonical write evidence kinds include:

- `write-authority-denied`
- `write-proposal-created`
- `write-proposal-approved`
- `write-proposal-denied`
- `write-attempt-completed`
- `write-cleanup-pending`

Read-only invocations may record only `write-authority-denied` evidence. Any
accepted write proposal, approval, attempt, memory proposal, or retained
filesystem mutation in read-only mode is a boundary violation.

## Context And Credentials

Child context is admitted through the context governor. The child receives a
bounded context packet and audit evidence, not blind replay of the parent
conversation. Parent memory scope is not inherited implicitly.

Credential routing is explicit. A child invocation receives a credential route
identifier or a credentialless declaration. Secret values are not stored in
invocation records, session events, transcripts, diagnostics, or handoff
summaries.

## Runtime Adapters

Managed invocation is an adapter-neutral contract. Runtime routes may execute
through an external coding harness or through a Kiln-owned child runtime
session. Both route families reduce to the same managed invocation lifecycle,
authority decisions, evidence model, and parent session events.

The managed CLI harness adapter is the first runtime implementation. It creates
a provider session, streams provider-neutral CLI events, collects usage, records
terminal state, and converts write-related events into canonical evidence.

The adapter accepts live `file_changed` events, `write_decision` events, cost
updates, terminal events, and errors from CLI wrappers. It also supports a
filesystem boundary that snapshots tracked paths before execution and observes
retained changes afterward. If a read-only invocation modifies a tracked path,
Kiln restores the file when configured and records `write-authority-denied`
evidence.
For `foundation-apply-approved-writes`, the CLI harness session is created from
the admitted authority with workspace-write sandboxing and approval still
enabled. The adapter remains responsible for reducing provider-native file
changes and approval decisions into canonical write evidence.

Timeout and cancellation are terminal states, not evidence erasers. The adapter
keeps an in-progress evidence collector while a live session is running. If the
session times out after a bounded write event, the timeout record still includes
the observed write evidence and linked resource URIs. Provider errors containing
cancel or abort semantics map to the canonical `cancelled` lifecycle state.
Parent turns that contain terminal managed-child failures are recorded as failed
from either runtime ledger events or canonical tool-execution summaries, so GUI,
TUI, CLI, and replay consumers cannot report a blocked delegation as a completed
turn just because the failure was captured through a different surface.
Direct-provider children that exhaust their tool-round budget or fail their
bounded no-tool finalization are terminal failures, not successful empty
handoffs. Their transcript and child-execution resources remain replayable.
An explicit `managed_agent.cancel` call is different from a failed child
handoff: when cancellation reaches the canonical `cancelled` lifecycle and
terminal evidence is recorded, the cancel control result is accepted even
though the child result remains unavailable for comparison or phase evidence.
`managed_agent.join` follows the same observation rule for terminal children:
joining a `cancelled`, `timed_out`, `failed`, or `stale` child is a successful
lifecycle observation with explicit lifecycle/status metadata. Only `completed`
children are evaluated for substantive handoff evidence; terminal non-completed
children remain missing evidence for governed phases and comparisons.

The direct-provider adapter creates a child `RuntimeSessionOrchestrator` instead
of launching a CLI harness. It reuses the provider adapter contract, runtime
builtin tool execution, per-call tool allowlists, tool authority checks, context
admission, session accounting, and managed invocation record shape. It does not
reimplement file tools, memory tools, approval checks, or tool-call execution.
Direct-provider routes are eligible only when the provider supports model tool
calls and Kiln can enforce the configured authority through its own runtime tool
surface.

Direct-provider builtin tools execute with a request-scoped sandbox derived
from the admitted managed authority. Read-only routes can read inside the
managed working directory plus any explicit `readAuthority.workspace` reference
roots, cannot write, and cannot use network tools unless the request authority
admits network access. Write scopes remain separate: admitting a sibling
reference repository for read-only visual research does not grant mutation
authority for that repository.
Models may still hallucinate hidden or out-of-scope tool calls, but the runtime
allowlist and sandbox deny them before tool execution.
Direct-provider write-capable managed routes are available only when the direct
adapter descriptor advertises approved apply, rollback evidence, cleanup
evidence, scope reduction, and replayable write evidence support. Harness write
proof does not automatically transfer to direct providers.

Remote harness routes are endpoint-backed managed invocation adapters. They use
`kind: "harness"`, `surface: "remote-harness"`, and
`executionMode: "remote-harness"` under the same runtime service. A remote route
must declare explicit HTTPS invoke and cancel endpoints, portable auth-token
environment names, supported profiles, adapter limitations, and provider/model
proof source. Secrets are read at call time and never written to records,
transcripts, diagnostics, or handoff resources.

Remote harness execution is currently read-only. It admits
`foundation-readonly-plan` only and fails closed for write-required requests
until remote write, cleanup, and rollback evidence are canonical. Returned
records are validated against the admitted identity and capability snapshot:
agent id, route id, provider route, adapter kind, execution mode, authority,
and admitted capability fields must match. Remote cancellation is explicit. A
pre-start cancellation may complete locally, but in-flight cancellation becomes
a terminal failed record if the remote cancel endpoint rejects the notification.

Operator-surface authority (`auto`, `read_only`, `audited`, `destructive`) is a
per-turn admission request, not a route grant. GUI and TUI surfaces must display
the admitted authority returned by the runtime, including sandbox projection,
because a parent turn can be executable while every configured managed-agent
child route remains read-only.
Direct-provider timeout diagnostics are replayable even when the child runtime
does not complete. The terminal timeout handoff records the timeout budget,
child session id, child turn id, transcript resource, and timeout diagnostic
resource. It must not claim that all trace evidence is unavailable while also
returning a transcript pointer; instead it distinguishes missing completed child
handoff from replayable timeout evidence.
CLI-harness timeout handoffs follow the same diagnostic rule. A timeout summary
must name the admitted timeout budget and child session and must point operators
to transcript and timeout resources, instead of returning a bare "timed out"
string that hides where replay evidence lives.
Direct-provider timeouts are cancellation boundaries, not just `Promise.race`
wrappers. When the managed authority timeout expires, the runtime must abort the
child provider request through the shared provider adapter contract, stop retry
backoff, and suppress any late child output from becoming parent-visible
assistant text. Providers that cannot observe cancellation must be represented
as limited in route evidence rather than treated as equivalent to abortable
routes.
When the timed-out or failed child was executing an intermediate
`executionPhase` whose `completionTool` is `work_item.update`, the
`managed_agent.invoke` result must also carry `managedInvocationRecovery`.
That recovery envelope is the authoritative parent contract: collect the
missing evidence locally or through a retry route, call `work_item.update` with
the supplied template after replacing placeholders with real evidence, then
call `work_item.execution.start` again. A parent must not treat timeout prose,
local inspection, or a plan submission as recovery unless a later
`work_item.update` records the required phase evidence.
When the child completes the same intermediate phase successfully, the
`managed_agent.invoke` result must not collapse to a generic success string.
It must return a structured phase-completion envelope with the managed
`resultHandoff`, readable `sourceResourceUris`, the next governed tool
`work_item.update`, a complete `workItemUpdateInputTemplate`, and the follow-up
`work_item.execution.start` call. A completed child handoff is still not a
recorded work-governance phase until the parent records the phase evidence on
the same work item.
The phase-completion envelope is valid only when the handoff is substantive for
the expected evidence. A generic adapter summary such as "managed invocation
completed" is not evidence. For visual-reference phases, the handoff must point
to running-product UI captures when they exist, or to code-backed frontend
implementation evidence with source URLs and relevant frontend file paths when
public screenshots are unavailable. Otherwise the runtime projects
`handoff_not_substantive`, returns the same recovery contract as a failed
evidence phase, and blocks phase recording until the parent obtains real
frontend-reference evidence.

CLI configuration resolves direct-provider managed routes through the same
provider adapter factory used by native Kiln sessions. A direct route becomes
healthy only when the route names a direct provider, selects a tool-call-capable
model, the provider is available through the session registry, required
credentials can be resolved, and Kiln can attach the runtime builtin tool
surface for that operator surface. Harness routes and direct routes share the
same managed invocation admission and result contract; only their execution
adapter differs.

## Runtime Tool Surface

`managed_agent.invoke` is the runtime-owned model-callable entrypoint for parent
sessions that need a governed child invocation. It is not part of the core
developer-tool registry and is not exposed by default. Runtime operator surfaces
attach it only when the CLI provides a resolved managed invocation route
registry. That registry is normally derived from eligible ordered
`routing.routes`, with explicit `managedAgents.routes` merged on top for
authority-bearing routes, special read-only exceptions, or overrides. If no
ordered route exists, Kiln may synthesize the default read-only route from
enabled supported child engines. Direct-provider projections must name a
tool-call-capable model that can execute Kiln runtime tools; opaque provider
aliases that cannot be proven tool-capable remain unhealthy instead of being
exposed as child authority. When the same provider appears with multiple
models, derived route IDs include a model slug so parent sessions can select a
specific team member without relying on provider-only ambiguity. For
harness-backed child engines, route health includes the session-start engine
availability probe, the provider-advertised model catalog, and model-specific
live proof for the requested managed profile;
a configured child engine that is missing locally or names an unadvertised model
does not receive `managed_agent.invoke` authority.
Unhealthy configured routes are still carried as diagnostics so a failed tool
call can explain why the route is unavailable rather than pretending it was
never configured.
The model-facing route catalog includes each healthy route's timeout budget.
Parent agents should route broad repository review, long reasoning, or
multi-file analysis to a child route with enough admitted time, or split work
into smaller children and join them separately. The timeout budget remains
route authority; parent prompts do not silently extend it. The authority
profile records the effective timeout source as `default` or `explicit-route`
so GUI, TUI, CLI, replay, and model-facing diagnostics can distinguish a safe
synthesized default from an intentionally configured short or long route budget.
Request-local timeout source is not a valid managed invocation authority. Route
source is recorded separately as `routeSource`, so operators can tell whether a
route came from ordered routing, an explicit managed-agent route, a managed
default, or the enabled-engine fallback path without confusing provenance with
timeout budgeting.
GUI and TUI startup use a CLI-owned staged managed invocation route catalog.
The first catalog is built without blocking on child provider model discovery.
Routes whose provider model evidence is not known yet are exposed only as
unavailable diagnostics with explicit pending reasons, and `managed_agent.invoke`
has no executable route for them. After the operator surface is listening, the
CLI refreshes provider model evidence in the background and updates the same
managed invocation options object. This preserves cross-surface route identity
without introducing a surface-local managed-agent registry or compatibility
fallback.
The shared attachment point is `createAttachedRuntimeBuiltinToolSurface`, which
requires a managed invocation attachment rather than a bare route catalog. GUI,
TUI, operator gateway, CLI run, and benchmark executable sessions use the same
tool definition, authority projection, executor, route contract, and explicit
caller identity boundary instead of surface-specific implementations.
GUI and TUI recreate direct-provider executable sessions for each turn, but the
runtime session id used by managed invocation tools is the stable outer Kiln
session id. This keeps `managed_agent.status`, `managed_agent.list`,
`managed_agent.join`, and `managed_agent.cancel` scoped to the same operator
session across turns without adopting provider-native thread ids as lifecycle
authority.
Model-facing start, status, list, join, and cancel results expose the admitted
timeout budget (`timeoutMs`), timeout provenance (`timeoutSource`), and terminal
child lineage (`childSessionId`, `childTurnId`) when that evidence exists.
Those fields are duplicated in tool metadata and public JSON output so parent
agents, GUI/TUI replay, CLI inspection, and cockpit projections do not need to
parse provider prose or infer child identity from invocation ids.
The attached tool definition is generated from the resolved route registry. It
lists healthy and unavailable route ids, constrains model-facing provider ids to
configured routes, and instructs parent agents to treat failed or unavailable
children as missing evidence during comparisons. Surfaces must not add
surface-local managed-agent prompt rules that diverge from this generated tool
contract.

The model supplies a bounded task, a configured provider route, a requested
managed invocation profile, and optionally a child agent profile, child skills,
resource URIs, and context mode. The runtime maps that input to a
`ManagedAgentInvocationRequest` using configured route defaults for adapter,
execution mode, credential route, memory scope, timeout, working directory, and
authority. Requested agent profiles and skills are resolved by the host context
resolver and recorded as admitted context before execution. The model does not
provide arbitrary authority directly.
For write-capable profiles, route defaults include an explicit
`writeAuthority` object. Missing write authority, missing workspace
`allowedPaths`, incompatible workspace mode, disabled provider, unsupported
adapter family, or unproven write evidence support fails the route closed before
`managed_agent.invoke` can execute it.
When multiple routes share the same provider/profile, admission requires
`routeId`, an exact configured model match, or a configured agent-profile route
hint. Ambiguous provider-only selection fails closed instead of silently picking
the first route. If the parent supplies an `agentProfile` whose catalog entry
has a route hint, the runtime uses that hint to disambiguate the route. An
explicit `routeId`, provider id, or model that contradicts the selected
agent-profile hint fails closed before adapter invocation.
When `work_item.execution.start` emits a paused managed-delegation request with
a configured `routeId`, attached runtime surfaces hydrate the effective
`providerRoute` from the route catalog before calling `managed_agent.invoke`.
That request must not be reported as missing `providerRoute.providerId`; the
route id is the credential/provider ownership handle in that flow.
If a paused request also carries a stale or caller-supplied profile hint that is
not supported by the selected route, the exact `routeId` remains the stronger
identity signal. A single-profile route may replace the incompatible hint with
its configured profile and normalize `read_only` authority to audited authority
for write-capable routes. Multi-profile routes still fail closed when the route
cannot determine the intended authority profile.

The model-facing `managed_agent.invoke` schema is narrowed from the admitted
route and agent catalogs. `agentProfile` is limited to configured profile ids
and aliases; `skills` is limited to admitted skill names and is closed when no
skills are configured. Parent assistants may choose a configured child profile
without the operator naming one, but they must not invent profiles or skills.
If no configured profile matches a one-off read-only task, the parent omits
`agentProfile` and invokes a generic governed child.
Paused work-governance requests are authoritative tool input, not examples for
the parent to rewrite. A parent must call `managed_agent.invoke` with the exact
`managedInvocationRequest` returned by `work_item.execution.start`; if
`agentProfile` is absent, it stays absent. Attached runtime surfaces may add an
agent profile only when exactly one configured profile has an explicit route
hint matching the request route. That preserves fail-closed profile admission
while avoiding model-side guessing for route-owned intermediate phases.
The resolved agent catalog may include a route hint inferred from explicit
agent config or from route suitability and agent tier. Fast profiles such as
`scout` should bind to bounded read-only routes, for example a Mini or free
route, instead of a heavyweight synthesis route reserved for architecture or
research synthesis.

`agentProfile`, `skills`, and `contextMode: "fork"` fail closed when the active
surface has not configured a context resolver. `contextMode: "isolated"` is the
default. `contextMode: "resources"` admits only explicitly provided resources.
`contextMode: "fork"` is reserved for future policy-approved parent-context
forking and is rejected by the current CLI-owned resolver.

The tool is classified as approval-gated authority. A GUI/TUI/CLI parent turn
must pass the normal tool authority path before the child can be spawned. Once
approved, the tool calls `RuntimeManagedAgentInvocationService`, appends
`agent_invocation_requested`, `agent_invocation_started`, and terminal
`agent_invocation_*` events to the parent runtime session, streams those
canonical events through any configured `ManagedInvocationSessionEventSink`, and
returns only the bounded child result handoff plus resource pointers. A
nonblocking `managed_agent.start` registers a runtime terminal observer before
returning; if the background child finishes without a later join, cancel, or GUI
control, the observer appends and publishes the same canonical terminal event.
Later joins and cancels observe the existing terminal event instead of
synthesizing duplicates.

Operator follow-up prompts for active managed children are runtime-owned
session evidence. A surface submits them as managed-agent control input, the
gateway appends `agent_invocation_prompt_admitted`, and the runtime records the
same prompt in the invocation prompt inbox with a stable admission id, prompt
hash, delivery mode, delivery state, wake intent, operator identity, and request
source. `steer` prompts are claimable at the immediate or safe-turn boundary;
`queue` prompts are claimable only at a safe-turn boundary. Once claimed, a
prompt is marked `delivered` and is not replayed.

Stuck prompt delivery is also canonical state. Runtime recovery marks
nonterminal `available` or `queued` prompt admissions as `stale`, records the
recovery reason and timestamp, and emits `agent_invocation_prompt_recovered`
evidence for cockpit and transcript replay. Surfaces must not keep private
prompt queues, retry prompts silently, or infer prompt delivery from UI-local
state.

Plan mode excludes `managed_agent.invoke`; planning turns may inspect and submit
plans, but may not spawn managed child work.

## Surface Projection And Resources

Managed-agent operator surfaces are read/write clients of canonical runtime
state, not lifecycle owners. GUI, TUI, CLI, native, SDK, replay, and future
remote surfaces derive child state from `agent_invocation_*` session events,
managed invocation records, managed invocation tool-result metadata, and shared
gateway cockpit projection. They do not infer lifecycle state from free-form
provider prose or hold surface-local child registries. GUI and TUI transcript
writers persist canonical `agent_invocation_*` events through the managed
invocation session-event sink and a store-owned transcript sequence allocator,
so provider stream events and managed-child lifecycle events share one ordered
session transcript. Background children publish terminal events through the
start-registered runtime observer when they finish naturally. Out-of-band GUI
join and cancel controls publish the same terminal events through that sink only
when they are the first terminal observation.
Transcript replay prefers canonical `agent_invocation_*` events when present.
When a GUI or TUI transcript contains only partial canonical lifecycle evidence
or managed tool-completion evidence, replay projects the missing operator events
from managed invocation metadata and list snapshots so `kiln managed-agent
list/status/resources` remains consistent with the live operator cockpit. The
replay normalizer lives in `@kilnai/gateway-contracts`;
GUI, TUI, and CLI consumers feed that shared projection instead of carrying
surface-specific managed-agent parsers. Replay normalization is chronological
and idempotent for managed tool snapshots: repeated nonterminal list/status
evidence for the same child lifecycle state is collapsed, and stale nonterminal
snapshots after terminal evidence do not reopen the child. Terminal state
observed only through `managed_agent.list` is provisional replay evidence; a
later `managed_agent.join` or direct terminal tool result may enrich the same
terminal lifecycle with transcript, handoff, diagnostic, or resource evidence.
If canonical start evidence exists but the canonical terminal event is missing,
terminal managed-tool evidence still closes the invocation instead of being
suppressed by the earlier canonical event.

Surfaces should render `authoritySnapshot` and `progressEvents` as structured
evidence when present. `authoritySnapshot` is the cross-surface source of truth
for the admitted child authority, including explicit `writeAllowed` and
`networkAllowed` booleans. `progressEvents` is the cross-surface source of truth
for child tool activity observed before or after terminal join. A surface may
summarize or paginate these fields for usability, but it must preserve the
underlying runtime metadata for replay and operator inspection.

The shared cockpit projection carries active and terminal children, attention
state, stale heartbeat state, lifecycle timeline, route identity, dirty-worktree
review markers, cancellation availability, join replay state, adoption-gate
state, worktree-conflict evidence, denied context evidence, transcript links,
handoff links, diagnostics, resource bundles, child session lineage, and timeout
budget provenance. Surface-specific UI may choose layout and density, but it
must render the same contract fields.
Event sinks are fan-out ports. Adding a GUI, TUI, transcript, telemetry, or
streaming sink must not replace an existing sink, and a failure in one sink must
not prevent another sink from receiving the same canonical lifecycle events.

Managed invocation resources are read-only pointers under
`kiln://managed-agents/invocations`. They summarize lifecycle, transcript,
handoff, diagnostic, lease, conflict, adoption, and governed worktree-review
resources without becoming transcript storage. Transcript and large content
payloads are owned by the artifact resource store and read through
`resource_read`. GUI, TUI, CLI run, and benchmark executable sessions normalize
managed invocation options to one runtime-owned invocation service before
creating their managed invocation attachment and attaching the managed
invocation resource provider; surfaces do not maintain private resource
registries for child lifecycle state.

Adapter-native `kiln://managed-invocations/...` pointers are private adapter
evidence, not public resource-plane contracts. Runtime finalization and the
managed invocation resource provider project those pointers before records leave
the managed invocation boundary. Transcript and handoff evidence become
`kiln://managed-agents/invocations/{invocationId}/transcript` and
`kiln://managed-agents/invocations/{invocationId}/handoff`; diagnostics, write
evidence, approval evidence, and other adapter resources become
`kiln://managed-agents/invocations/{invocationId}/resources/{resourcePath}`.
The public transcript URI reads as a bounded `text/markdown` managed invocation
transcript body built from the invocation record; it is not a JSON pointer
shim. Raw transcript payloads and large evidence remain artifact-backed content
owned by the resource plane.
Direct-provider result handoff follows the same split. `resultHandoff.summary`
is intentionally bounded for model/tool/session flow. When the child's final
text exceeds that bounded handoff, the invocation record stores the full final
result as a replay resource such as
`kiln://managed-agents/invocations/{invocationId}/resources/result/final`.
The handoff links that resource, but terminal session events, managed tool
metadata, and cockpit summaries keep only the bounded summary plus resource URI.
When an artifact resource store is attached, large transcript or evidence
payloads are persisted as session-scoped artifacts and exposed as
`kiln://artifacts/managed-invocations/{artifactId}/content`. GUI, TUI, CLI,
SDK, replay, and model-facing `resource_read` output must not expose the private
adapter scheme, and direct reads of that scheme are not supported.

Artifact-backed transcript and result resources must be readable page by page
through the shared resource plane. `resource_read` accepts `cursor` and `limit`,
returns one bounded page, exposes `nextCursor` when more content exists, and
adds `_meta.range` with unit, offset, limit, returned count, total count, and
truncation status. The model-visible `resource_read` output also includes the
same range and optional `nextCursor` in its trailing control block, so parent
agents can continue pages using the exact opaque cursor. Text and JSON content
page by line; blob content pages by decoded byte. Invalid, stale,
URI-mismatched, or out-of-range cursors fail closed.

Managed children invoked with `contextMode: "resources"` use one runtime-owned
resource-context builder across direct-provider and CLI-harness adapters. When
a resource reader is attached, admitted URIs are hydrated through the shared
`resource_read` plane before the child prompt is sent. This hydration is
context construction, not ambient child authority: the child tool allowlist is
still the selected authority profile, and `resource_read` is not exposed to the
child unless that profile explicitly allows it. Direct-provider and CLI-harness
routes resolve this reader from the current session-scoped builtin tool surface
at invocation time, so GUI, TUI, CLI, and gateway-managed children see the same
live resource plane after managed invocation resources are attached. If a
surface lacks a resource reader, the governed context falls back to the admitted
resource URI list rather than silently granting filesystem or private adapter
access.
Because `contextMode: "resources"` hydrates parent-admitted resources before
child execution, parent agents must not add `resource_read` to
`requiredToolNames` merely to read those resources. `requiredToolNames` names
tools that the child route itself must be allowed to call after admission.

## Live Adapter Evidence

Live adapter support is opt-in and must be proven per provider family and
profile. A provider is healthy for `foundation-readonly-plan` only after it can
produce a substantive read-only result handoff. Write denial and approved-write
fixture proofs prove write-evidence capture, but they do not by themselves prove
read-only analysis handoff quality.

Current status:

| Provider family | Status | Contract treatment |
| --- | --- | --- |
| OpenCode harness | Live-proven for cancellation under `opencode/minimax-m2.5-free`; write-denial and approved bounded-write evidence require the separately gated write-capable model proof. Read-only analysis handoff is admitted only for `opencode/minimax-m2.5-free`. | OpenCode permission and session diff events reduce to `write_decision` and `file_changed`. Other OpenCode models stay unhealthy for `foundation-readonly-plan` until that model has substantive result-handoff proof. Write evidence is never synthesized from prompt intent when a model completes without attempting or applying a write. |
| Codex harness | Live-proven for read-only no-accepted-write and approved bounded write. | Codex file-change and patch-approval output reduce to canonical write evidence. |
| Claude Code family | Scouted, not live-proven in Kiln. | Permission modes and tool names are adapter research only. |
| Hermes Agent | Scouted as ACP-style future adapter candidate. | `delegate_task`, ACP permission, and terminal concepts are adapter inputs only. |
| OpenClaw | Scouted as future harness or ACP adapter candidate. | Session, subagent, and tool-policy names are not Kiln contract fields. |
| Direct subscription providers (`codex-oauth`, `opencode-go`, `opencode-zen`) | Runtime adapter supports explicit approved-write managed routes when the route declares `writeAuthority`. | Direct providers execute through Kiln builtin tool authority, working-directory sandbox, and `toolExecutions.fileChanges` reduced to canonical write evidence. |
| Other direct API providers | Child runtime-session adapter exists with deterministic builtin tool sandbox proof; provider-family live proof remains separate. | Direct providers execute through Kiln builtin tool authority, working-directory sandbox, and evidence boundaries. |

Live tests are disabled by default. They require
`KILN_LIVE_MANAGED_AGENT_TESTS=1` plus provider-specific flags such as
`KILN_LIVE_OPENCODE_TESTS=1`, `KILN_LIVE_CODEX_TESTS=1`,
`KILN_LIVE_OPENAI_DIRECT_TESTS=1`, or
`KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS=1`. OpenCode write-denial and
approved-write proofs additionally require
`KILN_LIVE_OPENCODE_WRITE_PROOF_TESTS=1` and an explicit
`KILN_LIVE_OPENCODE_MODEL` with proven native write behavior; the write-proof
tests fail fast when that model is omitted. OpenAI direct
live proof uses
`KILN_LIVE_OPENAI_DIRECT_MODEL` when set and otherwise defaults to
`gpt-4o-mini`; Codex OAuth subscription direct live proof uses
`KILN_LIVE_CODEX_OAUTH_DIRECT_MODEL` when set and otherwise defaults to
`gpt-5.5`. Live tests must use isolated fixture workspaces, bounded tracked
paths, read-only denial cases, approved-write positive cases, cleanup, and
replay assertions.

## Session Events And Replay

Managed invocation state projects into canonical session events:

- `agent_invocation_requested`
- `agent_invocation_started`
- `agent_invocation_completed`
- `agent_invocation_failed`
- `agent_invocation_cancelled`

Every managed invocation event carries the same visible invocation identity:
`invocationId`, `agentId`, `profile`, effective `providerRoute`, `adapterKind`,
`executionMode`, `authorityProfileId`, parent session lineage, requester, and
request source when known. `providerRoute.model` is the effective child model
after configured route defaults and runtime execution-profile resolution, not
only a model override supplied by the parent assistant. Operator surfaces must
render that identity as structured evidence, for example
`foundation-readonly-plan via codex-oauth/gpt-5.4-mini`, rather than only
showing the tool name.

Terminal events additionally carry managed invocation evidence: child lineage,
transcript pointer, diagnostics, usage, result handoff, write authority, and
write evidence. GUI, TUI, CLI, SDK, and future operator surfaces must derive
managed invocation state from these canonical events rather than maintaining
local managed-agent state.
For nonblocking children, terminal session-event persistence is owned by the
runtime service lifecycle through an explicit terminal observer. The observer is
registered by `managed_agent.start`, fires once after terminal finalization, and
does not depend on the parent later calling `managed_agent.join` or an operator
control. `managed_agent.join` and `managed_agent.cancel` still return terminal
metadata and session-event ids, but they reuse existing terminal events when the
background observer already recorded them. If startup terminalizes after a
runtime-owned side effect, such as a lease acquisition that must be cleaned up,
`managed_agent.start` records the requested, started, and failed events with the
same canonical path instead of leaving the failure as an unpersisted thrown
startup error.

When a managed invocation is used to satisfy a governed work item, the parent
work item records the child handoff through `work_item.execution.start` by
storing the `managedInvocationId` on the execution attempt. The same attempt is
projected through `work_item_execution_started` and
`work_item_execution_finished` events and through
`kiln://session/work-items`, so replay and operator surfaces can connect child
evidence to the parent work item without parsing prose. A started attempt is
still open work: until `work_item.execution.finish` or `work_item.complete`
records terminal evidence, the parent turn is projected as failed/blocked
rather than completed.
Similarly, a successful read-only `managed_agent.invoke` scout does not close
the parent work item by itself. Execute-mode parent turns receive runtime
closeout guidance that requires them to continue on the same work item after the
child handoff, either by starting/finishing/completing the item or by recording a
concrete pause requirement.
If the managed child fails before the work-item attempt can start, or the
managed invocation request cannot be hydrated to a configured route/provider,
the runtime returns the work item to an explicit paused result. The result
metadata records `operation=managed_invocation_failed`,
`managedInvocationAutoStarted=false`, the failure reason, and the managed
invocation metadata so downstream surfaces can show that the child was
attempted and no parent attempt was started. The parent session turn is also
recorded with failed outcome, which prevents GUI, TUI, CLI, and replay surfaces
from treating a delegation timeout or route failure as a completed assistant
turn. Intermediate evidence phases are not auto-started by
`work_item.execution.start`; the pause envelope keeps the hydrated
`managed_agent.invoke` request visible so the parent explicitly starts the child
and owns any timeout or local recovery decision. This expected pause is a
successful actionable handoff, not a tool error; true route, provider, child, or
recovery failures still return failed metadata. Before exposing the paused
request, attached runtime surfaces verify that the selected route can provide
the phase `requiredToolNames`. If the requested phase route lacks required
tools and exactly one compatible read-only route exists, the request is repaired
with structured `managedInvocationRouteRepair` metadata; otherwise the runtime
fails closed rather than handing the parent an impossible child request. If a
managed child failure later returns recovery guidance, the envelope includes a complete
`workItemUpdateInputTemplate`, including the required work item summary,
evidence-to-record, and phase-specific verification gate placeholders. Parent
agents must execute that tool call only after local recovery evidence is
actually collected; prose that describes the template is not recovery.
The same fail-closed rule applies to successful intermediate children. A
`managed_agent.invoke` result carrying `managedInvocationPhaseCompletion` or
`phaseCompletion` is unresolved until a later successful `work_item.update`
records every required evidence label on the same work item. Printing the
template, `providedEvidence`, or `verificationGateResults` as assistant text is
not a tool call and must not be treated as phase completion.

Assistant egress text must not expose provider-internal tool-call markup. If a
direct provider returns raw assistant tool syntax such as `<assistant to=...>`
or bare targets such as `to=functions.web_fetch` plus JSON arguments in normal
text, the runtime strips that markup before persisting `assistant_message`
events or returning text to GUI, TUI, CLI, SDK, or replay consumers. Canonical
tool results and transcript resources remain the evidence plane for tool
activity. The same egress boundary strips short leading scratchpad-style
prefixes that expose internal planning notes instead of operator-facing
content and leading `work_item.update` JSON payloads that a model accidentally
emits as prose; reasoning traces and scratch work must remain internal provider
state, while canonical events carry replayable evidence.

`managed_agent.invoke` tool results also emit a validated presentation intent
for operator-facing route evidence. The first supported intent is a
`comparison_table` row containing route id, provider, model, profile, context
mode, terminal status, substantive-evidence flag, and failure reason when
present. This table is presentation evidence only; canonical lifecycle state
remains the managed invocation record and `agent_invocation_*` events. Surfaces
render the same validated intent natively or through deterministic text fallback
instead of parsing markdown tables from the parent assistant response.

The model-facing tool description also carries advisory task suitability for
healthy managed routes when the selected provider/model has capability
evidence. The suitability view combines static profile knowledge, first-party
evaluation evidence, live route proof, operator overrides, and configured skill
recommendations in one bounded record shape. Parent agents may use this to
prefer, for example, a coding route for bounded backend work or a reasoning
route for architecture review. Suitability is not authority: unavailable
routes, unhealthy provider/model pairs, unknown agent profiles, missing skills,
or denied authority profiles still fail closed. Recommended skills are shown to
the parent only when they are also present in the admitted skill catalog or on a
configured agent profile.
Agent-profile route hints are selection constraints, not authority grants. They
can narrow a healthy route choice for the selected role, but they cannot make an
unhealthy route available, broaden authority, admit missing skills, or bypass
the managed invocation profile.
Requested authority must also match the selected managed profile. A read-only
profile cannot be elevated to audited or destructive authority by request text
or approval flow; the parent must select an admitted write-capable profile and
route instead.
If `skills.selection.mode: auto` is configured, CLI-owned managed invocation
may admit recommended skills for the selected route/task without requiring the
parent model to repeat them in the tool call. This is still admission, not
ambient context: only configured skills can be loaded, explicitly requested
missing skills fail closed, and the invocation context records admitted skills.

Managed invocation also accepts an explicit `workClassification` with
cross-domain intent, artifact, domain, effect, and interaction-mode facets.
This classification is diagnostic and advisory: it can contribute configured
skill recommendations, but it cannot select a route, grant a tool, widen
filesystem or network authority, or bypass profile admission. Unknown explicit
facet values fail closed before the context resolver or child adapter runs.
The canonical invocation context preserves the requested classification, the
resolved classification, work-recommended skill ids, and per-skill diagnostic
state so every operator surface can explain the admission decision without
reclassifying prompt text. A diagnostic state of `admitted` means the skill was
loaded as governed context; `advisory` means the recommendation was recorded
without loading because auto selection is disabled; `unavailable` means the
skill is absent from the governed registry and must not be silently imported
from native harness-local directories.

Replay must reconstruct terminal state, authority, result handoff, and write
evidence after session serialization. Transcript and result handoff URIs emitted
by managed invocation records must be readable through the shared `resource_read`
tool. Runtime may back those URIs with session-scoped artifacts, but it must not
announce resource links that the active resource plane cannot resolve.
Artifact-linked diff evidence must survive reload through resource URIs. Raw
provider diffs, full transcripts, and provider-native event payloads are not
session-event state.

## Result Handoff

The child returns a bounded summary and resource pointers. The parent receives
stable handoff references, not raw child context, raw tool logs, or unbounded
diffs. Child memory writes become proposals unless a profile explicitly admits
memory proposal authority.
Full child output that does not fit in the bounded handoff is replay evidence,
not session-event state. It is stored on the invocation record as a replay
resource and exposed through the same managed-agent or artifact resource plane
as transcript, diagnostic, and write evidence. Parents that need the full tail
must call `resource_read` on the linked resource instead of relying on clipped
assistant prose.

A terminal `completed` state requires a substantive result handoff. For
read-only harness invocations, a provider process that exits successfully
without non-thinking text is a failed managed invocation, not a successful empty
review. Write-capable profiles may complete without text only when canonical
write evidence provides the substantive handoff. This keeps parent agents,
operators, replay, and future SDK surfaces from treating an empty child run as
usable work.

## Verification

The canonical deterministic verification set includes:

```bash
cmd.exe /d /s /c "cd /d C:\workspace\kiln && bun run typecheck"
cmd.exe /d /s /c "cd /d C:\workspace\kiln && bun run test"
```

Focused managed invocation checks live under:

- `packages/core/tests/managed-agent/`
- `packages/runtime/tests/managed-agent/`
- `packages/runtime/tests/session/managed-invocation-session-events.test.ts`
- `packages/runtime/tests/session/session-serializer.test.ts`
- `packages/cli/tests/wrapper/codex-session.test.ts`
- `packages/cli/tests/wrapper/opencode-session.test.ts`

Deterministic cross-surface harness coverage uses package-owned Vitest
configuration and excludes live provider suites:

```bash
cmd.exe /d /s /c "cd /d C:\workspace\kiln && bun run test:harness"
```

Opt-in live checks use:

```bash
cmd.exe /d /s /c "cd /d C:\workspace\kiln && bun run test:managed-agents:live"
```

Provider-specific live checks can be enabled explicitly with
`KILN_LIVE_MANAGED_AGENT_TESTS=1` plus at least one provider-specific
`KILN_LIVE_*` flag. The root live command also detects authenticated local
Codex and OpenCode harnesses and sets those live flags for the Vitest child
process. `KILN_LIVE_MANAGED_AGENT_TESTS=0` remains an explicit disable. The
root live command fails when no explicit or detected live provider is admitted,
because an all-skipped live suite is missing evidence rather than a successful
proof. Live provider checks must never run as part of normal deterministic CI.
