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

Status: Threads 2, 3, and 4 closed. Thread 5 (attachment drift) remains open
for Slice 3, as scoped by Slice 1's status note.

Delivered three independent fixes, all keyed off `mcp:<server>:<kind>:<name>`,
the pre-existing provider-neutral MCP dispatch-namespace convention (already
used for MCP client routing in `packages/core/src/mcp/index.ts:144` and the
tool executor's own `mcpClients` lookup) — not a vendor-specific branch:

1. **Thread 4 closed** — `packages/runtime/src/session/runtime-session-orchestrator-tool-executor.ts`,
   `resolveAuthorization()`. When a tool name is `mcp:`-namespaced and has
   neither a static `toolAuthority` entry nor a `toolAuthorizer` configured,
   it now falls back to the canonical `deriveAuthorityFromEffect()` policy
   (`packages/core/src/engine/domain/action-effect.ts`) instead of returning
   `undefined` and letting the caller skip authorization entirely. Because a
   genuinely unregistered MCP capability has no live approval channel able to
   grant an interactive approval, the `requestApproval` callback signature
   gained an optional `hasLiveAuthoritySource` parameter
   (`hasConfiguredAuthoritySource()` on the executor); when false, the new
   `RuntimeSessionApprovalGate.requestImmediateDenial()`
   (`runtime-session-orchestrator-approvals.ts`) still emits the full
   `approval_requested`/`approval_received` event pair for replay/audit, then
   resolves as denied immediately rather than leaving a pending approval
   nothing can ever answer. Builtin/dev tool names are untouched (no `mcp:`
   prefix, no fallback triggered) — zero risk to the existing builtin-tool
   authorization surface. Closes
   `packages/runtime/tests/session/runtime-session-orchestrator-tools.test.ts`,
   "requires approval for an unregistered external-runtime mutation instead of
   executing it unchecked" (flipped from `it.fails`).

2. **Thread 3 closed** — `packages/runtime/src/session/governed-turn-outcome.ts`,
   new `hasMcpSelectorWithNoSuccessfulExecution()` check inside
   `deriveGovernedTurnOutcomeFromToolRecords()`: any `mcp:`-namespaced selector
   attempted at least once and never once successful in the turn now marks the
   outcome non-`"completed"`. This is a deliberately **separate, order-insensitive**
   check (group by exact selector, require zero successes per group) rather than
   folding `mcp:` names into the existing `isWorkGovernanceToolName()` terminal
   fallback, which was the first implementation and was wrong: that fallback
   picks the *latest* matching execution, so merging the two would let a
   trailing successful MCP call mask an earlier failed governance-tool call
   (fail-open — caught by an independent Opus design-debate review before this
   was called done, not by the test suite; the original merged-filter version
   passed the full 2918-test suite and would only have been caught by an
   adversarial ordering nobody had written yet). Two permanent regression tests
   guard both directions of that ordering failure (`does not let a trailing
   successful MCP call mask an earlier failed governance-tool call`, `does not
   flag a selector that failed once and then succeeded, regardless of call
   order`), each verified to fail against the reverted merged-filter version
   before being trusted. Closes
   `packages/runtime/tests/session/governed-turn-outcome.test.ts`, "does not
   let four failed external-runtime navigation calls produce a completed
   outcome" (flipped from `it.fails`).

3. **Thread 2 closed** — `packages/runtime/src/session/runtime-session-orchestrator-response.ts`,
   `finalizeRuntimeSessionResponse()` now prepends a canonical-state qualifier
   `ContentPart` ahead of the model's own `parts` when the computed outcome is
   `"failed"` (not `"paused"` or `"cancelled"` — a budget-exhaustion pause is an
   ordinary continuation, not a prose/canonical disagreement) **and** the turn
   contains an unrecoverable managed-invocation blocking failure (new
   `hasUnrecoverableManagedInvocationFailure()` in `governed-turn-outcome.ts`:
   a blocking failure with no `managedInvocationRecovery` metadata at all, so
   the parent had no supervised path forward and no awareness of it when
   producing its final text). The original prose is kept, not discarded, so
   operators retain it for diagnosis. Scope is deliberately narrower than "any
   non-completed outcome": every other `"failed"` outcome already flowing
   through this codebase (unresolved governed-work materialization, a
   managed-invocation recovery still in progress, deterministic retry
   exhaustion, ...) is reported through text written by the orchestrator or the
   model *with knowledge of* that specific failure, by construction of the call
   site producing it — confirmed by running the full
   `runtime-session-orchestrator-tools.test.ts` suite, which regressed 10 then
   5 pre-existing exact-text assertions under a naive "qualify every
   non-completed outcome" version of this fix before landing on the
   `hasUnrecoverableManagedInvocationFailure` scoping (mirroring the Slice 1
   lesson that only full-suite runs catch this class of breakage). The
   qualification is computed and applied to `session.addAssistantMessage()`
   *before* the transcript write, not only to the returned value — an
   independent Opus design-debate review caught that the first implementation
   qualified only the returned response while conversation history (and
   therefore transcript/replay) kept the raw unqualified claim, which would
   have manufactured exactly the surface/transcript divergence Slice 3 must
   prove absent. A permanent regression test
   (`reconciles the transcript, not just the returned response, so replay
   agrees with the surface`) guards this, verified to fail against the
   response-only version before being trusted. Closes
   `packages/runtime/tests/session/runtime-session-orchestrator-response.test.ts`,
   describe "finalizeRuntimeSessionResponse (Roadmap 01 Slice 0)" (flipped from
   `it.fails`).

Process note: an independent Opus subagent design-debate review (matching the
Slice 1 precedent) was run *after* an initial implementation of Threads 2-4
already passed the full test suite. It found the Thread 3 fail-open inversion
and the Thread 2 transcript-divergence bug above — neither had a failing test
until new adversarial tests were written specifically to reproduce them. Both
are now fixed and covered. It also flagged, as non-blocking, that the `mcp:`
gate in Thread 4's `resolveAuthorization()` fallback exists because governance
tools (`work_governance.assess`, `goal.*`, `work_item.*`,
`managed_agent.invoke`) currently have no declared effect envelope — not
because builtin/dev tools are inherently safe to run unchecked; documented
in-code as a follow-up (give governance tools declared envelopes, then delete
the `mcp:` namespace check and apply the fallback universally). Also flagged,
not acted on for this slice: two downstream consumers of `OrchestrateResult.parts`
(`packages/runtime/src/gateway/openai-responses-model-turn.ts`'s
per-text-part-message mapping, and `message-pipeline.ts`'s grounding-verification
input) may need an explicit decision about how a prepended synthetic part
should be treated; no existing test exercises this interaction and the narrow
`hasUnrecoverableManagedInvocationFailure` scope makes it rare, but Slice 3
(cross-surface replay) should verify it explicitly rather than discover it in
production.

Verified across the whole affected surface: `@kilnai/core` 290 files/3573
tests, `@kilnai/cli` 1519 tests (two pre-existing, unrelated failures
confirmed via `git stash` before this work began — `tests/tools-command.test.ts`
and a flaky order-dependent failure in `tests/commands/run-builtin-tools.test.ts`
that reproduces on the unmodified base commit and passes in isolation),
`@kilnai/runtime` 219 files/2921 tests (3 new regression tests added for the
two debate-caught bugs) plus 1 expected-fail (thread 5, correctly still open
in `packages/runtime/tests/gateway/managed-invocation-tool.test.ts`), typecheck
clean across `gateway-contracts`, `core`, `runtime`, `sdk`, `cli`, `tui`,
`native`.

Not attempted in this slice: attachment propagation/selection for a managed
child (Thread 5) and explicit supersession-with-dual-replay for a superseded
admission gate were deferred to Slice 3.

### Slice 3.1 - External Runtime Attachment Identity

Status: Closed. Thread 5 (attachment drift) and Roadmap 01 issue #6 closed
when PR #8 merged into `codex/cross-harness-gateway`; tracker #5 remains open
for the remaining Slice 3 work below.

Made external-runtime attachment identity explicit, provider-neutral, and
enforced at the canonical admission gate — "which physical external-runtime
instance a managed child must drive," distinct from
`ManagedAgentCallerAttachmentIdentity` ("who called Kiln", unchanged). New
sibling type `ManagedAgentExternalRuntimeAttachmentIdentity` in
`packages/core/src/agents/managed-invocation/index.ts` (`kind:
"external-runtime"`, `runtimeId`, `attachmentId` — exactly three fields, no
discovery/version/pid metadata). A route's declared attachment
(`ManagedInvocationToolRoute.externalRuntimeAttachment`, property of the
physical target, not any one admission profile) is compared against a
dispatch's requested attachment by one exported comparator,
`compareManagedAgentExternalRuntimeAttachment`, used only inside the single
fail-closed gate `evaluateManagedAgentAdmission` — the same gate every
dispatch path traverses (`managed_agent.invoke`, `.start`, and
`.orchestrate`, since orchestrate's children route through
`RuntimeManagedAgentInvocationService.start()` like every other path). Both
absent admits unchanged (zero behavior change for the hundreds of existing
routes that never declare an attachment); route declares/request omits
denies `externalRuntimeAttachment.missing`; both present and equal admits;
both present and unequal denies `externalRuntimeAttachment.mismatch`;
request declares/route doesn't denies
`externalRuntimeAttachment.unsupported-route`. `managed_agent.invoke` and
`.start` share one `ToolDefinition`, so one schema addition
(`externalRuntimeAttachment: { runtimeId, attachmentId }`, both required,
`additionalProperties: false`) gives parity by construction; `parseInput`
validates the object strictly — unknown keys or a blank/whitespace-only field
are rejected with an explicit error, never silently dropped (closes the
`additionalProperties: false` is advisory-only gap: JSON Schema constrains
the model's tool call, not the runtime). `managed_agent.orchestrate` has no
input surface to request an attachment yet (deliberately out of scope —
expressing it through orchestrate's own input contract is separate,
sequenced work) but still fails closed: the selected route's declared
attachment is surfaced into `runOrchestrationBatch`'s
`capabilitySnapshotInput`, so a route attached to a specific instance denies
every orchestrated child with `externalRuntimeAttachment.missing` instead of
silently dispatching unattached. The attachment is additive through the
existing evidence/replay surfaces with zero projection changes
(`ManagedAgentCapabilitySnapshot`/`Input`, `ManagedAgentLifecycleEvidence` +
`buildManagedAgentLifecycleEvidence` for terminal events,
`snapshotInputFromAdmission` for recovery re-admission,
`projectManagedInvocationCapabilitySnapshotResources` already spreads),
declarable from real route configuration
(`KilnManagedAgentRouteConfig.externalRuntimeAttachment` →
`packages/cli/src/config/managed-agent-routes.ts`, not just test fixtures),
and additively declared on the operator/SDK projection contract
(`OperatorManagedAgentCapabilitySnapshot.externalRuntimeAttachment` /
`.callerIdentity` in `gateway-contracts/src/frames.ts`, mirrored types to
avoid a `@kilnai/core` dependency).

Deliberately not touched: `ManagedAgentCallerAttachmentIdentity` (different
producer, lifetime, consumer, and cardinality — extending it would have
forced a policy hole in `evaluateManagedInvocationCallerCapability`'s `kind`
switch), `ManagedAgentResultHandoff` (attachment belongs to the invocation
record, not child-authored output), `resource-projection.ts`,
`caller-capability-policy.ts`, MCP client routing (`runtimeId` reuses the
existing `mcp:<server>:…` namespace convention only), discovery/active-
instance-switching/defaulting-to-the-sole-attached-instance (absence must
stay absent — F7; this is deliberately different from the existing caller-
identity default, which is unchanged), and Roadmap 02 managed-job lease/
account lifecycle.

Residual risks carried forward, not fixed in this slice: the tool-surface
top-level input schema remains `additionalProperties: false` (advisory only)
outside the `externalRuntimeAttachment` object itself — only that one nested
object gets strict runtime validation; the existing caller-identity default
synthesis (`normalizeManagedInvocationAttachment` fabricating a
`kiln-runtime` caller identity when none is configured) is unchanged and
orthogonal; `managed_agent.orchestrate` still has no input surface to
express a requested attachment (fails closed via the core gate, but cannot
yet succeed against an attached route); and Slice 1's
`evidenceRealizations` route-config-unreachability precedent (closed here
for `externalRuntimeAttachment` specifically, not retroactively fixed for
`evidenceRealizations`).

Verified: `@kilnai/gateway-contracts` 28 files/259 tests,
`@kilnai/core` 289/290 files pass (3578/3580 tests — 2 pre-existing,
unrelated `verified-efficiency-v1` publication-readiness digest-mismatch
failures confirmed via `git stash` before this work began),
`@kilnai/runtime` 219 files/2942 tests (includes 19 new behavioral tests
replacing the flipped `it.fails` attachment-drift regression, plus a new
orchestrate fail-closed test in `orchestration-lifecycle.test.ts`),
`@kilnai/cli` 150/152 files pass (1518/1519 tests — 1 pre-existing,
unrelated `verified-efficiency-v1` digest-mismatch failure plus one
pre-existing flaky unhandled rejection in `run-builtin-tools.test.ts`, both
confirmed via `git stash` before this work began), typecheck clean across
`gateway-contracts`, `core`, `runtime`, `sdk`, `cli`, `tui`, `native`.

### Slice 3 - Cross-Surface Replay

Status: Slice 3.3 complete. Final Roadmap 01 promotion and closeout remain
bounded to issue #25.

Delivered one synthetic portable session fixture that retains explicit
external-runtime attachment identity, a redacted failed external-tool call, a
superseded recovery requirement and its live successor, approval request and
resolution, an active goal, failed terminal outcome, and non-contradictory
assistant prose. Canonical transcript normalization now preserves that evidence
instead of reducing replay to managed-invocation lifecycle events.

`projectOperatorGovernedWorkItems` is the single cross-surface work-item merge
and fail-closed disposition owner. It distinguishes omitted fields in partial
execution snapshots from explicitly empty fields, treats unknown pause status
as pending, treats absent or unknown authority as blocking, and preserves
separate missing-evidence, goal-evidence, verification-gate, failed-gate, and
residual-risk categories. GUI, TUI, native, CLI, SDK, workspace home, and
canonical replay consume that owner. CLI list/status and GUI/TUI/native
presentation retain attachment, actionable redacted failure evidence, and
per-work-item blocking detail.

Verification completed for Slice 3.3:

- `@kilnai/gateway-contracts`: 28 files, 266 tests.
- `@kilnai/sdk`: 10 files, 69 tests.
- `@kilnai/gui`: 51 files, 500 tests.
- `@kilnai/tui`: 8 files, 57 tests.
- `@kilnai/native`: 4 files, 48 tests.
- `@kilnai/cli`: the full suite passes deterministically with the known
  high-contention `run-builtin-tools.test.ts` isolated to one worker (39/39);
  all remaining CLI tests pass with two workers.
- Workspace typecheck and `git diff --check` pass.
- Findings-first managed-agent and cross-surface reviews report no unresolved
  high or medium findings.

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
