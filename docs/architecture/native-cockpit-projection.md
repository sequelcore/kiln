# Native Cockpit Projection

Status: early read-only projection architecture. Roadmap 05 has target,
precondition, benchmark-fixture, shared projection-baseline,
cancellation-target, shared read-only cockpit projection, and native
read-only projection wrapper/action-intent contracts. No native cockpit UI,
network attach loop, cancellation dispatch, or Rust projection kernel is
promoted.

## Purpose

The native cockpit is a possible future power-user projection for high-density
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
cockpit models.

The native package may define native-specific readiness and shell contracts. It
must not import `@kilnai/core` or `@kilnai/runtime` implementation modules.
Runtime facts must arrive through gateway/operator contracts or shared
operator-facing contract packages.

`packages/native/src/shared/native-cockpit-contract.ts` may wrap the shared
gateway projection to add native surface metadata such as `surfaceId`,
`surfaceMode`, and disabled mutation dispatch. It must not fork session,
timeline, invocation, tool, cost, provider, authority, or target projection
logic.

## Phase Gate

Roadmap 05 starts in contract-only mode.

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

Every cockpit action must carry an explicit target. Local UI focus is not
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

The first Phase 2 substrate is a shared read-only cockpit projection over
canonical `OperatorSessionEvent` records.

`packages/gateway-contracts/src/operator-cockpit-projection.ts` groups events
by explicit attach target and session, then emits:

- instance summaries
- session summaries
- timeline entries
- managed-invocation summaries
- tool-call summaries
- cost and provider-route summaries

Every projected row preserves an `OperatorCockpitActionTarget` with at least
`instanceId` and the relevant `sessionId`, `eventId`, or
`managedInvocationId`.

Projection fails closed when an event references an instance that is not in the
attach target list. This prevents local, remote, team, cloud, CI, and simulated
remote events from collapsing into hidden global state.

This projection is still not a native prototype. It does not open sockets,
attach to gateways, dispatch cancellation, schedule work, resolve authority,
read config, read memory, route providers, or render a cockpit UI.

The native wrapper exposes the same read-only view as
`runtimeBoundary: gateway-contracts` with `mutationDispatch: disabled`. This
lets the native surface prove it can consume canonical cockpit projections
without introducing native-owned runtime truth or private dispatch behavior.

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
- projection hot path: at least 100,000 canonical events with identical output
  between TypeScript and any Rust/WASM/sidecar candidate

Benchmarks must compare the web GUI and native surface on equivalent canonical
event fixtures before promotion. The current baseline measures the shared
operator-event presentation path consumed by GUI; it is a projection baseline,
not a browser-rendering benchmark.

## Rust Boundary

Rust, WASM, or sidecars may accelerate projection/replay hot paths only after a
measured bottleneck exists. They may produce timeline projections, invocation
trees, session summaries, replay cursor maps, and cost/provider summaries.

They must not produce authority decisions, routing decisions, tool admission
decisions, memory mutation decisions, goal/work-item lifecycle decisions,
provider credential decisions, tenant policy decisions, or closeout decisions.

## Current Status

Implemented:

- native cockpit precondition review contract
- explicit target/action admission helper
- benchmark fixture threshold definitions
- shared synthetic high-density event fixture generator
- shared GUI projection baseline measurement
- gateway-mediated cancellation request schema
- shared read-only cockpit projection over canonical events and explicit attach
  targets
- native read-only cockpit projection wrapper over the shared gateway contract
- shared and native read-only cockpit action intents with no dispatch
- native boundary tests proving the contract fails closed

Not implemented:

- local or remote attach prototype
- multi-session cockpit UI
- multi-instance dashboard UI
- cancellation dispatch
- browser rendering benchmark runner
- Rust/WASM/sidecar projection kernel
- native packaging/distribution
