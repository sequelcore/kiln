## Slice 7G - Partial Write Evidence Resource Parity

## Objective

Continue Slice 7 by making partial write evidence replayable across the
managed-agent resource plane and shared operator cockpit projection.

## Decision

Treat `writeEvidence.resourceUris` as managed invocation evidence pointers.
Runtime already emits these pointers from CLI/direct adapter write detection,
including timed-out children with partial writes. Shared projections should
aggregate the pointers alongside transcript, handoff, diagnostics, memory
proposal, and lease evidence without reading diff contents or creating a
surface-local partial-success lifecycle state.

## Non-Goals

- Do not change managed child lifecycle states or attention states.
- Do not expose raw diffs, filesystem contents, or full runtime records.
- Do not add compatibility aliases for older evidence shapes.
- Do not add a separate partial-success control plane.

## Surface Map

- Runtime resource provider:
  - `packages/runtime/src/agents/managed-invocation/resource-provider.ts`
  - `packages/runtime/tests/managed-agent/resource-provider.test.ts`
- Shared operator cockpit projection:
  - `packages/gateway-contracts/src/operator-cockpit-projection.ts`
  - `packages/gateway-contracts/tests/operator-cockpit-projection.test.ts`
- Roadmap:
  - `docs/roadmap/01-background-parallel-agent-surface.md`

## Expected Behavior

- Aggregate managed invocation resource reads include valid
  `writeEvidence.resourceUris` in the de-duplicated `resourceUris` bundle.
- Per-child managed invocation detail and `/resources` reads expose the same
  pointer-only resource bundle.
- Gateway cockpit invocation projections include `writeEvidence.resourceUris`
  in `evidenceResourceUris`.
- Duplicate write evidence pointers that also appear in handoff resources are
  emitted once.

## Verification

- Add failing focused tests first.
- Run `bun run --cwd packages/runtime test -- tests/managed-agent/resource-provider.test.ts`.
- Run `bun run --filter @kilnai/gateway-contracts test -- tests/operator-cockpit-projection.test.ts`.
- Run `bun run typecheck`.
- Run `bun run build`.
- Run `bun run test`.
- Run `git diff --check`.
- Update the roadmap after code verification.
