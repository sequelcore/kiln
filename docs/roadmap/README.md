# Roadmap

This directory contains active and deferred implementation tracks only.
Completed programs are promoted into stable architecture, guide, or changelog
documentation instead of being archived here.

## How To Read This Roadmap

- Active roadmap files describe scoped work that is still in progress.
- Deferred items are parked until their product or architecture trigger exists.
- Completed work is summarized here only to point readers to stable doctrine.
- Historical implementation detail belongs in `docs/changelog.md`.

## Canonical References

Use these documents as the stable source of truth before starting roadmap work:

- `docs/architecture/work-governance.md` for work admission, delegation,
  verification, and evidence closeout.
- `docs/architecture/engineering-standards.md` for Clean Architecture,
  cross-surface parity, native acceleration boundaries, and verification rules.
- `docs/architecture/operator-surfaces.md` for GUI, TUI, CLI, native, IDE,
  desktop, and remote operator surfaces.
- `docs/architecture/provider-model-discovery.md` for provider/model
  discovery, stale startup projections, cache behavior, and fail-closed
  execution admission.
- `docs/architecture/native-operator-surface.md` for native operator surface
  projection boundaries and promotion gates.
- `docs/architecture/benchmark-validation.md` and `docs/guides/eval.md` for
  benchmark-facing profiles, exact-format eval output contracts, baseline
  readiness, benchmark adapters, and public report evidence.
- `docs/architecture/managed-agents.md` for managed invocation, child
  authority, write evidence, replay invariants, background lifecycle, parallel
  orchestration, isolation, cockpit projection, and remote harness routes.
- `docs/architecture/context-resource-plane.md` for resource registry,
  resource-read pagination, artifact-backed content, and model-facing resource
  tools.
- `docs/research/15-background-parallel-agent-surface.md` for the research
  finding that background and parallel agents require a separate lifecycle,
  explicit identity, isolation, status, cancellation, and handoff evidence.
- `docs/architecture/config-projection.md`,
  `docs/architecture/harness-integration-capabilities.md`, and
  `docs/guides/global-config.md` for config projection, harness capabilities,
  native projection, remote harness route configuration, and governed config
  mutation.
- `docs/architecture/developer-tools.md` and `docs/guides/tool-use.md` for
  browser/computer use, controlled web research, tool execution, and operator
  evidence.
- `docs/architecture/memory.md` and `docs/guides/memory.md` for governed
  memory, Memory Lattice, lifecycle policy, recall, and memory resources.

## Active Roadmaps

0.0.1. [Rust Module Optimization](./00.0.1-rust-module-optimization.md)
   Active on 2026-05-17. Scope is the Rust optimization boundary:
   Bun/TypeScript owns control-plane semantics while Rust/WASM/sidecars enter
   as measured module hot paths or native helpers behind TypeScript-owned ports
   that consume shared contracts. This is separate from the native surface
   roadmap.

Completed background and parallel managed-agent work is canonicalized in
`docs/architecture/managed-agents.md`, `docs/architecture/context-resource-plane.md`,
`docs/architecture/config-projection.md`, `docs/architecture/operator-surfaces.md`,
`docs/architecture/work-governance.md`, `docs/guides/global-config.md`, and
`docs/changelog.md`.

1. [Native Operator Surface](./01-native-operator-surface.md)
   Started on 2026-05-15. Current scope is the native operator surface benchmark
   path: contract-only runner admission, orchestration planning, workload
   governance, and approval evidence before any live browser or native
   benchmark execution. It does not implement Rust optimization.

2. [Session Feedback Pipeline](./02-session-feedback-pipeline.md)
   Started on 2026-05-18. Scope is the operator feedback-to-fix pipeline:
   local-first feedback bundles, redaction, evidence selection, issue drafts,
   governed repair work items, and later draft pull-request flow. This is
   separate from CLI resume feedback.

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

Stable doctrine for completed work lives in the architecture and guide docs,
not in roadmap files. Current completed areas include:

- GUI parity and operator surface foundations.
- TUI and GUI gateway-backed operation.
- Managed agent invocation, background and parallel lifecycle, write authority,
  live adapter hardening, cockpit projection, resource pagination, budget
  admission, and remote harness route constraints.
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

## Execution Priority

1. Keep active roadmap work limited to the explicit scope in its roadmap file.
2. Promote stable results into architecture or guide docs when a track closes.
3. Delete completed roadmap files after doctrine is absorbed.
4. Do not create near-duplicate roadmap files for one concern.
5. Do not add background or parallel child execution paths outside
   `docs/architecture/managed-agents.md` and core/runtime managed invocation
   contracts; child lifecycle, worktree/sandbox leases, cancellation, status,
   join, handoff, and cockpit projection must use the shared runtime-owned
   lifecycle.
6. Do not start live native benchmark execution, native operator UI, dispatch
   paths, or gateway attach loops without an approved native-surface roadmap
   slice or ADR.
7. Do not start Rust/WASM/sidecar modules without an approved Rust optimization
   roadmap slice or ADR and the Rust module promotion gates in `00.0.1`.
