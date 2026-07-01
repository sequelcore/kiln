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

## Tests And Verification

- Behavior changes need focused tests at the owning boundary.
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
