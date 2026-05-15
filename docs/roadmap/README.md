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
- `docs/architecture/operator-surfaces.md` for GUI, TUI, CLI, native, IDE,
  desktop, and remote operator surfaces.
- `docs/architecture/native-cockpit-projection.md` for native cockpit
  projection boundaries and promotion gates.
- `docs/architecture/benchmark-validation.md` and `docs/guides/eval.md` for
  benchmark-facing profiles, baseline readiness, benchmark adapters, and public
  report evidence.
- `docs/architecture/managed-agents.md` for managed invocation, child
  authority, write evidence, and replay invariants.
- `docs/architecture/config-projection.md`,
  `docs/architecture/harness-integration-capabilities.md`, and
  `docs/guides/global-config.md` for config projection, harness capabilities,
  native projection, and governed config mutation.
- `docs/architecture/developer-tools.md` and `docs/guides/tool-use.md` for
  browser/computer use, controlled web research, tool execution, and operator
  evidence.
- `docs/architecture/memory.md` and `docs/guides/memory.md` for governed
  memory, Memory Lattice, lifecycle policy, recall, and memory resources.

## Active Roadmaps

1. [Native Cockpit Benchmark Validation](./01-native-cockpit-benchmark-validation.md)
   Started on 2026-05-15. Current scope is contract-only benchmark runner
   admission, orchestration planning, workload governance, and approval
   evidence before any live browser or native benchmark execution.

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
- TUI maintenance and gateway-backed operation.
- Managed agent invocation, write authority, and live adapter hardening.
- Work governance, plan mode, goal execution, and evidence-gated closeout.
- Config projection, native harness projection, and governed config mutation.
- Agent context, instruction profiles, skills, and repo shims.
- Memory Lattice, memory lifecycle policy, and context resource projection.
- Provider credential pooling and provider/model discovery.
- Controlled web research, browser/computer use, and tool execution.
- Multimodal artifact transport and capability-aware route admission.
- Agent QA showcase recorder.
- External benchmark validation platform.
- Native operator surface foundation and embedded browser operator capability.
- Native cockpit projection foundation with defer/no-promotion status.

## Execution Priority

1. Keep active roadmap work limited to the explicit scope in its roadmap file.
2. Promote stable results into architecture or guide docs when a track closes.
3. Delete completed roadmap files after doctrine is absorbed.
4. Do not create near-duplicate roadmap files for one concern.
5. Do not start live native cockpit benchmark execution, native cockpit UI,
   dispatch paths, gateway attach loops, or Rust/WASM/sidecar modules without an
   approved roadmap slice or ADR.
