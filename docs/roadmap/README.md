# Roadmap

This directory contains active and deferred implementation tracks only.
Completed programs are promoted into stable architecture, guide, or changelog
documentation instead of being archived here.

## How To Read This Roadmap

- Active roadmap files describe scoped work that is still in progress.
- Deferred items wait for a clear product or architecture trigger.
- Completed implementation history belongs in `docs/changelog.md`.
- Durable behavior belongs in canonical architecture and guide docs.
- The status matrix below is the current progress index. Update it whenever a
  roadmap slice starts, closes, defers, or changes owner.

## Roadmap File Standard

Every numbered roadmap file uses this professional shape unless a deeper
architecture program needs additional sections:

1. File name: `NN-kebab-case-title.md`.
2. H1: `# NN - Title`.
3. Metadata block: `Status:` plus `Started:` or `Created:` when known.
4. Required sections: `Objective`, `Goals`, `Scope`, `Non-Goals`, `Research
   Basis` when evidence exists or is required, `Delivery Slices` or equivalent
   implementation slices, `Promotion Gates`, `Verification`, and `Completion
   Criteria`.
5. Sequel standards must be explicit when a roadmap could invite shortcuts:
   no dead code, no legacy hacks, no duplicate owners, no prompt-only fixes, no
   untested completion claims, and no unsupported compatibility shims.

## Roadmap Status Matrix

| File | Status | Current Progress | Next Action |
| --- | --- | --- | --- |
| [00-rust-module-optimization.md](./00-rust-module-optimization.md) | Active boundary | Rust/WASM/sidecar ownership boundaries are defined. No production Rust slice is admitted yet. | Start only from an approved module slice or ADR with parity and benchmark evidence. |
| [01-native-operator-surface.md](./01-native-operator-surface.md) | Active benchmark-validation track | Slices 1 and 2 are complete. Slice 3, workload fixture governance, is next. | Implement Slice 3 before any live native or browser benchmark execution. |
| [02-public-release-ui-debt.md](./02-public-release-ui-debt.md) | Active release debt | Release-blocking GUI debt remains open. Provider/model eligibility is now canonicalized; remaining items are narrowed to public-release UX truth, skill/plugin diagnostics, event density, context usage, and live validation. | Close fake or unavailable operator-facing states before public release. |
| [03-federated-harness-configuration-plane.md](./03-federated-harness-configuration-plane.md) | Deferred research | Waiting for cross-harness capability matrices and projection benchmarks. | Reopen only when evidence supports thin or dynamic native adapters. |
| [04-verified-efficiency-control-plane.md](./04-verified-efficiency-control-plane.md) | Active; Slice 1 complete | Slice 1 closed on 2026-07-01 in commit `f1f4baef`. The former research-turn budgeting roadmap is merged here as the initial workload. Slice 2 is next; Slices 3 through 12 are planned. | Start Slice 2, stable prefix and cache topology, with no behavior-changing optimization before evidence. |
| [05-trusted-execution-integrity.md](./05-trusted-execution-integrity.md) | Active; Slice 4 complete | Doctor, CLI config/status reads, Gateway contracts, GUI setup, TUI setup, and operator workspace health now project the shared permission-integrity aggregate without treating UI selection as runtime proof. | Start Slice 5 canonical documentation and closure. |

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

0. [Rust Module Optimization](./00-rust-module-optimization.md)
   Active on 2026-05-17. Scope is the Rust optimization boundary:
   Bun/TypeScript owns control-plane semantics while Rust/WASM/sidecars enter
   as measured module hot paths or native helpers behind TypeScript-owned ports
   that consume shared contracts.

1. [Native Operator Surface](./01-native-operator-surface.md)
   Active on 2026-05-15. Scope is the native operator surface benchmark path:
   contract-only runner admission, orchestration planning, workload
   governance, and approval evidence before live browser or native benchmark
   execution.

2. [Public Release UI Debt](./02-public-release-ui-debt.md)
   Active on 2026-06-28. Scope is release-blocking GUI debt discovered during
   live validation, starting with the composer context usage indicator. The
   provider-model eligibility plane is complete and canonicalized; this
   roadmap now owns only the remaining public-release UX truth, skill/plugin
   diagnostics, event-density, context-usage, and final live-validation debt.
   The GUI must not publish with a fake context percentage or an unavailable
   state presented as authoritative.

4. [Verified Efficiency Control Plane](./04-verified-efficiency-control-plane.md)
   Active long-term architecture program opened on 2026-06-30. Slice 1 closed
   on 2026-07-01 in commit `f1f4baef`; the former research-turn budgeting
   roadmap is merged here as the first measured workload; Slice 2 is next.
   Scope is the
   provider-neutral control loop that maximizes verified engineering value per
   token, dollar, second, and agent turn through attributable measurement,
   bounded efficiency actuators, and evidence-gated policy promotion.

5. [Trusted Execution Integrity](./05-trusted-execution-integrity.md)
   Active on 2026-07-01. Slices 1 and 2 are complete: the provider-neutral
   permission evidence contract, classification precedence, finite vocabulary
   parity, operator-local trust boundary, and native projection evidence for
   Codex, Claude Code, and OpenCode are in place before managed-agent and
   operator-surface work.

## Deferred Roadmaps

- [Federated Harness Configuration Plane](./03-federated-harness-configuration-plane.md).
  Deferred until cross-harness capability matrices and projection benchmarks
  can justify replacing selected full projections with thin or dynamic native
  adapters without weakening standalone operation or governance.
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
- Cross-harness read-only managed invocation adapters with shared native versus
  adapter support status, fail-closed external caller admission, and no native
  projection of unsupported provider/model strings.
- Work governance, plan mode, goal execution, and evidence-gated closeout.
- Config projection, native harness projection, and governed config mutation.
- Agent context, instruction profiles, skills, and repo shims.
- Memory Lattice, memory lifecycle policy, and context resource projection.
- Provider credential pooling and provider/model discovery.
- Provider-model eligibility plane: raw catalog evidence preservation, runtime
  adapter normalization, canonical interactive and managed-agent eligibility,
  Gateway projection, and GUI/TUI/CLI render-only operator selection.
- Native harness route integrity: canonical default projection for supported
  native harnesses, managed-field ownership for native `model`, credential-safe
  route evidence, ambient fallback mismatch classification, and cross-surface
  config/status diagnostics.
- Operator-surface startup discovery staging and stale provider diagnostics.
- Controlled web research, browser/computer use, and tool execution.
- Native developer tool runtimes for repo search, globbing, JSON querying, and
  governed memory search.
- Multimodal artifact transport and capability-aware route admission.
- Agent QA showcase recorder.
- External benchmark validation platform.
- CLI answer/json output contracts for exact-format evals and benchmark
  harnesses.
- CLI package test harness stability: deterministic single-worker Vitest
  execution, verbose workspace-filter diagnostics, bounded test/hook/teardown
  stalls, and hermetic default package verification.
- Native operator surface foundation and embedded browser operator capability.
- Native operator surface projection foundation with defer/no-promotion status.
- Execution surfaces convergence: shared Operator Workspace home projection,
  gateway target switcher, target-aware resource inspector, SDK/CLI resource
  reads, and cross-surface documentation closeout.
- Session feedback pipeline: local redacted feedback bundles, safe runtime
  evidence selection, contract-backed surface previews, explicit issue-provider
  approval, governed repair work-item materialization, and local draft
  pull-request metadata gates.

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
   roadmap slice or ADR and the Rust module promotion gates in `00`.
