# Orchestrator And Turn-Flow Refactor Roadmap

This document is the canonical execution roadmap for orchestrator cleanup and
runtime turn-flow unification.

It replaces the former split between an overview file and separate O1, O2, and
O4 slice-plan documents, and it now absorbs the end-to-end turn-flow cleanup
that should not live in a separate near-duplicate roadmap.

## Scope

- `packages/core/src/orchestrator`
- `packages/runtime/src/gateway`
- `packages/runtime/src/session`
- `packages/runtime/src/execution`
- `packages/cli/src/wrapper`

## Objective

Finish the orchestrator cleanup and unify all admitted runtime surfaces on one
canonical turn flow.

This roadmap exists because the current tree still has a split reality:

- provider-adapter and tenant API traffic now use the canonical handoff
- TUI and GUI operator turns now use the same canonical handoff
- context assembly is still fragmented
- execution and audit behavior still varies by surface

The target state is:

- one canonical runtime turn handoff after ingress admission
- one governed context assembly owner
- one tool-execution authority path
- one audit shape for turn authority and outcomes

The orchestrator directory still needs cleanup so it stops acting as a dumping
ground for:

- execution flow
- phase logic
- chain logic
- allocation logic
- checkpointing
- swarm-era residue

and instead becomes a bounded migration path toward:

- `IngressGovernor`
- `DemandAllocator`
- `ChainGovernor`
- governed execution-flow support

## Current Status

As of 2026-04-21:

- O1 completed
- O2 completed
- O3 retired as redundant with completed O2 naming work
- O4 completed
- O5 partially complete
- end-to-end turn-flow review completed

Confirmed architectural findings:

- API, TUI, and GUI admitted turns now converge on the canonical
  `processAdmittedTurn(...)` handoff
- the remaining admission-surface review is no longer about TUI or GUI bypass;
  it is about finalizing policy ownership and checking for any non-gateway
  entrypoints that still assemble lasting turn state
- runtime admitted-turn context assembly now converges on explicit runtime
  owner seams for context projection, turn system-prompt assembly, and
  runtime-continuity presentation
- the repo still does not literally reuse the CLI `DefaultContextGovernor` in
  runtime, but the open problem is no longer runtime bypass; it is whether a
  shared cross-package governance contract is worth introducing later
- authority-decision capture now includes TUI and GUI turn capture plus
  first-class dangerous-command outcome evidence in the canonical turn record,
  and the focused final T5 parity review found no remaining non-operator shape
  drift
- `packages/runtime/src/execution` no longer has the prior dead wrapper set,
  and the focused T4 transport-boundary review confirmed
  `cli-subscription-executor.ts` is now a bounded one-shot transport adapter
  rather than a hidden execution-policy owner
- T1.A completed: admitted TUI and GUI turns now route through the shared
  `processAdmittedTurn(...)` handoff instead of duplicating local
  `runtimeSupport + orchestrator.processMessage + applyRuntimeTurnRecord +
  save` flow
- T1.A also merged surface turn-capture hooks into the shared handoff so
  operator transport can keep file-change and approval evidence without
  preserving a separate turn pipeline
- T1.B completed: provider-adapter route no longer owns auto knowledge
  retrieval or tenant agent/tool preparation; those now execute inside the
  shared runtime handoff using the canonical session
- T1.C completed: the canonical handoff boundary and public runtime vocabulary
  now use admitted-turn naming through `processAdmittedTurn(...)`
- T1.D completed: tenant API route no longer owns tenant system-prompt/tool
  preparation and now delegates tenant turn setup to
  `processAdmittedTurn(...)`
- T2 completed: admitted TUI and GUI turns now stay on the canonical handoff,
  with surface-specific work limited to transport hosting, framing, and
  operator activity capture

Progress recorded:

- checkpointing, interrupts, dev-tool execution, memory sync, and verification
  extracted from `orchestrator.ts`
- demand allocator, chain governor, and task registry vocabulary migrations
  completed
- `team-composer.ts` removed
- `swarm-strategy.ts` deleted
- swarm mode removed from supported strategy selection
- public exports no longer expose swarm strategy APIs
- typecheck passed after the current O1, O2, O4, and O5 cuts
- bounded-context doctrine for turn-flow unification is now captured in
  `01-bounded-context-decisions.md`
- `bun run typecheck` passed after the T1.A handoff convergence cut
- `bun run --filter @kilnai/runtime test -- tests/gateway/provider-adapter-routes.test.ts tests/gateway/message-pipeline.test.ts`
  passed after the T1.B route-thinning cut
- `bun run typecheck` passed after the T1.B route-thinning cut
- `bun run --filter @kilnai/runtime test -- tests/gateway/provider-adapter-routes.test.ts tests/gateway/tenant-routes.test.ts tests/gateway/message-pipeline.test.ts tests/gateway/message-pipeline-grounding.test.ts`
  passed after the admission-surface convergence verification
- `bun run --filter @kilnai/runtime test -- tests/gateway/tui-gateway.test.ts tests/gateway/tui-gateway-clear.test.ts tests/gateway/tui-gateway-authority.test.ts tests/gateway/gui-gateway.test.ts tests/gateway/gui-gateway-authority.test.ts`
  passed after the T2 surface verification
- `bun run --filter @kilnai/runtime test -- tests/gateway/message-pipeline.test.ts tests/gateway/message-pipeline-grounding.test.ts`
  passed after the admitted-turn context projection and runtime-continuity
  presentation convergence cuts
- `bun run --filter @kilnai/runtime test -- tests/session/runtime-session-orchestrator.test.ts`
  passed after the runtime turn system-prompt extraction cut
- `cd packages/runtime && bun x vitest run tests/session/runtime-turn-record.test.ts`
  passed after the runtime continuity decision-presentation extraction cut
- `bun run typecheck` passed after the T3 runtime context-ownership stop point
- `bun run --cwd packages/runtime vitest run tests/execution/cli-subscription-executor.test.ts --maxWorkers=1`
  passed after the T4 executor-collapse hardening cut
- `bun run --filter @kilnai/runtime test tests/gateway/gui-gateway-authority.test.ts tests/gateway/tui-gateway-authority.test.ts`
  passed after the first T5 authority-decision convergence cut
- `bun run --cwd packages/runtime vitest run tests/session/runtime-turn-record.test.ts tests/gateway/message-pipeline.test.ts --maxWorkers=1`
  passed after dangerous-command outcomes were added as canonical turn-record
  evidence
- `bun run --cwd packages/runtime vitest run tests/session/runtime-session-orchestrator.test.ts tests/session/runtime-session-orchestrator-tools.test.ts --maxWorkers=1`
  passed after the structured `fileChanges` extraction drift was fixed at the
  runtime tool-executor boundary
- `bun run --cwd packages/runtime vitest run tests/execution/cli-subscription-executor.test.ts tests/gateway/tui-gateway.test.ts tests/gateway/tui-gateway-authority.test.ts tests/gateway/gui-gateway.test.ts tests/gateway/provider-adapter-routes.test.ts --maxWorkers=1`
  passed after the final T4 transport-boundary review confirmed the surviving
  CLI subscription executor is only transport/session orchestration
- `bun run typecheck && bun run --cwd packages/runtime vitest run tests/session/runtime-turn-record.test.ts tests/gateway/message-pipeline.test.ts tests/gateway/tui-gateway-authority.test.ts tests/gateway/gui-gateway-authority.test.ts --maxWorkers=1`
  passed after the final T5 parity review confirmed no remaining
  non-operator authority-evidence shape drift
- `bun run typecheck` passed after the T4/T5 stop point

## Constraints

- no dead compatibility layer kept alive without a concrete migration need
- no mass rename before ownership is isolated
- no speculative abstraction added "just in case"
- each slice must leave the tree in a compilable state

## File-Level Decisions

| File or area | Decision | Target direction | Notes |
|--------------|----------|------------------|-------|
| `orchestrator.ts` | `split`, `rename` | Decompose into execution coordinator, admission boundaries, and support services | Currently too large and cross-cutting |
| `phase-machine.ts` | `keep`, `split` | Keep if phase control remains real; isolate as governed flow state rather than orchestrator identity | Relationship to future `ModeController` still needs clarification |
| `demand-allocator.ts` | `keep`, `split` | Preserve useful allocation logic under `DemandAllocator` | Naming migration already landed |
| `chain-governor.ts` | `keep`, `split` | Preserve bounded continuation logic under `ChainGovernor` | Naming migration already landed |
| `task-registry.ts` | `split`, `merge` | Move valid shared task-state mechanics into task-registry ownership | Current name is aligned |
| `demand-signal.ts` | `keep`, `merge`, `rename` | Keep if useful as signal normalization for allocation or admission | Still under naming pressure |
| `guardrails.ts` | `merge` | Rehome under safety or flow validation if still needed | Should not remain orchestrator-owned long term |
| `interrupt.ts` | `keep`, `merge` | Keep interrupt model nearer execution or session lifecycle ownership | Useful but misplaced long term |
| `checkpoint-store.ts` | `keep`, `merge` | Preserve persistence contract and move nearer execution persistence | Infra contract, not orchestrator identity |
| `checkpoint-types.ts` | `keep`, `merge` | Keep with checkpoint boundary | Same as above |
| `sqlite-checkpoint-store.ts` | `keep`, `merge` | Keep as infrastructure implementation | Likely moves with checkpoint store |
| `schemas.ts` | `split`, `merge`, `delete` | Keep only schemas still tied to surviving flows | Needs narrow follow-up review |
| `index.ts` | `rewrite` | Export only surviving or transitional APIs | Must stop teaching obsolete architecture |
| `strategies/` | `split`, `keep` | Retain only strategies that map cleanly to governed execution flows | Swarm residue already demoted |
| `runtime/src/gateway/message-pipeline.ts` | `keep`, `split`, `rename` | Becomes the canonical admitted turn handoff or is merged into a clearer replacement with the same single-owner role | The role is valid even if the current file name is transitional |
| `runtime/src/gateway/provider-adapter-routes.ts` | `split`, `merge` | Keep only ingress admission and request normalization; move lasting turn ownership out | Route layer currently prepares too much runtime turn state before handoff |
| `runtime/src/gateway/tui-gateway.ts` | `split`, `merge` | Preserve transport and hosting concerns only; route admitted turns through the canonical handoff | TUI must not retain a separate long-lived turn pipeline |
| `runtime/src/gateway/gui-gateway.ts` | `split`, `merge` | Preserve transport and hosting concerns only; route admitted turns through the canonical handoff | GUI must not retain a separate long-lived turn pipeline |
| `runtime/src/session/runtime-session-orchestrator.ts` | `keep`, `split`, `rename` | Remain the runtime turn core, but with clearer separation between model coordination, tool loop integration, and session persistence | Valid core, but still under naming and boundary pressure |
| `runtime/src/session/runtime-session-orchestrator-tool-executor.ts` | `keep`, `split`, `rename` | Remain the canonical tool-execution authority path | This is the right home for authorization, dangerous-command blocking, and actuation audit |
| `runtime/src/execution/cli-subscription-executor.ts` | `merge`, `delete` | Remove or reduce to a transport adapter once operator surfaces use the canonical turn flow | A surface-specific bypass is not an acceptable long-term execution boundary |
| `runtime/src/execution/api-executor.ts` | `merge`, `delete` | Delete unless a concrete runtime owner and caller set remain | Thin wrappers with no real ownership should not survive |
| `runtime/src/execution/model-executor.ts` | `merge`, `delete` | Delete unless a concrete runtime owner and caller set remain | Same as above |
| `cli/src/wrapper/session-manager.ts` | `split`, `merge` | Keep session lifecycle support, but move lasting context assembly authority into the canonical governed owner | Wrapper-local context policy should not survive as a second control center |

## Strategic Calls

### Do not start with mass renames

Broad renaming across mechanism files creates noise without reducing coupling.
Isolate ownership first, then replace obsolete names one boundary at a time.

### `orchestrator.ts` was the correct first cut

The main class mixed session lifecycle, phase control, cost tracking, tool
execution, provider registry, memory sync, checkpointing, and interrupts. That
authority concentration was the clearest sign of architectural drift.

### Replacement must remove the old path

`DemandAllocator`, `ChainGovernor`, and `TaskRegistry` should survive only as
real boundaries. Old names should not remain as permanent aliases.

## Slice Summary

### O1: Stabilize the main class boundary

Status: completed.

Goal:

- shrink `orchestrator.ts`
- extract cohesive support concerns without public renames

Completed work:

- checkpoint support extracted to `orchestrator-checkpoint-support.ts`
- interrupt support extracted to `orchestrator-interrupt-support.ts`
- dev-tool execution support extracted to
  `orchestrator-dev-tool-support.ts`
- memory sync support extracted to `orchestrator-memory-sync-support.ts`
- verification support extracted to `orchestrator-verification-support.ts`
- constructor wiring and field grouping simplified

### O2: Land target vocabulary where ownership was already clear

Status: completed.

Goal:

- replace the highest-pressure swarm-era mechanism names without redesigning
  behavior

Completed work:

- `threshold-allocator.ts` -> `demand-allocator.ts`
- `ThresholdAllocator` -> `DemandAllocator`
- `cascade-controller.ts` -> `chain-governor.ts`
- `CascadeController` -> `ChainGovernor`
- `TaskChannel` -> `TaskRegistry`

### O3: Retired

Status: retired.

Reason:

- the intended naming work already landed in O2
- keeping O3 as a separate future slice creates stale roadmap noise

### O4: Resolve strategy ownership

Status: completed.

Goal:

- keep only strategy surfaces that still make sense under governed execution

Completed work:

- `team-composer.ts` removed
- swarm strategy removed from the public strategy barrel
- swarm mode removed from supported strategy selection
- `swarm-strategy.ts` deleted

Current surviving strategy posture:

- `SequentialStrategy`: keep
- `SupervisorStrategy`: keep
- `SwarmStrategy`: deleted

### O5: Clean public exports

Status: in progress.

Goal:

- stop exposing obsolete public names once replacement boundaries exist

Completed work:

- O5.A public export cleanup removed swarm strategy APIs from `index.ts`
- O5.B final export sweep completed for the current stop point

Remaining intent:

- keep reviewing export surfaces as later control-plane refactors land

## Turn-Flow Track

The next active work is no longer just orchestrator naming cleanup. It is
runtime turn-flow convergence.

### T1: Establish the canonical admitted turn handoff

Status: completed.

Goal:

- define one runtime entrypoint that every admitted surface can call
- separate ingress-only preparation from lasting turn ownership
- make the canonical handoff explicit in code and exports

Success criteria:

- one callable boundary owns admitted turn processing
- route or surface files no longer assemble lasting runtime turn state
- naming makes it obvious where a turn enters the runtime core

Completed work:

- T1.A moved admitted TUI and GUI message handling onto
  `processAdmittedTurn(...)`
- T1.A preserved operator-surface activity capture by adding optional
  surface-capture hooks to the shared handoff
- T1.A removed the duplicate TUI/GUI local sequence for runtime support,
  orchestrator call, turn record application, and session save
- T1.B moved provider-adapter auto knowledge retrieval into
  `processAdmittedTurn(...)`
- T1.B moved tenant agent resolution, tool registration, and tenant
  per-call execution context into `processAdmittedTurn(...)`
- T1.B reduced `provider-adapter-routes.ts` to ingress validation, tier
  enforcement, and handoff invocation
- T1.C renamed the canonical handoff boundary from
  `processInboundMessage(...)` to `processAdmittedTurn(...)`
- T1.C renamed the public boundary vocabulary to admitted-turn semantics in
  runtime exports and gateway tests
- T1.D removed remaining lasting turn preparation from
  `tenant-routes.ts`; tenant prompt/tool context and per-call execution config
  now resolve inside `processAdmittedTurn(...)`
- T1.E closed the tier-enforcement ownership decision: plan/tier gating stays
  in provider-adapter ingress admission because it is request-contract
  validation that must fail before session mutation or admitted-turn side
  effects

### T2: Move TUI and GUI onto the canonical turn flow

Status: completed.

Goal:

- stop direct long-lived orchestration bypass from operator surfaces
- preserve transport-specific behavior without keeping separate turn pipelines

Success criteria:

- TUI uses the canonical admitted handoff
- GUI uses the canonical admitted handoff
- transport-specific code is limited to hosting, session transport, and UI
  framing concerns

Completed work:

- TUI now invokes `processAdmittedTurn(...)` instead of maintaining a
  separate local orchestration and turn-record sequence
- GUI now invokes `processAdmittedTurn(...)` instead of maintaining a
  separate local orchestration and turn-record sequence
- surface-specific behavior is limited to provider/model selection, WebSocket
  framing, operator approval bridging, and activity streaming hooks

### T3: Unify runtime admitted-turn context assembly under one explicit owner

Status: completed for the current runtime stop point.

Goal:

- remove lasting context policy from route files and runtime-side prompt and
  continuity formatting paths
- make admitted-turn runtime context assembly auditable and governed through one
  explicit runtime owner chain

Success criteria:

- one explicit runtime owner chain assembles admitted-turn context and
  continuity presentation
- route-local context assembly is reduced to ingress input preparation only for
  admitted runtime paths
- prompt and continuity presentation formatting are emitted consistently from
  support-owned seams

Completed work:

- extracted admitted-turn context projection into
  `projectAdmittedTurnContext(...)` inside
  `runtime/src/gateway/message-pipeline.ts`
- extracted runtime turn system-prompt assembly into
  `runtime/src/session/support/context/runtime-turn-system-prompt.ts`
- moved runtime continuity presentation formatting into
  `runtime/src/session/support/artifacts/context-artifact-summary.ts`
- moved runtime-turn-record continuity feedback-label formatting onto
  support-owned decision presentation helpers instead of local direct
  formatting
- removed the need for runtime-side callers to fabricate synthetic support
  objects just to obtain continuity labels

Closure note:

- this slice closed runtime admitted-turn context-ownership drift without
  forcing runtime to reuse the CLI `DefaultContextGovernor`
- if a shared cross-package governance contract is introduced later, it should
  be justified as a real architectural simplification, not as name-chasing

### T4: Collapse duplicate execution abstractions

Status: completed.

Goal:

- remove executor wrappers that only rename or bypass the real owner
- keep only the execution boundaries that materially clarify ownership

Success criteria:

- dead or near-dead executor wrappers are deleted
- any surviving executor file has a concrete caller set and boundary reason
- operator transport does not own hidden execution policy

Completed work:

- deleted `runtime/src/execution/api-executor.ts`
- deleted `runtime/src/execution/model-executor.ts`
- extracted prompt serialization out of
  `runtime/src/execution/cli-subscription-executor.ts` into
  `runtime/src/execution/cli-prompt-serializer.ts`
- extracted response assembly out of
  `runtime/src/execution/cli-subscription-executor.ts` into
  `runtime/src/execution/cli-response-assembler.ts`
- extracted CLI session contract types into
  `runtime/src/execution/cli-session-contract.ts`
- kept `cli-subscription-executor.ts` as the surviving operator transport
  boundary for the current stop point, but narrowed it away from prompt and
  response policy ownership
- reviewed `runtime/src/gateway/operator-gateway.ts` and kept it intentionally
  as a public alias for now because it still anchors external/runtime entry
  points; no extra shim layer was introduced
- confirmed by focused review and execution/gateway tests that the surviving
  `cli-subscription-executor.ts` boundary is already reduced to transport
  hosting, session lifecycle, and API-shape compatibility rather than hidden
  execution policy

Closure note:

- further extraction from `cli-subscription-executor.ts` would create thinner
  files without improving ownership, so T4 closes here unless a new concrete
  caller or policy leak appears later

### T5: Unify authority and audit recording

Status: completed.

Goal:

- ensure every admitted surface records the same authority evidence
- remove surface-specific audit drift

Success criteria:

- authority decisions are captured uniformly by API, CLI, TUI, and GUI flows
- tool authorization, approvals, and dangerous-command outcomes share one
  audit shape
- parity is measured on enforcement and evidence, not only on user-visible
  responses

Completed work:

- TUI turn capture now records `authorityDecisions` alongside file changes and
  approval transitions
- GUI turn capture now records `authorityDecisions` alongside file changes and
  approval transitions
- operator transport event handling now preserves `tool_authorized` evidence in
  the same turn-capture result returned by the canonical admitted-turn flow
- dangerous-command `ask` and `deny` outcomes now persist as a dedicated
  canonical turn-record evidence lane instead of remaining implicit in generic
  tool error summaries
- admitted-turn aggregation now derives dangerous-command outcomes from runtime
  tool execution results and merges them through the same canonical
  `applyRuntimeTurnRecord(...)` path used for other turn evidence
- runtime turn artifacts now record dangerous-command outcomes explicitly so
  authority evidence is no longer limited to tool-authorization and approval
  events
- structured `fileChanges` metadata for runtime `write` and `edit` tool
  executions now survives the executor boundary and reaches canonical turn
  evidence instead of being dropped by stringification drift
- focused final parity review confirmed non-operator admitted paths land on the
  same canonical authority-evidence shape as operator surfaces before turn
  persistence

Closure note:

- the remaining future work in this area is no longer turn-evidence parity; it
  is whatever new behavior might be introduced by later product slices

## Execution Order

Apply the turn-flow track in this order:

1. T1 canonical handoff
2. T2 TUI/GUI convergence
3. T3 context-governor unification
4. T4 executor collapse
5. T5 audit convergence

Do not invert this order casually. Later slices depend on one explicit runtime
handoff existing first.

## Atomic Work Units

Good worker-sized tasks:

1. Extract one cohesive support concern from `orchestrator.ts`.
2. Rehome one boundary file into a clearer ownership zone.
3. Route one admitted surface through the canonical runtime handoff.
4. Remove one wrapper-local context assembly step after the canonical owner is in place.
5. Narrow one public export surface after a replacement lands.
6. Delete one isolated residue file once no real caller remains.

Bad task shapes:

- refactor the whole orchestrator directory
- unify every runtime surface in one cut
- rename every swarm-era file in one pass
- migrate gateway, session, wrapper, and execution together

## Risks

- `orchestrator.ts` may still be a de facto public integration point in more
  places than expected
- strategy assumptions may still leak into CLI or runtime behavior
- export cleanup can create broad compile fallout if done before callers are
  narrowed
- task, tree, and checkpoint logic may be more tightly coupled than the file
  boundaries suggest
- TUI and GUI may depend on behavior that the API-oriented pipeline currently
  does not surface cleanly
- context assembly unification may expose hidden prompt-shape dependencies in
  wrapper flows
- executor deletion may reveal undocumented coupling in operator subscription
  paths

## Definition Of Done

This roadmap is complete only when:

- execution-flow ownership is clear
- every admitted surface uses one canonical runtime turn handoff
- `ContextGovernor` is the real owner of context assembly
- tool authorization and dangerous-command enforcement do not vary by surface
- authority audit evidence is uniform across surfaces
- mechanism residue no longer defines directory identity
- obsolete names are removed after replacement
- public exports stop teaching the old architecture
- the remaining directory can be explained in canonical control-plane terms
