# Managed Handoff Recovery Plan

Date: 2026-05-29
Status: Closed on 2026-05-29

## Objective

Fix the governed managed-invocation failure path found in the GUI live session:
a child completed without substantive handoff evidence, Kiln produced recovery
instructions, and the parent did not record evidence or restart execution. The
fix must keep evidence gates strict, support local frontend reference repos, and
make timeout or no-handoff states replayable and actionable across surfaces.

## Non-Goals

- No bypass for `handoff_not_substantive`.
- No weakening of visual-reference evidence validation.
- No request-local timeout shim or hidden retry loop.
- No legacy compatibility branch for old transcript shapes.
- No GUI redesign in this repair slice.

## Implementation Slices

1. TDD: governed outcome regression - closed
   - Add coverage in
     `packages/runtime/tests/session/governed-turn-outcome.test.ts` proving
     `managed_agent.invoke` with `handoff_not_substantive` and
     `managedInvocationRecovery.nextTool = work_item.update` remains failed
     until the matching work item records the required evidence.

2. TDD: local frontend-reference evidence - closed
   - Add coverage in
     `packages/cli/src/application/work-governance-tool.test.ts` proving local
     repository frontend evidence from `C:/Proyectos/Sequel/t1code` or
     `C:/Proyectos/Sequel/vllm-studio` is accepted only when it cites concrete
     frontend paths and code-backed UI principles.
   - Update managed visual-reference phase routing so local code-backed
     reference research can use read/glob-style tools instead of being forced
     through web-only tooling.

3. TDD: direct-provider no-handoff summary - closed
   - Add coverage in
     `packages/runtime/tests/managed-agent/direct-runtime-adapter.test.ts`
     proving an empty child final response records a bounded, actionable
     no-handoff summary and replayable transcript pointer.
   - Keep runtime substantive-evidence validation strict so this state still
     becomes `handoff_not_substantive` at the managed tool boundary.

4. Runtime and CLI implementation - closed
   - Update the outcome classifier in
     `packages/runtime/src/session/governed-turn-outcome.ts`.
   - Update direct runtime handoff summary handling in
     `packages/runtime/src/agents/managed-invocation/direct-runtime-adapter.ts`
     and strict no-handoff detection in
     `packages/runtime/src/agents/managed-invocation/runtime-tool.ts`.
   - Update visual-reference evidence/tool requirements in
     `packages/cli/src/application/work-governance-tool.ts`.

5. Documentation and research closeout - closed
   - Record timeout/retry design implications from AWS, Google, Microsoft,
     Google Cloud, OpenAI Agents SDK, Anthropic SDK guidance, and tail-latency
     papers in the roadmap closeout.
   - Update `docs/roadmap/README.md` after verification.

6. TDD: direct child execution replay evidence - closed
   - Add coverage in
     `packages/runtime/tests/managed-agent/direct-runtime-adapter.test.ts`
     proving direct-provider children with tool execution evidence or empty
     final output expose a bounded `child-execution` managed resource.
   - Preserve bounded model-facing summaries while making the child stop
     reason, token usage, tool calls, tool outputs, and empty final-output state
     replayable through `resource_read`.

7. TDD: deterministic no-handoff blocking path - closed
   - Add coverage in
     `packages/runtime/tests/gateway/managed-invocation-tool.test.ts` proving
     non-substantive visual-reference child handoffs include a
     `blockedWorkItemUpdateInputTemplate`.
   - Keep `workItemUpdateInputTemplate` as the happy recovery path only after
     real evidence exists; when transcript/source-resource inspection still
     cannot qualify evidence, the parent must block the work item with an
     unresolved pause requirement instead of replying with a generic failure.

8. Runtime execution contract propagation - closed
   - Add `stopReason` to the runtime orchestration result and propagate provider
     stop reasons through normal and fallback child turns.
   - Persist direct child execution replay resources from the direct runtime
     adapter without changing remote harness contracts or adding compatibility
     shims.

9. Review findings closeout - closed
   - Preserve `blockedWorkItemUpdateInputTemplate` and `blockedWhen` through
     gateway-contract cockpit projection and view-state.
   - Project `handoff_not_substantive` as failed managed-child attention instead
     of completed cockpit status.
   - Add targeted fallback `stopReason` coverage and public `resource_read`
     coverage for child-execution replay resources.

10. TDD: route-owned managed request recovery - closed
    - Add CLI coverage proving visual-reference managed invocation requests are
      route-owned and explicitly forbid `agentProfile` injection.
    - Add runtime coverage proving route/profile conflicts remain fail-closed
      while returning a structured `retryInputTemplate` that omits
      `agentProfile`, preserves work/goal/phase context, and records
      `forbiddenInputFields`.
    - Keep adapters uninvoked and child lifecycle events absent when admission
      fails before route identity is coherent.

11. TDD: route-owned canonicalization after GUI retry loop - closed
    - Add CLI coverage proving visual-reference phase requests with an explicit
      phase route do not carry stale caller-supplied `managedModel` hints from
      the write route.
    - Add attached-runtime coverage proving route-owned paused requests keep
      `agentProfile` absent when `forbiddenInputFields` forbids it, while
      hydrating the provider model from the selected route catalog.
    - Add attached-runtime coverage proving route-owned paused requests also
      drop caller-supplied stale provider models when the selected route uses
      the provider default model.
    - Add runtime coverage proving `managed_agent.invoke` canonicalizes a
      supplied forbidden `agentProfile` before route/profile validation, starts
      the selected route-owned child once, and records canonicalization
      evidence without admitting the forbidden profile into child identity.

12. TDD: managed child state-transition guard after GUI stress closeout - closed
    - Add runtime coverage for the latest GUI failure mode: after
      `managed_agent.invoke` returns `handoff_not_substantive` with
      `phase_evidence_required`, parent final text is rejected until the work
      item records qualifying evidence or an explicit blocked pause state.
    - Add runtime coverage for the sibling successful-child path:
      `managedInvocationPhaseCompletion` with `nextTool: "work_item.update"`
      also blocks final text until the phase evidence is recorded.
    - Add fail-closed runtime coverage for exhausted tool rounds while a
      managed child state transition is pending.
    - Add GUI store coverage so `turn_completed` events with
      `outcome: "failed"` render with error tone instead of success tone.
    - Keep timeout behavior bounded and explicit: no hidden retry loops, no
      compatibility shims, and no final response persisted while the governed
      state transition is unresolved.

13. TDD: managed invocation transition reserve after GUI live failure - closed
    - Add runtime coverage for the latest GUI failure mode from
      `.kiln/sessions/kiln-gui%3A_gui%3A0eb1c062-b0bb-4d8e-bd71-a461a33f06e8%3A1780052576091`:
      the parent consumed the normal tool-round budget inspecting managed-child
      and local frontend-reference evidence, then had no remaining round to
      record the required `work_item.update` recovery transition.
    - Add exactly one managed-invocation transition-only reserve round after
      normal tool rounds are exhausted while a `managedInvocationRecovery` or
      `managedInvocationPhaseCompletion` state transition is still pending.
    - In the reserve round, expose and execute only the required next work-item
      tool. Non-transition tools are returned as blocked tool results, and a
      missing or unadmitted transition tool fails closed with
      `managed_invocation_state_transition_required`.
    - Add coverage for evidence transition success, blocked pause transition
      success, wrong-tool blocking, phase-completion reserve success, missing
      transition-tool admission, and the absence of a false max-rounds error
      after a successful reserve.
    - Close reviewer finding by tracking all unresolved managed-invocation
      transitions in execution order. A later resolved child transition can no
      longer hide an earlier unresolved child transition in the same parent
      turn.
    - Keep runtime ownership clean: no automatic work-item writes, no hidden
      retries, no larger generic tool budget, and no placeholder evidence.

14. TDD: no-tools fallback protocol boundary after direct-child no-handoff - closed
    - Add runtime coverage for the latest GUI failure mode from
      `.kiln/sessions/kiln-gui%3A_gui%3A4ee1ae9f-586c-4839-bef4-7f4fdf858135%3A1780081054547`:
      the child direct-provider invocation exhausted the useful child turn,
      returned `stop_reason: "tool_calls"` with no final handoff text, and the
      parent had to block instead of treating the child output as evidence.
    - Harden the runtime no-tools fallback boundary so fallback responses that
      still contain tool calls, tool-like stop reasons, or empty text are not
      executed, retried, or classified as substantive final answers.
    - Add an explicit no-tools finalization prompt after normal tool rounds are
      exhausted, and emit deterministic stop reasons:
      `tool_rounds_exhausted` for max-round finalization failure and
      `no_tool_finalization_failed` for repeated malformed tool-call fallback
      failure.
    - Preserve the direct managed adapter as a projection boundary. It records
      the orchestrator result, child stop reason, token usage, and tool
      execution evidence as replay resources, and prefixes these deterministic
      finalization failures with the existing no-handoff summary so the managed
      tool boundary still returns `handoff_not_substantive`.
    - Keep timeout/tool-loop ownership clean: no hidden repair provider call,
      no automatic work-item write, no unbounded retry, no legacy transcript
      compatibility branch, and no success-like handoff when the child failed
      to produce final evidence.

## Verification

- `bun test packages/core/tests/work-governance/frontend-reference-evidence.test.ts packages/runtime/tests/gateway/managed-invocation-tool.test.ts packages/gateway-contracts/tests/operator-cockpit-projection.test.ts packages/gateway-contracts/tests/operator-cockpit-view-state.test.ts packages/cli/src/application/work-governance-tool.test.ts packages/runtime/tests/session/governed-turn-outcome.test.ts packages/runtime/tests/managed-agent/direct-runtime-adapter.test.ts`
- `bun run --filter @kilnai/core test`
- `bun run --filter @kilnai/gateway-contracts test`
- `bun run --filter @kilnai/cli test`
- `bun run --filter @kilnai/runtime test`
- `bun run typecheck`
- `bun test packages/runtime/tests/managed-agent/direct-runtime-adapter.test.ts`
- `bun test packages/runtime/tests/gateway/managed-invocation-tool.test.ts`
- `bun test packages/gateway-contracts/tests/operator-cockpit-projection.test.ts packages/gateway-contracts/tests/operator-cockpit-view-state.test.ts`
- `bun test packages/runtime/tests/session/runtime-session-orchestrator-tools.test.ts --test-name-pattern "preserves stop reason"`
- `bun test packages/runtime/tests/managed-agent/resource-provider.test.ts --test-name-pattern "direct child execution evidence"`
- `bun test packages/cli/src/application/work-governance-tool.test.ts --test-name-pattern "scopes managed UI work"`
- `bun test packages/runtime/tests/gateway/managed-invocation-tool.test.ts --test-name-pattern "explicit route contradicts"`
- `bun test packages/cli/src/application/work-governance-tool.test.ts --test-name-pattern "scopes managed UI work"`
- `bun test packages/runtime/tests/gateway/attached-runtime-tool-surface.test.ts --test-name-pattern "does not attach an agent profile"`
- `bun test packages/runtime/tests/gateway/managed-invocation-tool.test.ts --test-name-pattern "canonicalizes forbidden agentProfile"`
- `bun run --cwd packages/runtime test tests/session/runtime-session-orchestrator-tools.test.ts`
- `bun run --cwd packages/gui test tests/session-store.test.ts`
- `bun run --filter @kilnai/gui test`
- `bun run --filter @kilnai/gateway-contracts test`
- `bun run --cwd packages/runtime test tests/session/runtime-session-orchestrator-tools.test.ts`
- `bun run typecheck`
- `bun run --cwd packages/runtime test tests/session/runtime-session-orchestrator-tools.test.ts`
- `bun run typecheck`
- `bun test packages/runtime/tests/session/runtime-session-orchestrator-tools.test.ts --test-name-pattern "tool budget"`
- `bun test packages/runtime/tests/session/runtime-session-orchestrator-tools.test.ts --test-name-pattern "repeated-malformed fallback"`
- `bun test packages/runtime/tests/managed-agent/direct-runtime-adapter.test.ts --test-name-pattern "exhausted direct-provider tool loops"`
- `bun run --filter @kilnai/runtime test`
- `bun run typecheck`
- `bun run --cwd packages/runtime test tests/gateway/tui-gateway-clear.test.ts`
- `bun run --cwd packages/core test tests/orchestrator/orchestrator-field-runtime.test.ts`
- `bun run test`
- `bun run build`
- `git diff --check`

## Closeout Notes

The parent model can still choose not to follow structured recovery, so the
repair makes that condition impossible to misclassify as success. A
`handoff_not_substantive` child result remains blocked until the governed phase
records matching evidence with `work_item.update`, and GUI/TUI/CLI cockpit
projection now carries the recovery action as review attention.

Timeout handling stays route-owned. This slice records timeout budgets,
timeout source, replayable diagnostics, and no-handoff summaries instead of
adding hidden retries or request-local timeout shims.

The 2026-05-29 follow-up closes the remaining GUI live-session recovery gap:
the transcript pointer alone is no longer the only artifact after a direct
child produces no final handoff. Direct-provider children now emit a bounded
child-execution replay resource whenever the final output is empty or child
tools ran. No-handoff visual-reference recovery also gives the parent an
explicit blocked work-item update template for the case where source-resource
inspection and local recovery still cannot produce qualifying evidence. That
keeps the workflow fail-closed without recording placeholder evidence or
continuing the governed execution.

The latest 2026-05-29 GUI session did not reach child admission: the parent
retried a route-owned visual-reference request while adding `agentProfile`,
which contradicted the explicit route id. That is now fail-closed with a
machine-readable recovery payload. `work_item.execution.start` marks the
route-owned request with `forbiddenInputFields: ["agentProfile"]`, and
`managed_agent.invoke` returns `status: "route_profile_conflict"` plus a
preserved retry template that removes `agentProfile` without weakening
route/profile validation or starting a child.

The later 2026-05-29 GUI stress session
`.kiln/sessions/kiln-gui%3A_gui%3A8d0f06a4-6189-47d1-96ff-bcc1beb51e37%3A1780046728980`
showed the remaining loop: a route-owned retry template omitted
`agentProfile`, but the attached request path could still re-materialize a
matching catalog profile from `routeId`, and the request also carried a stale
write-route model into the read-only visual-reference phase. That is closed by
canonicalizing route-owned requests at the runtime boundary. Forbidden
`agentProfile` input has no semantic effect before validation, context
resolution, child identity, or adapter invocation; attached paused requests do
not add a profile when the request forbids it; and explicit visual-reference
phase routes hydrate their effective model from the route catalog instead of
from caller-supplied `managedModel`. When the selected route intentionally has
no model, the stale caller model is removed instead of preserved.

Final verification on 2026-05-29 passed `bun run test`, `bun run build`, and
`git diff --check`. A concurrent `bun run test` plus `bun run build` attempt
briefly surfaced a field-runtime lifecycle timeout in core; rerunning that
Vitest file in isolation passed, and the subsequent sequential workspace test
passed.

The latest 2026-05-29 GUI stress session
`.kiln/sessions/kiln-gui%3A_gui%3A20afacf8-3b10-4b7d-905b-77d60686976a%3A1780050552811`
proved route-owned canonicalization was working: the child ran on the selected
visual-reference route and forbidden `agentProfile` input was canonicalized
away. The remaining failure was a governed state-transition gap. The managed
child returned `handoff_not_substantive` and the parent produced final blocked
text without recording either evidence or the blocked work-item template.
Runtime closeout now rejects final assistant text while either
`managedInvocationRecovery` or `managedInvocationPhaseCompletion` requires a
next work-item tool. If the tool-round budget is exhausted, the turn fails
closed with `managed_invocation_state_transition_required`. GUI projection now
shows failed `turn_completed` events with error tone.

Timeout research for this closeout follows the same production stance used by
AWS, Google SRE, Microsoft Azure, Google Cloud, and Anthropic: every remote or
cross-process call needs an explicit deadline, retries must be bounded and
backed off with jitter, overload must fail early instead of queuing
indefinitely, and long model calls should use streaming or batch/polling where
the provider supports it. The Kiln fix does not treat timeout as a reason to
silently retry or mark work complete; it makes unresolved child handoff states
visible, replayable, bounded, and unsafe to finalize until state is recorded.

Additional verification on 2026-05-29 passed `bun run typecheck`,
`bun run --cwd packages/runtime test tests/session/runtime-session-orchestrator-tools.test.ts`,
`bun run --cwd packages/gui test tests/session-store.test.ts`,
`bun run --filter @kilnai/gui test`, `bun run --filter
@kilnai/gateway-contracts test`, `bun run build`, and `git diff --check`.
An initial `bun run --filter @kilnai/runtime test` attempt had one suite-level
timeout in `tests/gateway/tui-gateway-clear.test.ts:350`; rerunning that file
in isolation passed all 18 tests, and a later standalone runtime package suite
passed with 177 test files and 2353 tests.

The latest 2026-05-29 GUI stress session
`.kiln/sessions/kiln-gui%3A_gui%3A0eb1c062-b0bb-4d8e-bd71-a461a33f06e8%3A1780052576091`
proved the prior fail-closed guard worked but exposed one final workflow gap:
the parent spent the last normal round reading child resources and local
frontend references, then could not apply the required `work_item.update`
transition. The runtime now grants exactly one transition-only reserve round
when a managed invocation state transition remains pending after normal rounds.
That reserve projects only the required next work-item tool, applies a
single-tool executor allowlist, blocks any non-transition tool calls, resolves
either evidence or blocked-pause transitions, and fails closed if the required
tool is missing or still not called. Successful reserve transitions now continue
to the final model response without emitting a false max-tool-rounds error.
Focused verification for this slice passed `bun run typecheck` and
`bun run --cwd packages/runtime test tests/session/runtime-session-orchestrator-tools.test.ts`.
Reviewer follow-up found that tracking only one pending child transition could
let a later resolved transition hide an earlier unresolved one. The runtime now
keeps unresolved transitions in execution order and returns the oldest pending
transition, with regression coverage proving that resolving the second child
does not clear the first. Follow-up verification passed the same focused
runtime test file with 61 tests and `bun run typecheck`.

The final 2026-05-29 GUI stress session
`.kiln/sessions/kiln-gui%3A_gui%3A4ee1ae9f-586c-4839-bef4-7f4fdf858135%3A1780081054547`
proved the transition reserve and route-owned canonicalization were holding,
but exposed a child-runtime protocol gap: after tool use, the direct-provider
child returned an empty final handoff with `stop_reason: "tool_calls"`. The
runtime now treats no-tools fallback as a hard protocol boundary. If a
fallback response still requests tools, reports a tool-continuation stop
reason, or contains no final text, Kiln emits a deterministic non-substantive
result and does not execute or retry those tool calls. Direct-provider managed
children project that state as no-handoff evidence with a child-execution
resource, so parent governance still blocks until real evidence or an explicit
blocked pause is recorded.

This follows the researched timeout and retry posture: deadlines and tool
budgets are explicit, fallback is bounded, malformed or nonterminal model
behavior is not retried indefinitely, and replayable evidence replaces hidden
repair loops. Follow-up verification passed the two focused orchestrator
fallback regressions, the direct runtime adapter regression, the full runtime
package suite with 177 test files and 2362 tests, and `bun run typecheck`.

The latest 2026-05-29 GUI stress session
`.kiln/sessions/kiln-gui%3A_gui%3Ae294e374-2b9e-4c4b-a144-dc03579522f2%3A1780083012476`
proved governance was correctly blocking placeholder visual-reference evidence,
but exposed two remaining issues. First, the parent process could inspect
`C:/Proyectos/Sequel/t1code` and `C:/Proyectos/Sequel/vllm-studio`, while the
managed read-only child could not because its direct-provider sandbox admitted
only the Kiln working directory. Second, a semantically valid blocked
`work_item.update` with a phase-specific pause id was not recognized as the
required managed-invocation recovery transition. Kiln now has explicit
`readAuthority.workspace` roots for read-only reference repositories, CLI route
projection carries those roots into read-only managed routes, direct-provider
child sandboxes admit them for reads without granting writes, and recovery
resolution accepts blocked transitions when the same work item records a pending
operator pause plus a failed verification gate for the required evidence. This
keeps sibling repo inspection governed and read-only, while preserving strict
phase evidence: missing visual-reference evidence still blocks instead of
recording placeholders.

Review follow-up closed the final two issues from this slice. A direct-provider
child that returns `managed_invocation_state_transition_required` is now
recorded as a failed managed invocation with child-execution replay evidence,
so it cannot be adopted as completed/substantive handoff evidence. Cancelled
GUI `turn_completed` events now render with error tone instead of success tone.
The live `~/.kiln/config.yaml` read-only research routes were also updated to
admit `C:/Proyectos/Sequel/t1code` and `C:/Proyectos/Sequel/vllm-studio` as
read-only reference roots while denying their `.git` and `node_modules`
subtrees.

Final verification passed `bun run test`, `bun run typecheck`,
`bun run build`, `bun run --filter @kilnai/runtime test`,
`bun run --filter @kilnai/gui test`, and `git diff --check`. The GUI build
still reports the existing chunk-size warning for large chunks; it does not
fail the build.
