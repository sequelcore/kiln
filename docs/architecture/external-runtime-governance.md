# External Runtime Governance

## Purpose

External runtimes are MCP-connected execution targets whose state is owned
outside Kiln. Kiln governs their use through provider-neutral attachment,
authority, approval, evidence, recovery, and replay contracts. Vendor identity
and tool names do not create special governance paths.

This document is the canonical owner for external-runtime governance. Managed
child lifecycle remains owned by [Managed Agent Invocation](managed-agents.md),
work closeout remains owned by [Work Governance](work-governance.md), and human
presentation remains owned by [Operator Surfaces](operator-surfaces.md).

## Attachment Identity

`ManagedAgentExternalRuntimeAttachmentIdentity` identifies one physical target
with exactly:

- `kind: "external-runtime"`
- `runtimeId`
- `attachmentId`

The route capability snapshot and invocation request must carry the same
identity. Comparison is exact and opaque; whitespace normalization, discovery
heuristics, display labels, process identifiers, or vendor metadata must not
retarget an invocation. A missing or mismatched identity fails admission before
dispatch.

Parent and child attachment identity is explicit in canonical invocation
evidence. A parent cannot lend an ambient MCP connection or silently substitute
another attached instance during recovery.

## Authority And Approval

External-runtime tools are admitted through the managed route's explicit
authority profile. The profile names the allowed tool selectors and whether
write or network authority is available. MCP-only work does not acquire shell,
browser, filesystem-write, or ambient network authority merely because another
surface exposes those capabilities.

Model output never grants authority. Each approval-bound mutation requires a
canonical `approval_requested` event and its matching `approval_resolved`
event before execution. A retry is a new effect attempt and requires its own
approval when the action remains approval-bound.

## Evidence And Recovery

A successful tool process is not sufficient closeout evidence. Evidence must
match the work item's declared requirement and verification gate. Failed calls
cannot satisfy positive verification claims.

External-tool failures retain a structured, redacted diagnostic containing the
tool selector, failure category, attachment identity when safe, blocking
disposition, and operator-actionable summary. Raw provider payloads, secrets,
credentials, and operator-specific incident data are not canonical evidence.

Recovery is additive:

1. The failed attempt and its terminal outcome remain replayable.
2. The obsolete pause requirement is marked `superseded` and points to its
   successor.
3. The live successor remains blocking until qualifying evidence resolves it.
4. A successful retry records its own invocation, approval, tool, and terminal
   evidence.
5. Work and goal state become complete only after every evidence and
   verification obligation is satisfied.

Recovery does not rewrite a failed attempt as successful or erase its
diagnostic history.

## Canonical Projection

Runtime emits canonical session events. `@kilnai/gateway-contracts` owns replay
normalization, managed-invocation projection, and the
`projectOperatorGovernedWorkItems` merge and fail-closed disposition.

GUI, TUI, CLI, native, SDK, workspace home, transcript, replay, and future
surfaces consume those owners. A surface may format or summarize evidence, but
must not:

- infer attachment, authority, approval, or work disposition locally
- discard a failed attempt after recovery
- collapse distinct evidence categories into a positive claim
- report completion while the goal, work item, final prose, or terminal
  outcome remains blocked or failed

Unknown pause status, absent authority, and unrecognized work status are
blocking until canonical evidence resolves them.

## Deterministic Verification

The portable external-runtime governance fixture covers attachment, explicit
authority, approval, redacted failure, recovery, supersession, replay, and
terminal completion without a live provider or vendor dependency. Every
operator surface consumes that fixture and must agree on:

- the exact attachment and authority identity
- both failed and successful attempts
- resolved approvals for each admitted mutation
- preserved redacted failure evidence
- zero live pause requirements after recovery
- satisfied evidence and verification gates
- completed work, completed goal, successful final prose, and completed final
  turn outcome

Full workspace tests, typecheck, build, and findings-first security,
managed-agent, and cross-surface reviews are required before changing this
contract or declaring its roadmap complete.
