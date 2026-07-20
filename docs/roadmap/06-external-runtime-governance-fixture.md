# 06 - External Runtime Governance Fixture

Status: New regression-fixture track.
Execution: Ready - add the deterministic failing fixture before changing capability or closeout policy.
Created: 2026-07-20.

## Objective

Make governed execution correct for external runtimes whose admitted work and
verification capabilities are MCP tools rather than repository shell, browser,
or filesystem tools.

The initiating operator surface, managed route, work item, goal, transcript,
and final outcome must agree about authority, evidence, and completion. A model
must not report success while the canonical work item or session remains failed
or blocked.

## Incident Basis

A live Roblox Studio dogfood session exposed the bounded regression. The
vendor-specific integration is evidence, not a product special case.

- Session: `kiln-gui:_gui:ac1df67e-bf07-44f2-8f31-615cef792ae6:1784487944365`.
- The parent admitted qualified Studio MCP inspection, mutation, playtest,
  capture, console, and navigation capabilities.
- Work governance correctly required orchestration for high-risk,
  cross-surface, verification-heavy work.
- The managed implementation phase converted generic `tests` and `typecheck`
  evidence into a hard `bash` requirement even though the selected route was
  intentionally MCP-only.
- Managed execution therefore failed admission before the child could work.
- The parent then used the admitted external-runtime tools directly, created
  the prototype, edited scripts, ran playtests, inspected the hierarchy and
  console, and returned a human-readable success message.
- Canonical state did not adopt that evidence: the managed attempt retained a
  failed admission gate, stale skipped verification results, an active goal,
  and a failed session outcome.
- All four external navigation calls failed, but the final answer claimed that
  navigation to two objectives succeeded.
- The managed child could not discover the external runtime attachment that
  the parent used successfully immediately before and after the child ran.
- Six external mutations have no replayable approval-request or
  approval-resolution event despite approval-bound configuration.
- Repeated external navigation failures were preserved only as generic MCP
  execution failures, limiting diagnosis and replay value.
- Continuity metadata attributed one thread's runtime summary to another thread
  and emitted duplicated thread-key prefixes.

This is a control-plane consistency defect. It is not fixed by granting the
route ambient shell access or by weakening managed-route admission.

## Goals

- Derive verification requirements from the target surface and admitted route
  capabilities, not only from generic evidence labels.
- Represent external-runtime equivalents for compile/load checks, console
  cleanliness, playtest, visual observation, interaction, and hierarchy
  inspection without pretending they are shell tests or browser QA.
- Keep route identity and qualified MCP selectors explicit through managed
  invocation, approval, execution, transcript, and replay.
- Bind a managed child to the same explicit external-runtime target as its
  parent, or reject dispatch with an attachment-mismatch diagnostic.
- Allow local recovery only when its concrete evidence is attached to the same
  work item and supersedes or closes obsolete failure evidence through an
  explicit transition.
- Prevent a success final answer when the canonical turn, goal, work item, or
  required evidence remains failed or blocked.
- Reject or qualify final claims that depend only on failed tool calls.
- Persist approval lifecycle evidence for every approval-bound external
  mutation regardless of GUI authority selection.
- Preserve actionable redacted external-tool failures in transcript and status
  evidence.

## Scope

- Work-governance phase decomposition and `requiredToolNames` derivation.
- Provider-neutral external-runtime verification capability contracts.
- Managed-route capability matching for qualified MCP selectors.
- External-runtime target/attachment propagation into managed children.
- Parent recovery after managed invocation rejection or failure.
- Work-item, goal, session-outcome, transcript, and replay consistency.
- Approval and continuation attribution across GUI threads.
- GUI/TUI/CLI presentation of the same canonical blocked or completed state.

## Non-Goals

- Add Roblox tool-name branches to core governance.
- Trust MCP descriptions or annotations as authority.
- Give MCP-only routes `bash`, filesystem, browser, or network authority merely
  to satisfy a generic evidence label.
- Treat screenshots or clean console output as proof of unexercised gameplay.
- Depend on a live Roblox Studio process in deterministic CI.
- Weaken approvals for arbitrary external-runtime mutation.

## Fixture Contract

Create a deterministic in-repository MCP fixture server with an external
runtime catalog equivalent to:

```text
mcp:external-runtime:tool:inspect_tree
mcp:external-runtime:tool:apply_scene_edit
mcp:external-runtime:tool:edit_script
mcp:external-runtime:tool:start_stop_test
mcp:external-runtime:tool:observe_runtime
mcp:external-runtime:tool:read_console
mcp:external-runtime:tool:navigate_actor
```

The managed route admits only those qualified selectors. It has no `bash`,
filesystem, browser, or general network tools. Mutation remains approval-bound.

The fixture must reproduce a high-risk, cross-surface work item whose generic
policy requests `tests`, `typecheck`, visual/runtime evidence, managed review,
and residual-risk closeout. Its deterministic runtime can return successful and
failed tool results without launching a vendor application. The parent and
child receive explicit attachment ids so the fixture can prove both matching
and mismatched target behavior.

## Delivery Slices

### Slice 0 - Failing Trace Fixture

State: Ready.

- Encode the MCP-only route, external runtime, work item, managed invocation,
  parent recovery, and final-outcome trace.
- Prove the current hard `bash` derivation rejects the otherwise capable route.
- Prove a parent success message can currently disagree with failed canonical
  execution state.
- Prove failed navigation cannot support a positive navigation claim.
- Prove missing mutation-approval events and cross-thread attribution are
  observable regressions.
- Preserve the failure as executable tests before implementation changes.

### Slice 1 - Capability-Aware Evidence Mapping

State: Queued behind Slice 0.

- Introduce one provider-neutral contract for evidence requirements and
  acceptable capability realizations.
- Keep canonical evidence ids stable while allowing explicit, policy-owned
  surface realizations.
- Reject missing realizations with a precise capability pause; never silently
  substitute weaker evidence.

### Slice 2 - Recovery And Closeout Consistency

State: Queued behind Slice 1.

- Bind parent recovery evidence to the original goal, work item, attempt, and
  failed managed invocation.
- Define when a failed admission gate may be superseded and retain both events
  in replay.
- Propagate or explicitly select the external-runtime attachment for a child;
  do not let the child heuristically target a different or absent instance.
- Fail closed when recovered evidence is incomplete.
- Make final answer eligibility depend on canonical terminal state.

### Slice 3 - Cross-Surface Replay And Diagnostics

State: Queued behind Slice 2.

- Verify GUI, TUI, CLI, SDK, and replay project the same terminal result.
- Preserve actionable redacted MCP failure category and server/tool identity.
- Require approval request/resolution evidence for approval-bound mutations.
- Assert continuation summaries retain one canonical thread identity without
  duplicated key prefixes.
- Verify list/status calls cannot lose or contradict a work item within the
  same canonical session.

## Promotion Gates

- No vendor-specific capability names in governance policy.
- No authority widening for the managed route or parent recovery.
- The original MCP-only scenario completes only with attached qualifying
  evidence; otherwise every surface reports the same blocked result.
- A failed managed attempt remains replayable after valid recovery.
- Parent and child external-runtime attachment identity is explicit and
  replayable.
- Every approval-bound mutation has a corresponding canonical approval event.
- Failed tool calls cannot be cited as successful verification evidence.
- Generic repository workflows still require their existing shell, typecheck,
  test, and browser evidence.
- Security, managed-agent, and cross-surface reviews report no unresolved high
  or medium findings.

## Verification

- Focused unit tests for phase decomposition and evidence realization.
- Managed direct-provider adapter tests with qualified MCP selectors.
- Runtime integration tests for managed rejection, local recovery, approval,
  and terminal closeout.
- Gateway-contract and GUI/TUI projection tests for blocked/completed parity.
- Deterministic transcript replay asserting goal, work item, attempt, session,
  and final-answer consistency.
- Existing MCP, work-governance, managed-agent, runtime, CLI, GUI, and TUI
  suites remain green.

## Completion Criteria

- The fixture fails before the implementation and passes afterward.
- MCP-only external runtimes can declare strong executable verification without
  acquiring unrelated shell or browser authority.
- Parent recovery cannot bypass required delegation or evidence attachment.
- Final prose, canonical outcome, work-item state, goal state, and replay agree.
- External-tool failures retain enough redacted detail for an operator to act.
- Stable doctrine is promoted to architecture documentation and this roadmap
  track is removed or advanced according to the roadmap operating model.
