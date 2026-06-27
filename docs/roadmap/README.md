# Roadmap

This directory contains active and deferred implementation tracks only.
Completed programs are promoted into stable architecture, guide, or changelog
documentation instead of being archived here.

## How To Read This Roadmap

- Active roadmap files describe scoped work that is still in progress.
- Deferred items wait for a clear product or architecture trigger.
- Completed implementation history belongs in `docs/changelog.md`.
- Durable behavior belongs in canonical architecture and guide docs.

## Canonical References

Use these documents as the source of truth before starting roadmap work:

- `docs/architecture/work-governance.md` for work admission, delegation,
  verification, and evidence closeout.
- `docs/architecture/engineering-standards.md` for Clean Architecture,
  cross-surface parity, native acceleration boundaries, and verification rules.
- `docs/architecture/operator-surfaces.md` for GUI, TUI, CLI, native, IDE,
  desktop, and remote operator surfaces.
- `docs/architecture/execution-surfaces.md` for Kiln Operator Workspace, Kiln
  Gateway runtime, and contract-first surface convergence.
- `docs/architecture/provider-model-discovery.md` for provider/model
  discovery, stale startup projections, cache behavior, and fail-closed
  execution admission.
- `docs/architecture/harness-integration-capabilities.md` and
  `docs/architecture/config-projection.md` for harness capabilities, install
  health, native projection, and governed config mutation.
- `docs/architecture/managed-agents.md` and
  `docs/architecture/context-resource-plane.md` for managed invocation,
  resource reads, replay evidence, and model-facing resources.
- `docs/architecture/native-operator-surface.md` for native operator surface
  projection boundaries and promotion gates.
- `docs/architecture/developer-tools.md` and `docs/guides/tool-use.md` for
  browser/computer use, controlled web research, tool execution, and operator
  evidence.
- `docs/architecture/memory.md` and `docs/guides/memory.md` for governed
  memory, lifecycle policy, recall, and memory resources.

## Active Roadmaps

0.0.1. [Rust Module Optimization](./00.0.1-rust-module-optimization.md)
   Active on 2026-05-17. Scope is the Rust optimization boundary:
   Bun/TypeScript owns control-plane semantics while Rust/WASM/sidecars enter
   as measured module hot paths or native helpers behind TypeScript-owned ports
   that consume shared contracts.

1. [Native Operator Surface](./01-native-operator-surface.md)
   Active on 2026-05-15. Scope is the native operator surface benchmark path:
   contract-only runner admission, orchestration planning, workload
   governance, and approval evidence before live browser or native benchmark
   execution.

2. [Session Feedback Pipeline](./02-session-feedback-pipeline.md)
   Active on 2026-05-18. Scope is the operator feedback-to-fix pipeline:
   local-first feedback bundles, redaction, evidence selection, issue drafts,
   governed repair work items, and later draft pull-request flow.

## Deferred Roadmaps

- OS-pack packaging for web extraction and browser helpers.
  Deferred until controlled web primitives need platform-specific helper
  binaries or dependencies.
- Binary and PDF source artifacts for controlled web research.
  Deferred until research workflows need reliable PDF text extraction, OCR, or
  binary artifact handling.
- Learning-based governance and routing.
  Deferred until there are enough real workflow traces, eval data, and stable
  runtime policies to justify machine-learned routing or governance advice.
- Full external benchmark expansion.
  Deferred until a stable product surface can support public benchmark claims
  without benchmark-only prompt paths, tool schemas, or authority shortcuts.

## Completed Areas

Stable doctrine for completed work lives in architecture and guide docs, not in
roadmap files. Current completed areas include:

- Harness installation health, provider/model readiness, local readiness
  probes, and read-only doctor evidence.
- GUI parity and operator surface foundations.
- TUI and GUI gateway-backed operation.
- Managed agent invocation, background and parallel lifecycle, route-source
  provenance, parent-turn lineage, timeout diagnostics, and remote harness
  route constraints.
- Work governance, plan mode, goal execution, and evidence-gated closeout.
- Config projection, native harness projection, and governed config mutation.
- Agent context, instruction profiles, skills, and repo shims.
- Memory Lattice, memory lifecycle policy, and context resource projection.
- Provider credential pooling and provider/model discovery.
- Operator-surface startup discovery staging and stale provider diagnostics.
- Controlled web research, browser/computer use, and tool execution.
- Multimodal artifact transport and capability-aware route admission.
- Agent QA showcase recorder.
- External benchmark validation platform.
- CLI answer/json output contracts for exact-format evals and benchmark
  harnesses.
- Native operator surface foundation and embedded browser operator capability.
- Native operator surface projection foundation with defer/no-promotion status.
- Execution surfaces convergence: shared Operator Workspace home projection,
  gateway target switcher, target-aware resource inspector, SDK/CLI resource
  reads, and cross-surface documentation closeout.

## Execution Priority

1. Keep active roadmap work limited to the explicit scope in its roadmap file.
2. Promote stable results into architecture or guide docs when a track closes.
3. Delete completed roadmap files after doctrine is absorbed.
4. Do not create near-duplicate roadmap files for one concern.
5. Do not add background or parallel child execution paths outside
   `docs/architecture/managed-agents.md` and core/runtime managed invocation
   contracts.
6. Do not start live native benchmark execution, native operator UI, dispatch
   paths, or gateway attach loops without an approved native-surface roadmap
   slice or ADR.
7. Do not start Rust/WASM/sidecar modules without an approved Rust optimization
   roadmap slice or ADR and the Rust module promotion gates in `00.0.1`.
