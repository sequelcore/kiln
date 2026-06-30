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

3. [Public Release UI Debt](./03-public-release-ui-debt.md)
   Active on 2026-06-28. Scope is release-blocking GUI debt discovered during
   live validation, starting with the composer context usage indicator. The GUI
   must not publish with a fake context percentage or an unavailable state
   presented as authoritative.

7. [Cross-Harness Provider Adapter Layer](./07-cross-harness-provider-adapter-layer.md)
   Urgent active roadmap opened on 2026-06-29. Scope is the explicit adapter
   layer that lets Kiln invoke governed agents and provider routes across
   harness boundaries without projecting unsupported model strings into native
   harness files.

8. [Verified Efficiency Control Plane](./08-verified-efficiency-control-plane.md)
   Proposed long-term architecture program opened on 2026-06-30. Scope is the
   provider-neutral control loop that maximizes verified engineering value per
   token, dollar, second, and agent turn through attributable measurement,
   bounded efficiency actuators, and evidence-gated policy promotion.

## Deferred Roadmaps

- [Federated Harness Configuration Plane](./04-federated-harness-configuration-plane.md).
  Deferred until cross-harness capability matrices and projection benchmarks
  can justify replacing selected full projections with thin or dynamic native
  adapters without weakening standalone operation or governance.
- [CLI Test Harness Stability](./05-cli-test-harness-stability.md).
  Deferred until full-workspace verification or release confidence requires
  diagnosing the `@kilnai/cli test` hang observed on 2026-06-29.
- [Research Turn Token Budgeting](./06-research-turn-token-budgeting.md).
  Deferred research-specific implementation slice governed by roadmap `08`.
  Promote it when live validation, release confidence, or provider quota
  pressure requires reducing research-turn token volume through measured
  attribution and canonical evidence budgeting.
- [Native Harness Route Integrity](./09-native-harness-route-integrity.md).
  Deferred correctness program opened on 2026-06-30 after a valid OpenCode Go
  credential was misreported as invalid because bare OpenCode execution used an
  obsolete ambient model fallback. Scope is canonical native default
  projection, catalog validation, route-aware credential probes, and accurate
  cross-harness diagnostics.
- OS-pack packaging for web extraction and browser helpers.
  Deferred until controlled web primitives need platform-specific helper
  binaries or dependencies.
- Binary and PDF source artifacts for controlled web research.
  Deferred until research workflows need reliable PDF text extraction, OCR, or
  binary artifact handling.
- Native web research contract.
  Deferred until comparative research across papers, provider documentation,
  community practice, and cloned harness repositories justifies a first-class
  source-ranking, citation, extraction-evidence, recency, and budget contract
  over the existing controlled web primitives.
- Session evidence hardening.
  Deferred until provider/model/reasoning/authority provenance gaps appear in
  live surface traces or release validation, at which point the work should add
  inspectable session evidence instead of relying on transcript prose.
- Learning-based governance and routing.
  Deferred until there are enough real workflow traces, eval data, and stable
  runtime policies to justify machine-learned routing or governance advice.
- Full external benchmark expansion.
  Deferred until a stable product surface can support public benchmark claims
  without benchmark-only prompt paths, tool schemas, or authority shortcuts.
- Capability exposure research.
  Research how mature agent harnesses expose internal capabilities across
  operator commands, model-callable tools, resources, approvals, artifacts, and
  replay evidence. Include papers, web research, cloned harnesses, and community
  practice before deciding whether every durable agent-facing Kiln capability
  must provide a governed tool contract in addition to CLI and resource
  surfaces.
- Cross-domain task taxonomy.
  `clear-writing` is available as a governed built-in skill, but automatic
  admission should wait for a task taxonomy that can represent writing,
  editing, communication, education, support, and document workflows without
  overloading engineering task classes such as `research` or
  `mechanical-edit`. Research basis:
  `docs/research/20-cross-domain-task-taxonomy.md`.

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
- Native developer tool runtimes for repo search, globbing, JSON querying, and
  governed memory search.
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
