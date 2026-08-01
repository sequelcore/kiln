# Engineering Standards

This document is the canonical engineering standard for Kiln implementation
work. Agent instructions such as `CLAUDE.md` or local `AGENTS.md` may summarize
or point here, but architectural and coding doctrine belongs in
`docs/architecture/`.

## Source Of Truth

- Architecture doctrine lives in `docs/architecture/`.
- Guides explain usage; they do not create doctrine.
- Research explains rationale; it does not override contracts.
- Agent instruction files are operational entrypoints; they should not become
  the only place where durable engineering rules exist.

## Consumer Surface

The `@kilnai/*` packages are published, but Kiln has no external consumers. The
operator is the only one, confirmed 2026-08-01. Publication is distribution, not
a compatibility obligation.

This is a load-bearing fact, not a footnote. The standing rule against
compatibility paths "without real consumers" therefore applies at full strength
everywhere in this repository:

- Replace a contract outright instead of adding a compatible variant beside it.
- Rename and change public types freely. Delete the old path in the same change.
- Do not propose deprecation windows, `@deprecated` markers, version unions kept
  "for safety", or dual-path support for hypothetical callers.
- A published version number is not a reason to preserve anything.

One boundary survives: the operator's durable local state under `.kiln/` and
`~/.kiln/` — managed-job records, SQLite authorities, credentials, and config.
That data exists on a real machine, so a schema change needs either a forward
migration or an explicit recorded decision to discard it. That is data
migration, and it is decided per change by the operator; it is never a reason to
retain an API compatibility layer.

Reset is an admitted outcome. When local state has no future-useful evidence,
discarding it is preferred over carrying readers that exist only to parse it.

## Code Quality

- No dead code. Delete unused branches, types, helpers, and compatibility
  remnants once the active contract replaces them.
- No redundant implementations. Shared behavior must have one owner and one
  projection path.
- No legacy hacks. Compatibility exists only when an active documented contract
  requires it.
- Prefer clear local code over clever abstractions. Add an abstraction only when
  it removes real duplication or expresses a stable boundary.
- Use explicit imports and explicit contracts. Avoid wildcard imports and
  untyped boundary data.
- Fail fast at boundaries. Validate input before it reaches domain or runtime
  services.

## Architecture

- Respect bounded contexts. Cross-context work flows through explicit ports,
  adapters, DTOs, or events.
- Domain and core contracts do not import runtime, GUI, TUI, CLI, or provider
  infrastructure.
- Runtime owns execution policy, session state, event emission, and adapter
  invocation. Operator surfaces project runtime evidence; they do not re-create
  runtime policy.
- Provider/model catalog discovery is evidence, not authority. Runtime and
  operator surfaces must consume canonical eligibility decisions instead of
  deriving local selectability from model arrays, provider availability, stale
  caches, or static display metadata.
- Surface parity is implemented through shared contracts. GUI, TUI, CLI,
  widget, SDK, and future surfaces should attach to common runtime ports instead
  of duplicating per-surface executors.
- Bun/TypeScript owns Kiln control-plane semantics. Native helpers, Rust, WASM,
  or sidecars may only accelerate measured hot paths or provide OS capability
  behind explicit TypeScript-owned ports.
- Safety is fail-closed unless the owning architecture document explicitly
  defines a fail-open exception.

## Native Acceleration Boundary

- Rust, WASM, and sidecars must consume and produce canonical contract-shaped
  data. They must not define private schemas, private operator state, or
  surface-specific runtime semantics.
- Native acceleration must be replaceable by the TypeScript implementation
  without changing runtime behavior, operator authority, or cross-surface
  contracts.
- Native code must not own authority decisions, provider/model routing, tool
  admission, memory/config mutation, managed-agent policy, approval lifecycle,
  work-item lifecycle, or closeout semantics.
- Any native candidate needs an approved roadmap or ADR, documented
  TypeScript-owned port contract, parity fixtures, deterministic ordering,
  failure semantics, material benchmark evidence, tests, typecheck, and review.

## Ports And Events

- Cross-boundary callbacks must be named ports when they represent stable
  behavior. Prefer an interface such as `SessionEventSink.publish(...)` over an
  anonymous callback property.
- Event producers emit canonical events. Surfaces translate those events into
  presentation frames through projection helpers.
- Event sinks must compose without replacing existing sinks unless replacement
  is the documented behavior.
- A model-callable tool must not grant itself authority. Authority comes from
  runtime policy, configured routes, and approval gates.

## Shared Capacity

- Capacity follows authoritative settlement, not terminal projection. Timeout,
  cancellation, or surface state must not free work whose execution may still
  be active.
- Shared capacity has one durable owner outside ephemeral catalogs, adapter
  factories, and request objects.
- Unknown external work remains capacity-consuming and explicit in recovery
  evidence. A liveness timer must not fabricate settlement.
- Selection policy belongs to Core; adapters report capability and settlement
  but do not select accounts, rotate credentials, or release leases.
- Recovery policy follows workload semantics. Reusing a store engine does not
  authorize reusing another workload's stale-owner cleanup behavior.

## Runtime Diagnostics And Terminal Output

- Runtime state must use canonical events or evidence contracts. Do not print a
  warning for a recoverable state that is already represented by an event such
  as `cost_update`.
- Provider billing defaults have one owner in the direct-provider execution
  profiles. Routing, cost tracking, wrappers, and operator surfaces consume
  that policy instead of maintaining provider-name conditionals.
- Runtime traces are structured records containing observation time, severity,
  trace identity, component, message, and attributes. Trace producers write
  through a sink; they do not call the global `console`.
- Process-backed sinks emit one complete record per write, use the platform
  line ending, send routine information to stdout, and send warnings or errors
  to stderr. JSON mode is JSON Lines, not JSON embedded in human prose.
- Normal operator commands show actionable status rather than internal
  per-request traces. Diagnostic verbosity is explicit and must not change
  runtime behavior.
- CLI commands own their human-facing startup, warning, and failure prose
  through an output adapter so tests and embedding surfaces do not have to
  intercept global process state.

## Tests And Verification

- Behavior changes need focused tests at the owning boundary.
- Test fixtures must be synthetic, portable, and limited to the behavior under
  test. Never persist operator-specific paths, usernames, home directories,
  credentials, tokens, or raw incident payloads. Use temporary directories for
  filesystem behavior and generic OS-specific paths only when path syntax is
  part of the contract.
- Do not paste user-supplied bug text verbatim into a regression test unless
  the exact literal is the contract. Preserve the smallest sanitized value
  that still reproduces the failure.
- Shared surface behavior needs at least one non-primary surface test so parity
  is protected.
- CLI package tests must be deterministic and diagnosable in the canonical
  workspace command. Keep `@kilnai/cli` Vitest runs single-worker, emit a
  progress reporter under workspace filters, and bound test, hook, and teardown
  stalls at the package config boundary.
- CLI tests must stay hermetic by default. Do not depend on live credentials,
  installed native harnesses, operator-local state, broad skips, or sleep-based
  stabilization unless the test is explicitly marked live and excluded from
  default package verification.
- Before claiming done, run the relevant typecheck and test suites documented in
  `CLAUDE.md`.
- Documentation changes must preserve the modular architecture hierarchy.
