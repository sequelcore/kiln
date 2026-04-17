# Kiln Strategy
> Living long-term roadmap aligned to the canonical architecture.
> Last updated: 2026-04-10

## 1. Executive Thesis

Kiln's long-term position is now explicit:

- Kiln is a cybernetic control plane for governed AI work
- Kiln is not an orchestration engine as its primary identity
- Kiln is not a biological system made literal
- Kiln is not constrained by backward-compatibility promises to its earlier framing

The system should be judged by how well it regulates work under uncertainty:

- what enters the system
- what context is exposed
- what safety posture is active
- how tasks are allocated and coordinated
- how failures are contained and recovered
- how adaptation happens without uncontrolled drift

Everything in this roadmap serves that doctrine.

## 2. Product Identity

### What Kiln is

Kiln is the regulatory layer that governs AI work across local tools, execution surfaces, memory, coordination, safety, and adaptation.

### What Kiln is not

- not a generic "multi-agent framework"
- not a wrapper that merely forwards prompts to providers
- not a collection of unrelated productivity features
- not a consumer app with architecture inherited accidentally from examples

### Product promise

Kiln should let an operator trust that the system can:

- admit only work it can govern
- expose only the context required for the current task
- coordinate multiple workers without losing control
- fail safely when uncertainty or risk rises
- recover statefully instead of starting from scratch
- improve by measured adaptation instead of ad hoc hacks

## 3. Strategic Laws

These are long-term constraints, not preferences.

1. No dead code.
2. No legacy compatibility layers kept only out of sentiment.
3. No redundant abstractions without active pressure from real use.
4. No cross-context leakage that weakens bounded contexts.
5. No silent fail-open behavior in safety-critical paths.
6. No undocumented control surface that outranks the canonical architecture.
7. No feature work that bypasses invariants for local convenience.
8. No roadmap item is complete until the old path is removed.

## 4. Architectural Horizon

Kiln should converge on these stable architectural pillars:

### 4.1 Control Admission

All work must enter through explicit admission control.

Target outcomes:

- `IngressGovernor` becomes the only legitimate entry regulator
- fast-path and slow-path handling are first-class
- unsafe or underspecified work is rejected or downgraded before execution begins

### 4.2 Context Governance

Context becomes a governed resource, not an accumulated transcript dump.

Target outcomes:

- `ContextGovernor` is responsible for sufficiency, cost, and safety of exposed context
- context slices are explicit, bounded, and revocable
- raw replay becomes an implementation detail, not the default operating model

### 4.3 Controlled Coordination

Coordination must be explicit, inspectable, and recoverable.

Target outcomes:

- `DemandAllocator`, `ChainGovernor`, and `TaskRegistry` become the canonical execution triad
- shared state moves through `CoordinationStore`, not implicit prompt inheritance
- parallel work is claimed, tracked, reconciled, and closed formally

### 4.4 Layered Memory

Memory must separate fast operational state from durable knowledge.

Target outcomes:

- working, episodic, and semantic layers are explicit
- reconsolidation requires provenance, confidence, and topic coherence
- mutation is revision-aware rather than append-only folklore

### 4.5 Safety as Kernel

Safety cannot remain an accessory subsystem.

Target outcomes:

- `SafetyKernel` is a hard gate, not a recommendation layer
- dangerous tool use is fail-closed by default
- policy, execution permissions, and data boundaries converge into one regulatory model

### 4.6 Adaptive but Bounded Evolution

Kiln must improve from telemetry without becoming self-authoring chaos.

Target outcomes:

- `AdaptationEngine` only tunes within architectural law
- drift is detected via telemetry and invariants
- policy updates are reviewable and attributable

## 5. Scope Discipline

### Examples and consumers

Examples remain valid, but they are downstream expressions of the control plane. They do not define Kiln's identity.

That means:

- examples should consume the new control-plane concepts, not preserve obsolete ones
- examples are not a reason to keep old abstractions alive
- if an example depends on outdated framing, the example should be rewritten

### Internal versus external promises

There are effectively no external compatibility constraints strong enough to justify preserving obsolete architecture. Old structures can be removed once the canonical replacement exists.

## 6. Long-Term Roadmap

### Phase A - Documentation Reset

Objective:
Replace the old product narrative with a single coherent doctrine.

Required results:

- modular architecture docs become canonical
- research is synthesized at `docs/research/`
- root docs stop presenting Kiln as a meta-orchestrator
- obsolete architecture narrative is removed or reduced to temporary entrypoint scaffolding

Completion standard:

- no primary root doc contradicts the new identity
- research and architecture are navigable without legacy subtree dependency

### Phase B - Taxonomy and Boundary Cleanup

Objective:
Make names, modules, and responsibilities match the new doctrine.

Required results:

- canonical terminology used across code and docs
- obsolete names removed from active surfaces
- bounded contexts clarified
- overlapping modules identified for consolidation or deletion

Completion standard:

- one concept has one name
- one responsibility has one owner

### Phase C - Core Control-Plane Refactor

Objective:
Make the runtime conform to the architectural model instead of merely describing it.

Required results:

- explicit implementation paths for `IngressGovernor`, `ContextGovernor`, `DemandAllocator`, `ChainGovernor`, and `TaskRegistry`
- mode handling aligned to `NORMAL`, `SUPERVISED`, `DEGRADED`, `LOCKED`, and `RECOVERING`
- admission, execution, and recovery flows made explicit

Completion standard:

- canonical flows from the architecture docs map directly to runtime modules
- execution is explainable in terms of governors and controllers, not accidental call graphs

### Phase D - Safety and Permission Unification

Objective:
Collapse fragmented permission, policy, and risk handling into one coherent kernel.

Required results:

- dangerous command detection, tool permissioning, and data boundaries share one policy model
- safety decisions are observable and attributable
- runtime defaults are fail-closed where risk is ambiguous

Completion standard:

- no parallel permission model competes with the kernel
- no important execution path bypasses safety accounting

### Phase E - Memory and Context Refactor

Objective:
Separate operational context from durable memory and make mutation disciplined.

Required results:

- memory layers are explicit in code
- topic-based reconsolidation becomes canonical
- context assembly is driven by policy, not transcript accumulation

Completion standard:

- retrieval, mutation, and exposure each have distinct responsibilities
- memory writes are revision-aware and auditable

### Phase F - Coordination Substrate

Objective:
Move multi-worker behavior from prompt convention to controlled shared-state coordination.

Required results:

- claims, latches, quorum signals, and handoffs live in `CoordinationStore`
- task lifecycle is explicit
- parallel work is bounded by budget and policy

Completion standard:

- coordination behavior can be inspected from shared state alone
- recovery does not depend on hidden prompt history

### Phase G - Operator Surfaces

Objective:
Make CLI and GUI behave as operator interfaces to the control plane. Per
ADR-005 (2026-04-17), the TUI is frozen and scheduled for deletion in
Phase I; GUI is the primary operator surface.

Required results:

- CLI and GUI expose system state, mode, safety posture, and task lifecycle clearly
- tooling stops pretending to be the product core
- user interaction maps cleanly to control-plane concepts
- TUI receives no feature work; critical bug fixes only
- a follow-up ADR defines the GUI stack, boundaries, and binding contract

Completion standard:

- the interface explains what the system is regulating, not just what command was run
- GUI reaches parity with former TUI scope, unblocking TUI deletion in Phase I

Progress (as of 2026-04-17):

- ADR-005 accepted — TUI frozen
- ADR-006 accepted — GUI stack decided
- `docs/roadmap/gui-phase-1-parity-checklist.md` accepted
- `packages/gui/` scaffold landed at commit `54d1d53` (React 19 + TanStack Router/Query + Zustand + Tailwind v4 + Vitest + ESLint 9); pre-spec UI archived under `.reference/`
- Runtime `gui-gateway` + `operator-gateway` and `kiln gui` CLI command in place
- Outstanding: extract `@kilnai/gateway-contracts`, add Playwright e2e, port parity-checklist rows

### Phase H - Example and Consumer Realignment

Objective:
Rewrite examples and downstream consumers to express the new Kiln power.

Required results:

- examples use the control-plane vocabulary and flow model
- outdated demo patterns are deleted
- downstream apps inherit regulation, memory, safety, and coordination capabilities intentionally

Completion standard:

- examples teach the new system rather than memorializing the old one

### Phase I - Ruthless Cleanup

Objective:
Remove obsolete modules, duplicate paths, stale ADR assumptions, and dead documentation.

Required results:

- legacy abstractions deleted
- dead docs removed
- old names eradicated from primary paths

Completion standard:

- the repository reads like one architecture, not three generations stacked together

## 7. Execution Principles

Every implementation step should follow these rules:

1. Refactor by bounded context, not by scattered edits.
2. Prefer replacement over shims.
3. Delete obsolete paths in the same phase that replaces them.
4. Keep abstractions concrete until at least three real uses justify extraction.
5. Preserve a short causal chain from doctrine to module to runtime behavior.
6. If a module cannot be explained in the canonical vocabulary, it is suspect.

## 8. Success Criteria

Kiln reaches strategic coherence when:

- the repository describes one identity consistently
- architecture docs and runtime structure correspond directly
- consumers inherit the new doctrine naturally
- safety, context, coordination, and adaptation operate as one system
- obsolete code and obsolete narrative are both gone

## 9. Immediate Next Steps

1. Finish the documentation refactor at the root and remove stale narrative surfaces.
2. Audit package/module names against the frozen taxonomy.
3. Map current runtime modules to the canonical subsystems and mark keep, split, merge, or delete.
4. Sequence the first code refactors around control admission, context governance, safety, and coordination substrate.
5. Rewrite examples only after the core doctrine is stable in code and docs.

This document is the strategic source of truth for long-term direction. Detailed execution belongs in the roadmap documents under `docs/roadmap/` and the modular architecture under `docs/architecture/`.
