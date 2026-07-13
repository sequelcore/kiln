# Roadmap

This directory contains unfinished implementation tracks and explicit decision
boundaries. Stable behavior belongs in `docs/architecture/` and operator guides;
completed delivery evidence belongs in `docs/changelog.md` or a release record.

## Operating Model

Roadmap numbers are stable track identifiers, not execution priority. Do not
rename files when priorities change. The execution queue below is the canonical
answer to "what should be worked on next?"

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
| 1 | [06 - Cross-Harness Kiln Control Plane](./06-cross-harness-kiln-control-plane.md) | Acceptance | Restart Codex App and perform one bounded OpenCode Go managed-agent invocation through the Slice 3B MCP surface. | Slice 3B is implemented; live Codex App/OpenCode Go acceptance remains the sole admitted action. |
| 2 | [02 - Public Release UI Debt](./02-public-release-ui-debt.md) | Research | Define and verify cross-surface event-presentation density, then complete final live release validation. | Context usage is complete; CLI/TUI parity rules require evidence before shared event-density changes. |
| 3 | [01 - Native Operator Surface](./01-native-operator-surface.md) | Queued | Slice 3: workload fixture governance. | The slice is bounded to Gateway contracts and tests, but it is not a public-release truth blocker. |
| 4 | [04 - Verified Efficiency Control Plane](./04-verified-efficiency-control-plane.md) | Blocked | Resume Slice 3 telemetry, replay, and non-inferiority work. | Roadmap 06 must first define and verify the required cross-harness Kiln tool and agent exposure. |
| 5 | [05 - Skill Capability Plane](./05-skill-capability-plane.md) | Research | Define the provider-neutral skill evidence and admission contract before automatic operations or value promotion. | Inventory and repair evidence exist, but policy ownership and promotion evidence remain open. |

The TypeScript 7 migration is not an executable Kiln roadmap item while the
required Bun alias fix is unpublished. Its external dependency and follow-up
belong in the Sequel infrastructure debt register, not in this queue.

## Track Status

| Track | State | Current position | Next admissible action or trigger |
| --- | --- | --- | --- |
| [00 - Rust Module Optimization](./00-rust-module-optimization.md) | Guardrail | Rust/WASM/sidecar ownership and promotion gates are defined; no production module is admitted. | Start only from an approved module slice or ADR with parity and benchmark evidence. |
| [01 - Native Operator Surface](./01-native-operator-surface.md) | Queued | Slices 1 and 2 are complete. Slice 3 is specified and bounded. | Start Slice 3 after the public-release queue or an explicit reprioritization. |
| [02 - Public Release UI Debt](./02-public-release-ui-debt.md) | Research | Provider/model eligibility, Setup skill diagnostics, GUI foundations, and the context-usage projection are complete. Event-density parity and final live validation remain. | Define event-density parity before admitting implementation; retain final live validation debt. |
| [03 - Federated Harness Configuration Plane](./03-federated-harness-configuration-plane.md) | Deferred | No implementation is admitted. | Reopen only when capability matrices and projection benchmarks support thin or dynamic adapters. |
| [04 - Verified Efficiency Control Plane](./04-verified-efficiency-control-plane.md) | Blocked | Slices 0-2 are complete. Slice 3 implementation is paused; Slices 4-12 are not admitted. | Resume only after Roadmap 06 supplies the named cross-harness dependency and the Slice 3 verification plan is re-approved. |
| [05 - Skill Capability Plane](./05-skill-capability-plane.md) | Research | Inventory and local repair started; automatic admission, evaluation, and operations are not admitted. | Define the shared evidence/admission contract. GUI/TUI rendering of existing diagnostics remains owned by Roadmap 02. |
| [06 - Cross-Harness Kiln Control Plane](./06-cross-harness-kiln-control-plane.md) | Acceptance | Slices 0-2 and Slice 3B are implemented; full Slice 3 is not complete. | Restart Codex App and perform one bounded OpenCode Go managed-agent invocation through the new MCP surface. |

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
