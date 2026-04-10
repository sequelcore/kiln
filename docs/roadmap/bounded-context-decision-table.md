# Bounded-Context Decision Table

This document assigns an explicit refactor disposition to the major Kiln
packages and modules.

Allowed decisions:

- `keep`
- `split`
- `merge`
- `rename`
- `delete`

Multiple actions can apply when a module contains both valuable core logic and
obsolete framing.

## Purpose

Use this table before code refactors begin so each major area has a declared
fate. This avoids broad churn and prevents the old architecture from being
accidentally preserved through piecemeal edits.

Read first:

- [taxonomy-freeze.md](taxonomy-freeze.md)
- [current-module-mapping.md](current-module-mapping.md)

## Decision Table

| Area | Decision | Target direction | Why |
|------|----------|------------------|-----|
| `packages/core/src/engine` | `split`, `rename`, `keep` | Preserve foundational contracts and validation; extract or rename app/team/workflow-first language that blocks control-plane terminology | It still owns useful structural contracts but carries old identity heavily |
| `packages/core/src/orchestrator` | `split`, `rename` | Break apart into `IngressGovernor`, `DemandAllocator`, `ChainGovernor`, and related control logic | High-value logic exists here, but the naming and boundaries are obsolete |
| `packages/core/src/tree` | `split`, `merge`, `delete` | Merge valid task-lifecycle ownership into `TaskRegistry`; delete speculative tree abstractions that do not survive the new model | Task ownership matters; exploration-first tree abstractions may not |
| `packages/core/src/memory` | `keep`, `split` | Keep storage and recall foundations; split toward layered memory responsibilities | Strategically important and compatible with the new doctrine after restructuring |
| `packages/core/src/knowledge` | `keep`, `split` | Keep retrieval/source-grounding logic; integrate more explicitly with `ContextGovernor` and layered memory | Useful subsystem, but should no longer overdefine product identity |
| `packages/core/src/field` | `split`, `merge`, `rename` | Rehome context-pressure and field-like concepts into `ContextGovernor` or `AdaptationEngine` where justified | Currently diffuse and conceptually unstable |
| `packages/core/src/safety` | `keep`, `merge` | Retain rails, classification, sanitization, and grounding logic under a clear `SafetyKernel` boundary | Strong base exists but ownership is fragmented |
| `packages/core/src/security` | `keep`, `merge` | Fold command safety, prompt scanning, secrets, audit, and guardian logic into the kernel boundary where possible | Security is real, but too separate from the safety story today |
| `packages/core/src/sandbox` | `keep`, `merge` | Treat as enforcement infrastructure under `SafetyKernel` rather than a parallel policy system | Important boundary-enforcement substrate |
| `packages/core/src/tools` | `keep`, `merge`, `rename` | Keep runtime tool execution and MCP exposure; align terminology under tool-execution doctrine | Real capability, but currently documented and owned too loosely |
| `packages/core/src/events` | `keep` | Keep as telemetry/event substrate under `TelemetryLoop` | Core infrastructure with low naming pressure |
| `packages/core/src/observability` | `keep` | Keep and clarify as observability segment of `TelemetryLoop` | Already aligned enough |
| `packages/core/src/cost` | `keep` | Keep under telemetry and control feedback | Important feedback loop input |
| `packages/core/src/enrichment` | `keep`, `split` | Keep if it remains operationally useful; separate telemetry-grade analytics from product-facing enrichment | Mixed telemetry and product concerns |
| `packages/core/src/eval` | `keep` | Keep as evaluation and verification support | Valuable and mostly orthogonal |
| `packages/core/src/verification` | `keep`, `merge` | Keep verification mechanics; merge policy ownership with governed execution flows | Useful but should not float as an isolated concern |
| `packages/core/src/domain` | `split`, `rename`, `keep` | Preserve only what fits DDD-safe boundaries; avoid letting "domain" become a vague umbrella | The name risks overlap with actual bounded-context language |
| `packages/core/src/domains` | `keep`, `demote` | Keep only as implementation support for stack-aware defaults | Not architectural center |
| `packages/core/src/package` | `keep` | Keep if still required for packaging/distribution | Operational area, low architectural pressure |
| `packages/core/src/presets` | `split`, `delete` | Keep only if presets still serve a concrete runtime purpose; delete stale preset layers | High risk of legacy abstraction residue |
| `packages/core/src/skill` | `keep` | Keep as operational capability surface | Useful, not architecture-defining |
| `packages/runtime/src/session` | `split`, `rename` | Extract explicit `ModeController`, execution-flow ownership, session/task lifecycle, and safety interaction boundaries | One of the highest-value refactor targets |
| `packages/runtime/src/gateway` | `keep`, `split` | Keep as runtime surface; separate admission, hosting, and transport concerns more clearly | Important, but should not define doctrine |
| `packages/runtime/src/channels` | `keep` | Keep as runtime I/O surface | Operationally necessary and conceptually stable |
| `packages/runtime/src/trigger` | `keep`, `split` | Keep trigger mechanics; align trigger admission and execution with governed flows | Useful but currently app/workflow-biased |
| `packages/runtime/src/tenant` | `keep`, `split` | Keep tenant isolation and config handling; reduce spillover into routing/identity logic | Important for isolation, but concept boundaries need tightening |
| `packages/runtime/src/mcp` | `keep`, `merge` | Keep MCP exposure; merge shared-state ownership concerns into future `CoordinationStore` where appropriate | Valuable integration layer with some state overlap |
| `packages/runtime/src/execution` | `keep`, `merge`, `rename` | Consolidate runtime execution ownership with the canonical flow model | Likely future home for explicit execution control surfaces |
| `packages/runtime/src/observability` | `keep` | Keep under `TelemetryLoop` | Operationally aligned already |
| `packages/runtime/src/a2a` | `keep`, `demote` | Keep if still useful, but treat as integration capability rather than identity | Peripheral to the control-plane core |
| `packages/cli/src/wrapper` | `rename`, `split`, `keep` | Keep as operator/runtime surface; remove meta-orchestrator-era framing from names and boundaries | Important surface with outdated conceptual leakage |
| `packages/cli/src/commands` | `keep` | Keep as command surface | Operationally necessary |
| `packages/cli/src/config` | `keep` | Keep as local configuration layer | Low architectural conflict |
| `packages/cli/src/sync` | `keep`, `demote` | Keep as support tooling, not product identity | Important utility, not doctrine |
| `packages/tui` | `keep`, `demote` | Keep as operator-facing surface under the control plane | Surface, not identity |
| `packages/sdk` | `keep` | Keep as integration surface | Stable enough conceptually |
| `packages/widget` | `keep` | Keep as embeddable surface | Stable enough conceptually |
| `packages/studio` | `keep` | Keep as inspection/development surface | Useful operator/developer interface |
| `packages/tools*` | `keep` | Keep as platform packaging support | Infrastructure, low conceptual pressure |

## Named Pressure Points

These current names should be treated as unstable unless justified by code-level
decisions:

- `orchestrator`
- `demand-allocator`
- `cascade-controller`
- `task-channel`
- `team-composer`
- `swarm` terminology
- `router` when used as architecture language rather than a narrow implementation detail

## First Refactor Sequence

The first code refactor sequence should follow this order:

1. `packages/core/src/orchestrator`
2. `packages/runtime/src/session`
3. `packages/core/src/engine`
4. `packages/core/src/safety` + `security` + `sandbox` + `tools`
5. `packages/core/src/memory` + `knowledge` + `field`

This order is preferred because it moves from the most identity-defining logic
to the supporting subsystems.

## Deletion Rule

No area is considered "refactored" if the new path exists but the obsolete path
remains active without a concrete reason. Replacement phases must end with old
names, old abstractions, or dead modules being removed.
