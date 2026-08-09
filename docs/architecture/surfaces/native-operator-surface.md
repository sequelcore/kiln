# Native Operator Surface

Status: the native operator surface foundation is complete as of 2026-05-15
with defer/no-promotion closeout. The foundation delivered
target/precondition/benchmark-fixture contracts, shared
projection baselines, cancellation-target contracts, shared read-only operator
projection, native read-only projection and action-intent wrappers, read-only
attach-plan contracts, target-aware resource-link projection, and shared/native
read-only view-state helpers plus baseline measurement. Typed Phase 3 evidence
contracts exist, but no measured browser/native rendering evidence exists. No
native operator surface UI, network attach loop, browser-rendering benchmark runner,
resource-opening dispatch, cancellation dispatch, or dispatch path is promoted.
Any live Phase 3 benchmark runner, native operator surface, attach-loop, or dispatch
requires a new dedicated native-surface validation roadmap or ADR.
Roadmap 01 started on 2026-05-15 for the native operator surface. Its current
phase covers runner admission plus orchestration planning contracts only, with
execution still `not-started`.
Rust/WASM/sidecar optimization is separate from the native surface track.
Roadmap 0.0.1 defines that Bun/TypeScript owns control-plane semantics and Rust
enters only through governed hot-path/helper ports after parity and measured
advantage are proven.

## Purpose

The native operator surface is a possible future power-user projection for high-density
Kiln supervision. It may render many sessions, child invocations, timelines,
tool summaries, resource links, provider/cost summaries, and authority status
from canonical gateway events.

It is not a runtime, scheduler, editor, provider router, authority resolver,
memory policy engine, config resolver, or packaging/distribution track.

## Package Boundary

The native-specific contract lives in `@kilnai/native` because the experiment
belongs to the native operator surface. The current native contract
implementation is `packages/native/src/shared/native-cockpit-contract.ts`.

Shared target, benchmark, and read-only projection contracts live in
`@kilnai/gateway-contracts` so GUI, native, TUI, SDK, and future surfaces can
consume the same canonical event projections instead of maintaining private
operator surface models.

Issue #34 does not promote or wire the native surface. Its economic lifecycle
evidence is rendered only by the active CLI, TUI, and GUI session-event
surfaces, with SDK contract-export parity. Native remains an explicitly
excluded consumer until a dedicated native-surface roadmap or ADR admits
implementation and validation.

The native package may define native-specific readiness and shell contracts. It
must not import `@kilnai/core` or `@kilnai/runtime` implementation modules.
Runtime facts must arrive through gateway/operator contracts or shared
operator-facing contract packages.

`packages/native/src/shared/native-cockpit-contract.ts` may wrap the shared
gateway projection to add native surface metadata such as `surfaceId`,
`surfaceMode`, and disabled mutation dispatch. It must not fork session,
timeline, invocation, tool, cost, provider, authority, or target projection
logic.

The native package may also wrap the shared read-only attach plan to add
surface metadata and `networkAttach: not-started`. The attach plan is still a
contract and validation artifact. It does not open HTTP, WebSocket, IPC, or
native process connections.

## Phase Gate

The native operator surface foundation started in contract-only mode.

The contract phase may begin when:

- high-density workloads exist as real or synthetic fixtures
- config projection is stable enough for explicit local, cloud, team, CI, and
  simulated targets
- gateway event streams expose canonical session facts
- managed-invocation lifecycle events are available
- authority and provider-route projections are available

The read-only prototype may begin only after the contract phase is satisfied
and shared GUI projection baselines plus gateway-mediated cancellation target
semantics are available.

## Target Contract

Every operator surface action must carry an explicit target. Local UI focus is not
runtime authority.

Required target rules:

- every action requires `instanceId`
- session actions require `sessionId`
- replay actions require `sessionId` and `eventId`
- resource-opening actions require `resourceUri`
- cancellation requires `sessionId` plus `workItemId` or
  `managedInvocationId`

No dashboard action may infer target from row position, visual focus, selected
tab, or local window state.

Cancellation is represented as a gateway-mediated request contract. The shared
contract validates `instanceId`, `sessionId`, and either `workItemId` or
`managedInvocationId` before any future surface can ask runtime to cancel
work. The current contract does not dispatch cancellation.

Read-only action intents are available for target-checked planning only:

- inspect
- replay
- focus session
- filter events
- open resource

They return `dispatch: not-dispatched` and reject cancellation. This lets
surfaces wire focus, replay cursor, filtering, and resource-opening affordances
against explicit targets before any mutating gateway action exists.

## Read-Only Projection

The first Phase 2 substrate is a shared read-only operator surface projection over
canonical `OperatorSessionEvent` records.

The first attach substrate is a shared read-only attach plan over explicit
`OperatorCockpitAttachTarget` records. It validates target identity, labels,
supported target kinds, duplicate targets, and `http://` or `https://`
gateway URLs before any local or simulated remote target can be projected. The
plan records `connectionState: planned`, `mutationDispatch: disabled`, and the
intended HTTP/WebSocket transport only. It does not open sockets or start a
gateway attach loop.

`packages/gateway-contracts/src/operator-cockpit-projection.ts` groups events
by explicit attach target and session, then emits:

- instance summaries
- session summaries
- timeline entries
- managed-invocation summaries
- tool-call summaries
- economic attempt summaries
- target-aware resource links
- cost and provider-route summaries
- unprojectable evidence

Every projected row preserves an `OperatorCockpitActionTarget` with at least
`instanceId` and the relevant `sessionId`, `eventId`, or
`managedInvocationId`.

The projection is total: every ingested event either contributes evidence or
contributes a named rejection. It recognizes three dispositions and only the
middle one is recorded in `unprojectableEvidence`:

- **unplaceable** - no usable instance identity, or an unattached instance. The
  whole projection is untrustworthy, so it throws.
- **rejected** - placeable, declares a recognized kind, then violates that
  kind's own contract. Recorded as an `OperatorCockpitEvidenceRejection`.
- **not applicable** - carries no evidence of a given class, or is of a kind
  this projection does not fold. Ignored by design; not a rejection.

A rejection carries `eventId`, `sequence`, `kind`, `reason`, and the offending
field's *name*. It never carries the offending value, because the rejection is
projected to every operator surface. Absence of an optional field is not a
rejection; a supplied field that violates its contract is, including when the
parent treats that field as optional.

A non-empty `unprojectableEvidence` means the view is degraded, and CLI, TUI,
and GUI must all say so. A cockpit that silently under-reports reads as a
complete one, which is the failure this contract exists to prevent.

Tool resource links emitted through the shared operator-event presenter are
projected into timeline and tool-summary resources with `resourceUri` encoded
in the target. This is still read-only planning data. Surfaces may render
resource affordances from it, but opening a resource remains a separate
target-checked intent and is not dispatched by this projection.

Projection fails closed when an event references an instance that is not in the
attach target list. This prevents local, remote, team, cloud, CI, and simulated
remote events from collapsing into hidden global state.

This projection is still not a native prototype. It does not open sockets,
attach to gateways, dispatch cancellation, schedule work, resolve authority,
read config, read memory, route providers, or render a native operator UI.

The native wrapper exposes the same read-only view as
`runtimeBoundary: gateway-contracts` with `mutationDispatch: disabled`. This
lets the native surface prove it can consume canonical operator surface projections
without introducing native-owned runtime truth or private dispatch behavior.

The shared read-only view-state helper consumes the existing shared projection
and returns target-validated focus/filter/replay selections with explicit
`dispatch: not-dispatched` and `mutationDispatch: disabled` metadata. Unknown
focus, filter, and replay targets fail closed. Timeline filters use projected
targets, including `managedInvocationId`, `toolCallId`, and `resourceUri`,
instead of parsing raw event payloads. Session, managed-invocation, and
tool-call filters require their enclosing instance/session target so
multi-instance dashboards cannot merge same-named ids across scopes.

The native action-intent wrapper follows the same rule. It adds `surfaceId`
metadata and keeps `mutationDispatch: disabled`; it does not send HTTP,
WebSocket, IPC, or native process commands.

## Benchmark Fixtures

Promotion requires shared fixture definitions before UI claims are made.

Required fixtures:

- single-session heavy workload: at least one session, 50 child invocations,
  and 100,000 lifecycle events
- multi-session workload: at least 10 sessions, three active managed-agent
  sessions, 50 child invocations, and 100,000 total lifecycle events
- multi-instance workload: at least two explicit instances with no implicit
  cross-instance mutation
- projection hot path: at least 100,000 canonical events with stable shared
  TypeScript output that surface benchmarks and later optimization tracks can
  reuse

Benchmarks must compare the web GUI and native surface on equivalent canonical
event fixtures before promotion. The current baseline measures the shared
operator-event presentation path consumed by GUI; it is a projection baseline,
not a browser-rendering benchmark. The current read-only operator surface baseline
measures `projectOperatorCockpitReadOnlyView` over explicit attach targets and
reports instance, session, timeline, invocation, tool, cost, provider-route,
and target summaries. Later GUI/native rendering benchmarks must compare
against that shared TypeScript output instead of inventing a private projection
model.
The view-state baseline measures only
`createOperatorCockpitReadOnlyViewState` after the shared projection is built;
it is not a rendering benchmark, network benchmark, or dispatch benchmark.
The benchmark evidence gate is also shared:
`createOperatorCockpitBenchmarkEvidenceReport` lives in
`@kilnai/gateway-contracts` and is consumed by native directly. This slice does
not add a native wrapper for that report.
Phase 3 evidence inputs are typed audit contracts (browser/native rendering,
target clarity, interaction latency, memory) with explicit measurement metadata
and completion flags. They do not execute benchmarks or replace real runner
proof.
Phase 3 Slice 1 adds typed runner admission over `web-gui` and
`native-cockpit` surfaces plus browser/native runner kinds and workload
thresholds. Admission is fail-closed and keeps mutation dispatch and network
attach disabled.
Phase 3 Slice 2 adds typed orchestration planning over admitted web/native
runner admissions. Planning is fail-closed when either admission is blocked or
when workload/fixture coherence is missing, and it keeps execution
`not-started`, mutation dispatch `disabled`, network attach `not-started`, and
recommendation/evidence `not-promoted`.
Phase 3 execution is still blocked until real benchmark runners produce measured
browser/native rendering evidence on approved workloads.

## Relationship To Rust Optimization

The native operator surface and Rust optimization are separate tracks.

The native surface track proves that an Electron-backed operator surface can
consume gateway contracts, render high-density supervision data, preserve
target clarity, and avoid private runtime truth. It can use shared TypeScript
projection baselines as benchmark input, but it does not require Rust.

The Rust optimization track may later accelerate selected modules such as event
presentation, read-only operator surface projection, replay indexes, or summary
hot paths. That work is governed by Roadmap 0.0.1 and must enter through a
future approved TypeScript-owned port. Rust must consume canonical
`@kilnai/gateway-contracts` input, return canonical contract-shaped output,
preserve fail-closed fallback behavior, and avoid authority, routing, policy,
memory, config, dispatch, or surface ownership.

Native surface evidence can inform Rust target selection, but it must not make
Rust a prerequisite for native operator surface UI or attach-loop work.

## Current Status

Implemented:

- native operator surface precondition review contract
- explicit target/action admission helper
- benchmark fixture threshold definitions
- shared synthetic high-density event fixture generator
- shared GUI projection baseline measurement
- shared read-only operator surface projection baseline measurement
- shared read-only attach plan for local and simulated remote gateway targets
- target-aware read-only resource-link projection from canonical tool events
- gateway-mediated cancellation request schema
- shared read-only operator surface projection over canonical events and explicit attach
  targets
- native read-only operator surface projection wrapper over the shared gateway contract
- shared and native read-only operator surface action intents with no dispatch
- shared TypeScript read-only operator surface view-state baseline measurement
- native read-only operator surface view-state baseline wrapper metadata
- shared benchmark evidence report and promotion gate contract (consumed
  directly by native without a wrapper)
- native boundary tests proving the contract fails closed

Not implemented:

- live benchmark runner execution for browser/native rendering
- live local or remote gateway attach loop
- multi-session native operator UI
- multi-instance dashboard UI
- cancellation dispatch
- resource-opening dispatch
- browser rendering benchmark runner
- benchmark evidence report wrappers outside shared gateway contracts
- Rust/WASM/sidecar projection kernel; this belongs to the separate Rust
  optimization track
- Rust parity/readiness contracts or native wrappers; these belong to a future
  approved Rust optimization slice, not the native surface track
- native packaging/distribution
