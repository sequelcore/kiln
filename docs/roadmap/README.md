# Roadmap

This directory contains unfinished implementation tracks and explicit decision
boundaries. Stable behavior belongs in `docs/architecture/` and operator guides;
completed delivery evidence belongs in `docs/changelog.md` or a release record.

## Operating Model

Roadmap numbers are stable while a track is active, but they are not execution
priority. When a completed track is removed, close the numeric gap atomically
across filenames, headings, links, and textual references. The execution queue
below is the canonical answer to "what should be worked on next?"

Every track has one execution state:

| State | Meaning |
| --- | --- |
| Ready | A bounded next item is admitted and can start without a missing dependency. |
| Queued | The item is sequenced, but higher-priority work should close first. |
| Research | Evidence or contract design is required before implementation admission. |
| Blocked | A named dependency, approval, or promotion gate prevents progress. |
| Deferred | The track is intentionally inactive until its documented trigger occurs. |
| Guardrail | The document defines an admission boundary; it is not implementation work by itself. |

Slice numbers are local to their track. A completed higher-numbered slice does
not make an unstarted lower-numbered slice implicitly complete, and an
unstarted slice is not automatically admitted merely because it appears next
in a file.

## Execution Queue

The queue is ordered by product risk, dependency value, and bounded delivery
cost. Only the first `Ready` item is the default next task. Starting another
item requires an explicit priority decision recorded here.

| Order | Track | State | Bounded work item | Admission reason |
| --- | --- | --- | --- | --- |
| 1 | [02 - Public Release UI Debt](./02-public-release-ui-debt.md) | Ready | Live-validate Slices 0-2 and the first Slice 4 execution-evidence vertical before admitting `Plan` or `Confirmation`. | Activity ownership, empty-assistant removal, source-owned `Task`, and structured paused-execution `Tool` output pass automated gates; operator validation is the remaining promotion evidence. |
| 2 | [06 - External Runtime Governance Fixture](./06-external-runtime-governance-fixture.md) | Ready | Slice 0: encode the deterministic MCP-only failing trace before changing evidence capability derivation. | Live dogfood proved that hard shell/browser evidence requirements can reject a capable external-runtime route and leave final prose inconsistent with failed canonical state. |
| 3 | [05 - Cross-Harness Kiln Control Plane](./05-cross-harness-kiln-control-plane.md) | Ready | Slice 4C: finish per-job managed account leases and lifecycle evidence, then live-prove the OpenCode provider vertical. | The 2026-07-22 checkpoint closes supervisor, usage, MCP, and additive OpenCode projection foundations without activating native pickers. |
| 4 | [01 - Native Operator Surface](./01-native-operator-surface.md) | Queued | Slice 3: workload fixture governance. | The slice is bounded to Gateway contracts and tests, but it is not a public-release truth blocker. |
| 5 | [04 - Skill Capability Plane](./04-skill-capability-plane.md) | Research | Define the provider-neutral skill evidence and admission contract before automatic operations or value promotion. | Recursive resource projection and the user-global frontend catalog cleanup are complete; policy ownership and promotion evidence remain open. |
| 6 | [07 - Prompt Governance Plane](./07-prompt-governance-plane.md) | Queued | Slice 1: persist final-request effective-prompt evidence and expose one content-free operator inspection contract. | The manifest/request-evidence foundation is complete; event and surface work is sequenced behind higher-priority Ready tracks. |
| 7 | [08 - Stack Governance Plane](./08-stack-governance-plane.md) | Research | Slice 0: define read-only React/Vite, Astro, workspace, and compatibility-exception fixtures. | Organization stack baselines currently live in prose and can drift from package manifests without shared CLI, CI, or agent evidence. |

The TypeScript 7 migration is not an executable Kiln roadmap item while the
required Bun alias fix is unpublished. Its external dependency and follow-up
belong in the Sequel infrastructure debt register, not in this queue.

The `3.0.0-beta.1` prerelease is a candidate, not a completed release. Its
13-package graph and `beta` publish route are implemented. Tagging remains
blocked until the Roadmap 02 operator live-validation gate closes, npm trusted
publishing is configured, and the exact committed candidate passes the
cross-platform [release runbook](../operations/release.md). Kiln `2.1.0`
remains the supported public package line until registry verification succeeds.

## Track Status

| Track | State | Current position | Next admissible action or trigger |
| --- | --- | --- | --- |
| [00 - Rust Module Optimization](./00-rust-module-optimization.md) | Guardrail | Rust/WASM/sidecar ownership and promotion gates are defined; no production module is admitted. | Start only from an approved module slice or ADR with parity and benchmark evidence. |
| [01 - Native Operator Surface](./01-native-operator-surface.md) | Queued | Slices 1 and 2 are complete. Slice 3 is specified and bounded. | Start Slice 3 after the public-release queue or an explicit reprioritization. |
| [02 - Public Release UI Debt](./02-public-release-ui-debt.md) | Ready | Immediate work-experience Slices 0-2 and the first Slice 4 Tool/Task execution-evidence vertical are implemented; staged adoption and final live validation remain. | Live-validate rotate/pulse ownership, real streaming, tool continuity, Task presentation, and paused work-item output before admitting the next component slice. |
| [03 - Federated Harness Configuration Plane](./03-federated-harness-configuration-plane.md) | Deferred | No implementation is admitted. | Reopen only when capability matrices and projection benchmarks support thin or dynamic adapters. |
| [04 - Skill Capability Plane](./04-skill-capability-plane.md) | Research | Inventory, recursive projection repair, and frontend catalog consolidation are complete; automatic admission, evaluation, and operations are not admitted. | Define the shared evidence/admission contract. GUI/TUI rendering of existing diagnostics remains owned by Roadmap 02. |
| [05 - Cross-Harness Kiln Control Plane](./05-cross-harness-kiln-control-plane.md) | Ready | Slices 0-3 are complete. The 2026-07-22 checkpoint adds provider-usage evidence, user-scoped gateway supervision/autostart, a harness-neutral MCP bridge, and a health-gated OpenCode projection foundation. Managed per-job leases, operator activation, Codex composite picker, and Claude live proof remain open. | Resume Slice 4C, then apply and live-prove Slice 7B OpenCode before starting the higher-risk Codex composite picker. |
| [06 - External Runtime Governance Fixture](./06-external-runtime-governance-fixture.md) | Ready | A live MCP-only external-runtime trace is diagnosed and the deterministic fixture contract is bounded. | Implement Slice 0 as failing tests without widening route authority or adding vendor-specific policy. |
| [07 - Prompt Governance Plane](./07-prompt-governance-plane.md) | Queued | Slice 0 is complete: typed manifests, exact Runtime prompt authority, redacted request evidence, compact doctrine, and the optional action-first skill. | Start Slice 1 only after higher-priority Ready work closes or the queue is explicitly reprioritized. |
| [08 - Stack Governance Plane](./08-stack-governance-plane.md) | Research | Desired-state ownership, drift semantics, and agent-tool boundaries are documented; no implementation is admitted. | Build the Slice 0 read-only fixtures after higher-priority Ready work closes or an explicit reprioritization. |

## Roadmap File Standard

Every numbered roadmap file must use this shape:

1. File name: `NN-kebab-case-title.md`.
2. H1: `# NN - Title`.
3. Metadata: `Status`, `Execution`, and `Created` or `Started` when known.
4. Required sections: `Objective`, `Goals`, `Scope`, `Non-Goals`, delivery
   slices, promotion gates, verification, and completion criteria. Add a
   research basis when evidence is required.
5. Every active track names one next admissible action or states the exact
   blocker or trigger.
6. Sequel standards remain explicit: no dead code, no legacy hacks, no
   duplicate owners, no prompt-only fixes, no unsupported compatibility shims,
   and no untested completion claims.

When a slice starts, closes, blocks, or changes dependency, update both its
track and this index in the same change. Do not keep a second active plan that
duplicates this queue.

## Admission Rules

- Scout code and canonical architecture before admitting implementation.
- Keep one bounded concern per task; do not combine adjacent queue entries.
- Prefer shared contracts over GUI-, TUI-, CLI-, provider-, or harness-local
  policy.
- Record dependencies as `Blocked`; do not leave them hidden inside prose.
- Record evidence-only work as `Research`; do not imply production admission.
- Promote stable behavior into architecture or guides when it closes.
- Remove completed roadmap tracks after their durable doctrine and useful
  delivery evidence have been promoted.
- Do not start live native benchmarks, native UI, dispatch, gateway attach,
  Rust/WASM/sidecar modules, or automatic skill operations without their named
  promotion gates.

## Canonical References

- [Work Governance](../architecture/work-governance.md) for admission,
  delegation, verification, and closeout.
- [Engineering Standards](../architecture/engineering-standards.md) for Clean
  Architecture, parity, native boundaries, and verification.
- [Operator Surfaces](../architecture/operator-surfaces.md) and
  [Execution Surfaces](../architecture/execution-surfaces.md) for surface
  ownership.
- [Provider Model Discovery](../architecture/provider-model-discovery.md) for
  route eligibility and stale discovery evidence.
- [Harness Integration Capabilities](../architecture/harness-integration-capabilities.md)
  and [Config Projection](../architecture/config-projection.md) for native
  projection and setup health.
- [Managed Agents](../architecture/managed-agents.md),
  [Work Governance](../architecture/work-governance.md), and
  [Context Resource Plane](../architecture/context-resource-plane.md) for
  invocation authority, evidence, replay, and resources.
- [Native Operator Surface](../architecture/native-operator-surface.md) and
  [Benchmark Validation](../architecture/benchmark-validation.md) for native
  benchmark promotion gates.
- [Changelog](../changelog.md) for completed public delivery history.

## Deferred Backlog

These ideas are not admitted roadmap work:

- OS-pack packaging for web extraction or browser helpers, until controlled web
  primitives require platform-specific binaries.
- Binary/PDF extraction, OCR, and a native web-research contract, until real
  workflows justify their evidence and citation contracts.
- Session-evidence hardening, until live traces expose a concrete provenance
  gap.
- Learning-based governance and routing, until enough stable workflow traces
  and eval data exist.
- Full external benchmark expansion, until the product surface can support
  public claims without benchmark-only paths.
- Capability-exposure research, until a bounded product decision requires a
  unified tool/resource/approval contract.
- Automatic cross-domain task taxonomy admission, until the research in
  [Cross-Domain Task Taxonomy](../research/20-cross-domain-task-taxonomy.md) is
  promoted into a provider-neutral contract.
