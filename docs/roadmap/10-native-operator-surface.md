# 10 - Native Operator Surface

Status: Deferred
Execution: Deferred - this is the final roadmap track and is not admissible while any other executable roadmap track remains open.
Started: 2026-05-15

## Objective

Decide whether Kiln still needs a native operator surface after the rest of the
product and control-plane roadmap has settled. Native work restarts from current
product evidence; the removed Electron prototype is not a compatibility target
or an implementation baseline.

## Ownership

This track owns the future native-surface product decision, any later native
presentation boundary, and any native packaging/distribution decision. It does
not own runtime execution, gateway policy, browser authority, shared operator
projection, provider routing, configuration, or Rust optimization.

## Admission Blocker

No slice is admissible until every other numbered product or implementation
track is closed by completion, rejection, or removal from the execution queue.
Guardrail records do not become executable prerequisites, but their constraints
still apply.

When that blocker clears, re-scout the then-current GUI, TUI, CLI, runtime,
gateway, packaging, and operator evidence before choosing a stack or restoring
any implementation. Git history is reference material, not authority.

## Scope

- Evidence that a web or terminal surface cannot satisfy a demonstrated
  operator workflow cleanly.
- An explicit promote, narrow, or reject decision for a native surface.
- Shared-contract parity and authority boundaries for any admitted surface.
- Measured comparison against the then-current active operator surfaces.
- Packaging, signing, updates, rollback, local-state ownership, and uninstall
  semantics only after the product decision admits distribution.

## Non-Goals

- No native package, renderer, shell, browser host, network attach, dispatch,
  capability advertisement, benchmark runner, or native-only gateway contract
  while this track is deferred.
- No dormant Electron, Rust, WASM, or sidecar implementation.
- No reservation of package names, transports, schemas, UI stacks, or release
  formats before evidence selects them.
- No duplicated runtime, session, authority, or browser policy in a surface.

## Ordered Slices

### Slice 0 - Re-admission Decision

Status: Blocked on closure of every other executable roadmap track.

Re-scout current operator workflows and record the smallest capability that
requires a native boundary. Reject and remove this track if no such capability
has demonstrated value.

### Slice 1 - Contract And Evidence Plan

Status: Blocked on Slice 0 admitting native work.

Define the narrow shared contracts, equivalent fixtures, authority boundary,
measurement method, failure behavior, and deletion criteria before creating an
implementation package.

### Slice 2 - Bounded Implementation

Status: Blocked on Slice 1 and an explicit architecture decision.

Implement only the admitted native capability, prove parity with active
surfaces, and keep runtime truth behind existing gateway contracts.

### Slice 3 - Promotion Or Rejection

Status: Blocked on measured evidence.

Promote, narrow, or delete the implementation. Distribution requires its own
explicitly admitted packaging slice.

## Promotion Gates

- A named native-only product capability has current operator evidence.
- Existing GUI, TUI, CLI, and gateway paths were evaluated first.
- Runtime and authority remain owned by their current bounded contexts.
- Equivalent fixtures and deterministic measurements exist before promotion.
- The implementation can be deleted without changing core/runtime semantics.
- Tests, typecheck, build, documentation, and independent product evidence pass.

## Verification

There is no native verification command while this track is deferred. The
repository must remain free of native implementation and roadmap-only runtime
contracts. Normal repository gates verify the active surfaces.

## Completion Criteria

This track closes when the native surface is explicitly rejected and removed,
or when an admitted implementation is measured, promoted, documented, and
given complete distribution and recovery semantics. Until all earlier roadmap
work is closed, the only valid state is deferred with no implementation.
