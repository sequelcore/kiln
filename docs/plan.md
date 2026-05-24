# Slice 6F - Governed Feedback Repair Work Items

## Objective

Close the remaining Slice 6 feedback/repair integration by converting
explicitly approved local feedback bundles into governed repair work item
inputs. The repair path must reuse the existing work-governance lifecycle,
evidence, and verification gate model instead of creating a second repair
engine.

## Decision

Add a core-owned feedback repair materializer under work governance. It accepts
a redacted `FeedbackBundle`, explicit local approval evidence, risk hypothesis,
file impact, and verification criteria, then returns a `WorkItemUpsertInput`
that can be stored in the existing `WorkItemStore`.

## Non-Goals

- Do not create a repair runner, PR branch workflow, or network adapter.
- Do not bypass work-item evidence, review, or residual-risk closeout.
- Do not add legacy aliases, migration shims, or surface-local repair state.
- Do not publish feedback outside the local approved bundle contract.

## Surface Map

- Feedback contract:
  - `packages/core/src/feedback/index.ts`
- Work governance:
  - `packages/core/src/work-governance/feedback-repair.ts`
  - `packages/core/src/work-governance/work-item.ts`
  - `packages/core/src/work-governance/index.ts`
- Tests:
  - `packages/core/tests/feedback/session-feedback.test.ts`
- Roadmap:
  - `docs/roadmap/01-background-parallel-agent-surface.md`
  - `docs/roadmap/03-session-feedback-pipeline.md`
  - `docs/roadmap/README.md`

## Expected Behavior

- Approved local feedback bundles materialize as pending `feedback-repair`
  work items on the `session-feedback` surface.
- Repair work items carry source feedback id, approval actor/time/resource
  pointers, risk hypothesis, file impact, verification criteria, and route or
  authority hints when provided.
- Required evidence includes the feedback bundle, explicit approval, risk
  hypothesis, file impact, verification criteria, tests, typecheck,
  managed-agent review, and residual risk.
- Repair metadata is redacted before being attached to work governance.
- Missing approval, file impact, or verification criteria fails closed before
  a work item can be created.

## Verification

- Add failing tests first for conversion, redaction, and fail-closed criteria.
- Run `bun run --cwd packages/core test -- tests/feedback/session-feedback.test.ts`.
- Run adjacent work-governance tests.
- Run `bun run typecheck`.
- Run `bun run --cwd packages/core test`.
- Update roadmap docs at the end.
