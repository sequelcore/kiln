# 01 - External Runtime Governance

Status: Active regression track
Execution: Ready - preserve the failing trace before changing policy.
Created: 2026-07-20

## Objective

Make governed execution correct for external runtimes whose admitted work and
verification capabilities are qualified MCP tools rather than shell, browser, or
repository filesystem tools.

The initiating operator surface, managed route, work item, goal, transcript,
and final outcome must agree about authority, evidence, and completion. A model
must not report success while the canonical work item or session remains failed
or blocked.

## Incident Basis

A live Roblox Studio dogfood session exposed the bounded regression this track
closes. The vendor-specific integration is evidence, not a product special case.

- Session: `kiln-gui:_gui:ac1df67e-bf07-44f2-8f31-615cef792ae6:1784487944365`.
- The parent admitted qualified Studio MCP inspection, mutation, playtest,
  capture, console, and navigation capabilities.
- Work governance correctly required orchestration for high-risk,
  cross-surface, verification-heavy work.
- The managed implementation phase converted generic `tests` and `typecheck`
  evidence into a hard `bash` requirement even though the selected route was
  intentionally MCP-only, so managed execution failed admission before the
  child could work.
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
- Continuity metadata attributed one thread's runtime summary to another
  thread and emitted duplicated thread-key prefixes.

This is a control-plane consistency defect. It is not fixed by granting the
route ambient shell access or by weakening managed-route admission.

## Ownership

This track owns provider-neutral evidence realization, external-runtime target
attachment, recovery, approval evidence, and canonical closeout consistency. It
does not own managed-job lifecycle or harness routing.

## Scope

- Capability-aware realization of required evidence, derived from the target
  surface and admitted route capabilities, not only from generic evidence
  labels.
- Provider-neutral external-runtime verification capability contracts that
  represent compile/load checks, console cleanliness, playtest, visual
  observation, interaction, and hierarchy inspection without pretending they
  are shell tests or browser QA.
- Explicit parent/child external-runtime attachment identity through managed
  invocation, approval, execution, transcript, and replay. Reject dispatch
  with an attachment-mismatch diagnostic rather than heuristically retargeting.
- Recovery after managed rejection or failure, allowed only when its concrete
  evidence is attached to the same work item and supersedes or closes obsolete
  failure evidence through an explicit transition.
- Agreement among work item, goal, session outcome, transcript, replay, and
  final prose; prevent a success final answer when canonical state remains
  failed or blocked, and reject or qualify final claims that depend only on
  failed tool calls.
- Approval and actionable failure evidence for external mutations: persist
  approval lifecycle evidence for every approval-bound external mutation
  regardless of GUI authority selection, and preserve actionable redacted
  external-tool failures in transcript and status evidence.
- GUI/TUI/CLI presentation of the same canonical blocked or completed state.

## Non-Goals

- No vendor-specific governance branches or Roblox tool-name branches in core
  governance.
- No ambient shell/browser authority for MCP-only routes merely to satisfy a
  generic evidence label.
- No weakening of delegation, approvals, or evidence requirements.
- No trusting MCP descriptions or annotations as authority.
- No treating screenshots or clean console output as proof of unexercised
  gameplay.
- No live vendor application dependency in deterministic CI.

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

## Ordered Slices

### Slice 0 - Failing Trace Fixture

Status: Complete. All 5 named regressions encoded as failing tests. Ready to
promote to Slice 1.

All five named regressions are encoded as deterministic `it.fails` tests (no
live vendor dependency), each traced to an exact root cause rather than
asserted from the incident narrative alone. Each currently fails as intended
and must flip to a plain `it` once its fix lands; the full suite stays green
throughout (`packages/runtime`: 2914 passed, 5 expected fail, typecheck
clean):

1. **Hard `bash` derivation rejects the otherwise capable route** -
   `packages/runtime/tests/gateway/managed-invocation-tool.test.ts`, describe
   block "external-runtime MCP-only route capability (Roadmap 01 Slice 0)".
   Root cause: `work-governance-tool.ts`'s `requiredToolNamesForPhaseEvidence`
   (`packages/cli/src/application/work-governance-tool.ts:2009-2028`)
   unconditionally adds `bash` for `tests`/`typecheck` evidence with no
   awareness of route capability; `runtime-tool.ts`'s
   `missingManagedInvocationRequiredTools` then rejects any route whose
   admitted tools don't literally include `bash`.
2. **A parent success message can disagree with failed canonical state** -
   `packages/runtime/tests/session/runtime-session-orchestrator-response.test.ts`,
   describe block "finalizeRuntimeSessionResponse (Roadmap 01 Slice 0)". Root
   cause: `governed-turn-outcome.ts` correctly computes `outcome: "failed"` for
   an unresolved managed-invocation blocking failure, but
   `finalizeRuntimeSessionResponse` (`runtime-session-orchestrator-response.ts`)
   returns the free-text `parts` completely unchanged regardless of `outcome`
   - nothing reconciles the two.
3. **Failed calls cannot support a positive verification claim** -
   `packages/runtime/tests/session/governed-turn-outcome.test.ts`, test "does
   not let four failed external-runtime navigation calls produce a completed
   outcome". Root cause: `isWorkGovernanceToolName` only recognizes the fixed
   governance tool set; a parent's own direct external-runtime tool calls
   (e.g. `navigate_actor`) are invisible to outcome derivation regardless of
   success, so repeated failures never surface as a non-"completed" outcome.
4. **Missing mutation-approval events are observable** -
   `packages/runtime/tests/session/runtime-session-orchestrator-tools.test.ts`,
   test "requires approval for an unregistered external-runtime mutation
   instead of executing it unchecked". Root cause:
   `runtime-session-orchestrator-tool-executor.ts`'s `resolveAuthorization`
   returns `undefined` when neither a static `toolAuthority` entry nor a
   `toolAuthorizer` covers a tool name; the caller's approval branch is
   `if (authResult)`-gated, so an undefined result skips approval entirely
   instead of failing closed - exactly the gap a live-discovered MCP tool
   name an operator never pre-registered falls into.
5. **Attachment drift** -
   `packages/runtime/tests/gateway/managed-invocation-tool.test.ts`, test
   "lets managed_agent.invoke express which external-runtime instance a
   dispatch must target". Root cause: `MANAGED_AGENT_INVOKE_TOOL`'s input
   schema has no field for an external-runtime target/instance identifier at
   all, and its top-level `additionalProperties: false` means a caller cannot
   even attempt to pass one; a managed child has no way to receive, require,
   or verify which physical external-runtime instance it must target, and
   dispatch has no way to reject an attachment mismatch. Grounded in current
   production practice, not invented: reviewed 2026-07-24, official and
   community Roblox Studio MCP servers already solve multi-instance routing
   with an explicit per-call instance identifier (e.g.
   `list_roblox_studios`/`set_active_studio`, or an `instance_id` parameter).

### Slice 1 - Evidence Realization Contract

Status: Thread 1 closed (the hard `bash` derivation regression from Slice 0);
threads 2-5 remain open for Slices 2/3.

Delivered: `resolveEvidenceRealization` in `@kilnai/core`
(`packages/core/src/work-governance/evidence-realization.ts`) — a typed,
provider-neutral mapping from evidence requirements to admitted capability
realizations, strictly opt-in per route via a new
`ManagedInvocationRouteProfile.evidenceRealizations` field. A route that
declares nothing keeps its exact pre-Slice-1 behavior (`requiredToolNames`
alone governs admission, unchanged). A route that declares a realization for
an evidence id gets it resolved against its own admitted tools instead of a
context-free default; a declared-but-unsatisfied realization fails closed
with a precise `capability_pause` (never silently falls through to the
generic default behind the route's back — closes the drift risk between
`allowedToolNames` and `evidenceRealizations`). `KilnWorkGovernanceEvidence`
moved from `@kilnai/cli` to `@kilnai/core` (with a re-export for existing CLI
imports) since both `@kilnai/cli` and `@kilnai/runtime` need the same stable
evidence identity and runtime must not depend on cli.

This closes Slice 0's first regression precisely:
`packages/runtime/tests/gateway/managed-invocation-tool.test.ts`'s
"admits an MCP-only route for tests/typecheck evidence instead of
hard-requiring bash" now passes for real (flipped from `it.fails`). Verified
across the whole affected surface: `@kilnai/core` 290 files/3573 tests,
`@kilnai/cli` 1519 tests (one pre-existing, unrelated failure confirmed via
`git stash` before this work began), `@kilnai/runtime` 219 files/2915 tests
plus 4 expected-fail (threads 2-5, correctly still open), typecheck clean
across all three packages.

Deliberately out of scope for this pass: threads 2 (parent-success/
canonical-failure disagreement) and 3 (failed calls supporting positive
claims) belong to Slice 2 - Recovery And Terminal Consistency; thread 4
(missing approval events) and attachment drift (thread 5) belong to Slice 2's
attachment-identity work and Slice 3's cross-surface replay respectively.
Fixing them here would have been scope creep past what this slice is
chartered to do.

### Slice 2 - Recovery And Terminal Consistency

Status: Queued behind Slice 1.

Bind recovery evidence to the original goal, work item, attempt, and
attachment. Define explicit supersession of obsolete failure evidence, and when
a failed admission gate may be superseded while retaining both events in
replay. Propagate or explicitly select the external-runtime attachment for a
child; do not let the child heuristically target a different or absent
instance. Fail closed when recovered evidence is incomplete. Final-answer
eligibility must depend on canonical terminal state.

### Slice 3 - Cross-Surface Replay

Status: Queued behind Slice 2.

Prove GUI, TUI, CLI, SDK, and replay agree; preserve redacted server/tool
failure category and identity; require approval request/resolution events for
approval-bound mutations; assert continuation summaries retain one canonical
thread identity without duplicated key prefixes; verify list/status calls
cannot lose or contradict a work item within the same canonical session.

## Promotion Gates

- No vendor-specific capability names in governance policy.
- No authority widening for the managed route or parent recovery.
- Generic repository workflows retain existing shell/test/browser requirements.
- MCP-only work completes only with attached qualifying evidence; otherwise
  every surface reports the same blocked result.
- Failed calls cannot support positive verification claims.
- Recovery never erases the failed attempt from replay; a failed managed
  attempt remains replayable after valid recovery.
- No duplicate work-item, route, attachment, or replay owner is introduced.
- Parent and child external-runtime attachment identity is explicit and
  replayable.
- Every approval-bound mutation has a corresponding canonical approval event.
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
- Existing MCP, work-governance, managed-agent, Runtime, CLI, GUI, and TUI
  suites remain green; workspace typecheck; `git diff --check`; findings-first
  security and cross-surface review.

## Completion Criteria

The fixture fails before the implementation and passes afterward. MCP-only
external runtimes can declare strong executable verification without
acquiring unrelated shell or browser authority. Parent recovery cannot bypass
required delegation or evidence attachment. Final prose, canonical outcome,
work-item state, goal state, and replay agree. External-tool failures retain
enough redacted detail for an operator to act. External-runtime work can close
without unrelated authority; stable doctrine moves to architecture
documentation and this roadmap track is removed or advanced according to the
roadmap operating model.
