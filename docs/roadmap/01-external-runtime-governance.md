# 01 - External Runtime Governance

Status: Active regression track
Execution: Ready - preserve the failing trace before changing policy.
Created: 2026-07-20

## Objective

Make governed execution correct for external runtimes whose admitted work and
verification capabilities are qualified MCP tools rather than shell, browser, or
repository filesystem tools.

## Ownership

This track owns provider-neutral evidence realization, external-runtime target
attachment, recovery, approval evidence, and canonical closeout consistency. It
does not own managed-job lifecycle or harness routing.

## Scope

- Capability-aware realization of required evidence.
- Explicit parent/child attachment identity.
- Recovery after managed rejection or failure.
- Agreement among work item, goal, session outcome, transcript, replay, and final prose.
- Approval and actionable failure evidence for external mutations.

## Non-Goals

- No vendor-specific governance branches.
- No ambient shell/browser authority for MCP-only routes.
- No weakening of delegation, approvals, or evidence requirements.
- No live vendor application dependency in deterministic CI.

## Ordered Slices

### Slice 0 - Failing Trace Fixture

Status: Ready.

Encode a deterministic MCP-only runtime fixture that proves the current hard
`bash` derivation, parent-success/canonical-failure disagreement, unsupported
positive claims from failed tools, missing approval events, and attachment drift.
The tests must fail before implementation changes.

### Slice 1 - Evidence Realization Contract

Status: Queued behind Slice 0.

Define one typed provider-neutral mapping from canonical evidence requirements
to admitted capability realizations. Preserve evidence identity and fail closed
when no qualifying realization exists.

### Slice 2 - Recovery And Terminal Consistency

Status: Queued behind Slice 1.

Bind recovery evidence to the original goal, work item, attempt, and attachment.
Define explicit supersession of obsolete failure evidence. Final-answer
eligibility must depend on canonical terminal state.

### Slice 3 - Cross-Surface Replay

Status: Queued behind Slice 2.

Prove GUI, TUI, CLI, SDK, and replay agree; preserve redacted server/tool failure
identity; require approval request/resolution events; retain one thread identity.

## Promotion Gates

- Generic repository workflows retain existing shell/test/browser requirements.
- MCP-only work completes only with attached qualifying evidence.
- Failed calls cannot support positive verification claims.
- Recovery never erases the failed attempt from replay.
- No duplicate work-item, route, attachment, or replay owner is introduced.

## Verification

Focused governance, managed-route, Runtime, Gateway-contract, GUI/TUI, replay,
and existing MCP suites; workspace typecheck; `git diff --check`; findings-first
security and cross-surface review.

## Completion Criteria

The fixture fails before and passes after the implementation; external-runtime
work can close without unrelated authority; every surface and final answer agree
with canonical state; stable doctrine moves to architecture.
