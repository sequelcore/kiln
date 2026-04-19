# Module Mapping

This document maps the current package and module structure to the frozen Kiln
architecture so the code refactor can proceed against a concrete inventory.

It is not a design document. It is a translation layer between:

- the codebase that exists today
- the control-plane architecture that should exist

## Purpose

Use this file to answer:

- which current modules already align with the target architecture
- which modules are fragmented across bounded contexts
- which names are implementation residue from the old framing
- which modules should likely be kept, split, merged, or deleted

## Package Inventory

Top-level packages:

- `packages/core`
- `packages/runtime`
- `packages/cli`
- `packages/tui`
- `packages/sdk`
- `packages/widget`
- `packages/studio`
- `packages/tools*`

Primary source inventories reviewed:

- `packages/core/src`
- `packages/runtime/src`
- `packages/cli/src`

## Canonical Target Subsystems

The current architecture expects these stable subsystem owners:

- `IngressGovernor`
- `ContextGovernor`
- `DemandAllocator`
- `ChainGovernor`
- `TaskRegistry`
- `CoordinationStore`
- `SafetyKernel`
- `ModeController`
- `TelemetryLoop`
- `AdaptationEngine`

## Mapping Overview

| Canonical subsystem | Current primary homes | Current state | Likely action |
|---------------------|-----------------------|---------------|---------------|
| `IngressGovernor` | `packages/core/src/engine`, `packages/core/src/orchestrator`, `packages/runtime/src/gateway`, `packages/runtime/src/session` | fragmented | split and consolidate |
| `ContextGovernor` | `packages/core/src/memory`, `packages/core/src/knowledge`, `packages/core/src/field`, `packages/cli/src/wrapper`, `packages/runtime/src/session` | fragmented | split and consolidate |
| `DemandAllocator` | `packages/core/src/orchestrator`, `packages/core/src/tree`, parts of `packages/runtime/src/session` | partially aligned but old naming | rename and consolidate |
| `ChainGovernor` | `packages/core/src/orchestrator`, `packages/core/src/tree`, parts of execution/session flows | partially aligned but old naming | rename and consolidate |
| `TaskRegistry` | `packages/core/src/tree`, `packages/runtime/src/session`, `packages/runtime/src/execution` | fragmented | split and consolidate |
| `CoordinationStore` | `packages/runtime/src/mcp`, `packages/runtime/src/session`, `packages/runtime/src/tenant`, old swarm/task primitives | fragmented | consolidate shared-state ownership |
| `SafetyKernel` | `packages/core/src/safety`, `packages/core/src/security`, `packages/core/src/sandbox`, `packages/runtime/src/gateway`, `packages/runtime/src/session` | broadly present but distributed | merge under one explicit boundary |
| `ModeController` | `packages/runtime/src/session`, `packages/runtime/src/gateway`, `packages/cli/src/wrapper` | implicit | extract explicit mode ownership |
| `TelemetryLoop` | `packages/core/src/events`, `packages/core/src/observability`, `packages/core/src/cost`, `packages/runtime/src/observability`, `packages/core/src/enrichment`, `packages/core/src/eval` | broadly present but spread out | keep, clarify boundaries |
| `AdaptationEngine` | `packages/core/src/orchestrator`, `packages/core/src/memory`, `packages/core/src/knowledge`, `packages/core/src/field`, policy/routing layers | implicit and mixed with features | extract bounded adaptation layer |

## Current Module Notes

### `packages/core/src/engine`

Current role:

- domain contracts
- loader and validation
- core structural abstractions

Assessment:

- still contains useful boundary contracts
- still carries old product framing heavily
- likely source of future canonical control contracts, but needs terminology and ownership cleanup

Disposition:

- keep the truly foundational contracts
- split out old app/team/workflow-first identity where it blocks the new model

### `packages/core/src/orchestrator`

Current role:

- execution flow
- old coordination primitives
- chain/allocation logic

Assessment:

- this is one of the most architecture-critical directories
- it contains several concepts that map into the new architecture
- naming is still strongly tied to old biological/orchestration framing

Disposition:

- major refactor target
- probable source material for `DemandAllocator`, `ChainGovernor`, and parts of `IngressGovernor`

### `packages/core/src/tree`

Current role:

- task tree and batch execution

Assessment:

- task lifecycle concerns belong near the future `TaskRegistry`
- tree-specific exploration abstractions may not all survive the new doctrine

Disposition:

- split into keep versus delete
- preserve task-state ownership logic
- remove speculative or redundant tree abstractions if they are not architecturally justified

### `packages/core/src/memory`

Current role:

- persistent memory storage and retrieval

Assessment:

- strategically important
- should survive, but under stricter layered-memory ownership

Disposition:

- keep
- align to working/episodic/semantic layering and revision-aware mutation model

### `packages/core/src/knowledge`

Current role:

- retrieval, embeddings, sources, contact memory, reranking

Assessment:

- should no longer define Kiln's identity, but remains important as one context/memory subsystem

Disposition:

- keep
- narrow its responsibility to retrieval and source-grounding concerns
- integrate more explicitly with `ContextGovernor`

### `packages/core/src/safety`, `security`, `sandbox`, `tools`

Current role:

- policy rails
- security checks
- execution restrictions
- tool execution substrate

Assessment:

- strong functional base exists
- ownership is too spread out for a clear `SafetyKernel`

Disposition:

- consolidate conceptually
- keep implementation pieces that enforce real boundaries
- remove duplicated or ambiguous policy layers over time

### `packages/core/src/events`, `observability`, `cost`, `enrichment`, `eval`

Current role:

- telemetry, eventing, cost tracking, analytics, evaluation

Assessment:

- these belong naturally under `TelemetryLoop`
- likely less in need of conceptual deletion and more in need of clearer boundaries

Disposition:

- mostly keep
- clarify what is operational telemetry versus offline analytics versus product enrichment

### `packages/runtime/src/session`

Current role:

- session state
- execution control
- handoff logic
- authorization and retry behavior

Assessment:

- another architecture-critical directory
- much of the future control-plane behavior is effectively living here already, but without stable subsystem boundaries

Disposition:

- major refactor target
- split toward `ModeController`, `TaskRegistry`, `SafetyKernel`, and governed execution flows

### `packages/runtime/src/gateway`, `channels`, `trigger`, `tenant`, `mcp`

Current role:

- runtime surfaces
- channel ingress
- webhook and trigger binding
- tenant handling
- MCP exposure

Assessment:

- important operational layer
- should be treated as runtime surfaces beneath the control plane, not as the source of system identity

Disposition:

- keep
- tighten admission and mode ownership boundaries
- reduce doctrinal leakage from runtime surfaces into architecture

### `packages/cli/src/wrapper`, `commands`, `sync`, `config`

Current role:

- local operator surface
- wrapper/runtime integration
- config and sync logic

Assessment:

- important surface area
- should remain secondary to the control plane
- wrapper naming and old meta-orchestrator assumptions still leak through here

Disposition:

- keep as operator/runtime surface
- rename and simplify concepts where they preserve obsolete product identity

## Immediate Refactor Candidates

These areas are most likely to produce high architectural leverage first:

1. `packages/core/src/orchestrator`
2. `packages/runtime/src/session`
3. `packages/core/src/engine`
4. `packages/core/src/safety` + `security` + `sandbox` + `tools`
5. `packages/core/src/memory` + `knowledge`

## Renaming Pressure

Current names under the strongest pressure for replacement:

- `orchestrator`
- `ThresholdAllocator`
- `CascadeController`
- `TaskChannel`
- `Swarm*`
- `Router` where used as canonical architecture language

These names may still exist temporarily in code, but they should not survive as
the long-term public architecture vocabulary unless explicitly justified.

## Next Mapping Step

After this inventory, the next useful artifact should be a bounded-context
decision table per major module:

- keep
- split
- merge
- rename
- delete

That table should be created before major code edits begin so refactors do not
turn into broad uncontrolled churn.
