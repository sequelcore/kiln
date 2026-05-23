# Slice 4D Plan - Governed Orchestration Work Items

## Objective

Attach managed orchestration mode contracts to governed work items so child
work is not just lifecycle evidence. Each materialized child work item must
carry the mode expected evidence, merge policy, isolation policy, and a Slice 6
adoption gate when the orchestration mode requires parent adoption.

## Surface Map

- Core work governance:
  - `packages/core/src/work-governance/work-item.ts`
  - `packages/core/src/work-governance/work-item-materializer.ts`
  - `packages/core/src/work-governance/index.ts`
- Tests:
  - `packages/core/tests/work-governance/work-item-materializer.test.ts`
  - `packages/core/tests/managed-agent/orchestration-contracts.test.ts`
- Roadmap:
  - `docs/roadmap/01-background-parallel-agent-surface.md`
  - `docs/roadmap/README.md`

## Risk Hypothesis

- If orchestration evidence stays only on managed invocation records, governed
  work items cannot enforce per-mode handoff or later adoption requirements.
- Merge and adoption policy must remain data on the work item, not hidden CLI
  behavior, so Slice 6 can consume the same contract.
- Budget admission should not be faked. Budget-aware CLI fan-out must fail
  closed when no live usage source is available or every eligible route is over
  budget; a full runtime/session budget plane remains a follow-up.

## Implementation Steps

1. Add work-item orchestration metadata for child identity, mode, expected
   evidence, isolation, merge policy, and Slice 6 adoption gating.
2. Add a deterministic materializer that converts a typed managed orchestration
   request into governed child work items.
3. Encode required orchestration evidence as work-item expected evidence,
   including merge policy evidence and adoption-gate evidence when required.
4. Prove fan-out does not force adoption while decomposition blocks closeout
   until a structured adoption resolution exists.
5. Update roadmap status and remaining Slice 4 work.

## Verification

- `bun run --filter @kilnai/core test -- tests/work-governance/work-item-materializer.test.ts`
- `bun run --filter @kilnai/core test -- tests/managed-agent/orchestration-contracts.test.ts`
- `bun run typecheck`
- `bun run --filter "*" build`
- `git diff --check`

## Residual Risk

- CLI fan-out now fails closed for budget-aware routing when usage data is
  unavailable or all eligible routes are over budget. The remaining Slice 4
  follow-up is replacing the CLI usage hook with the runtime/session budget
  plane once that plane is exposed.
- Adoption-required orchestration items now have a structured
  `managedOrchestrationAdoption` resolution path. Ordinary child
  `providedEvidence` cannot self-satisfy `managed-orchestration:adoption-gate`.
