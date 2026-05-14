# Native Cockpit Projection

Status: contract-only architecture. Roadmap 05 has target, precondition,
benchmark-fixture, shared projection-baseline, and cancellation-target
contracts. No native cockpit prototype, cancellation dispatch, or Rust
projection kernel is promoted.

## Purpose

The native cockpit is a possible future power-user projection for high-density
Kiln supervision. It may render many sessions, child invocations, timelines,
tool summaries, resource links, provider/cost summaries, and authority status
from canonical gateway events.

It is not a runtime, scheduler, editor, provider router, authority resolver,
memory policy engine, config resolver, or packaging/distribution track.

## Package Boundary

The contract lives in `@kilnai/native` because the experiment belongs to the
native operator surface. The current implementation is
`packages/native/src/shared/native-cockpit-contract.ts`.

The native package may define projection, target, and benchmark contracts. It
must not import `@kilnai/core` or `@kilnai/runtime` implementation modules.
Runtime facts must arrive through gateway/operator contracts or shared
operator-facing contract packages.

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
- native boundary tests proving the contract fails closed

Not implemented:

- local or remote attach prototype
- multi-session cockpit UI
- multi-instance dashboard UI
- cancellation dispatch
- browser rendering benchmark runner
- Rust/WASM/sidecar projection kernel
- native packaging/distribution
