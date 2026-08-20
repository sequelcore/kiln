# Flows

## Overview

Kiln defines a small set of canonical flows. These flows are the operational
paths that the control plane governs.

## Request Intake

**Trigger:** HTTP request, WebSocket frame, CLI input, webhook, or cron event.

**Stages:**

1. ingress and fast-path checks
2. salience classification
3. work-governance classification when the request represents operator work
4. routing and target selection
5. operational mode check
6. request-contract validation for the selected surface

**Gates:**

- auth
- rate limit
- budget
- safety Tier 1
- plan or tier gating when the ingress contract requires it

**State transitions:** authentication state, safety state, budget state.

**Fail-closed behavior:** safety Tier 1 and request-contract failures stop the
request before routing or session mutation.

## Admitted Turn Handling

**Trigger:** ingress has admitted a runtime turn.

**Stages:**

1. canonical admitted-turn handoff
2. context input collection
3. governed context projection
4. effective-prompt manifest assembly
5. routing-suffix reconciliation and exact-prompt validation
6. runtime continuity presentation
7. model and tool orchestration
8. canonical turn-record application
9. session save and telemetry emission

**Canonical boundary:** `processAdmittedTurn(...)`

**Gates:**

- ingress admission must already have resolved auth, rate, budget, and any
  request-contract tier checks
- per-turn budget
- tool authority and safety gates

**Invariants:**

- API, TUI, and GUI admitted turns all enter the same canonical runtime
  handoff
- surface-specific code is limited to ingress normalization, transport
  hosting, framing, and operator activity capture
- route and surface files must not assemble lasting runtime turn state after
  the admitted-turn handoff
- direct webhook and WebSocket entry points must pass governed context objects,
  not raw prompt-memory strings, to the orchestrator

**Fail-closed behavior:** malformed admitted-turn inputs, authority denial, or
missing runtime prerequisites stop the turn before tool execution or
persistence.

## Context Assembly

**Trigger:** after routing, before model invocation.

**Stages:**

1. complexity scoring
2. attention budget allocation
3. user/session memory candidate collection
4. runtime continuity summary candidate collection
5. semantic knowledge candidate collection
6. procedural skill candidate collection
7. coordination state candidate collection
8. governed merge and ordering
9. truncation, deferral, or summary if needed
10. audit emission

The governor audit is consumed by Runtime prompt assembly. Deferred components
remain metadata-only and do not contribute to the provider prompt hash.

**Gates:**

- token budget
- retrieval timeout handling
- governor audit requirement before prompt assembly

**Fail-closed behavior:** abnormal memory sparsity must be explicit, not silent.
Malformed coordination provider output or provider failure must not inject
fallback text into model context.

## Memory Write

**Trigger:** `memory_save`, lifecycle action, runtime tenant capture, session
end, or skill capture.

**Stages:**

1. scope resolution
2. tenant isolation
3. memory authority check
4. provenance validation
5. reconsolidation or lifecycle policy check when applicable
6. governed mutation through `MemoryMutationService`
7. revision, relation, archive, or admission evidence write when applicable
8. event emission

**Gates:**

- tenant isolation
- operation, scope, and layer authority
- GDPR delete policy

## Memory Recall

**Trigger:** resource read, lifecycle-aware recall, or context assembly
retrieval.

**Stages:**

1. scope resolution
2. memory authority check for model-facing callers
3. query expansion
4. lifecycle-aware relevance ranking
5. budget gating by `ContextGovernor`
6. sanitization
7. admission or deferral evidence emission

**Gates:**

- scope isolation
- token budget

## Safety Escalation

**Trigger:** elevated or critical safety signal.

**Stages:**

1. danger signal classification
2. layer determination
3. escalation queue insertion
4. mode-governor notification
5. mode transition check
6. human review if required

**Gates:**

- layer-specific safety gates
- queue availability

**Fail-closed behavior:** unavailable escalation path blocks the request.

## Orchestration And Delegation

**Trigger:** validated request with selected target.

**Stages:**

1. session initialization
2. canonical admitted-turn handoff when the flow is interactive
3. resolved work-governance context projection
4. context assembly
5. model invocation
6. tool loop with repeated safety and authorization checks
7. managed child invocation when the resolved work policy requires orchestration
8. verification and evidence collection
9. response assembly
10. session update
11. cost update

**Subprocess runtime additions:**

- phase transitions
- checkpoint writes
- iteration limits

**Gates:**

- per-turn budget
- phase gates
- tool safety gates
- explicit coordination triggers when the parent proposes doing work itself
- required evidence gates before completion claims

**Invariants:**

- CLI, GUI, TUI, SDK, benchmark, and native harness projections consume the
  same work-governance policy.
- A child invocation completion is not a task completion unless the configured
  evidence gates are satisfied.
- Model self-confidence does not satisfy verification gates.

## Goal Execution

**Trigger:** an approved goal run has materialized work items and the operator
or runtime requests the next governed execution step.

**Stages:**

1. select the next ready work item from the goal order
2. pause when dependencies, pause requirements, credentials, approval, or
   operator input are unresolved
3. choose direct execution or managed delegation from the governed assessment
   and route hints
4. start an execution attempt with `work_item.execution.start`
5. for managed delegation, resolve `managedInvocationId` through the runtime
   invocation service and verify its parent session, goal/work-item scope,
   terminal success, and substantive handoff before the attempt can start
6. collect evidence and residual-risk closeout
7. finish the attempt with `work_item.execution.finish`
8. record each declared goal-level requirement with `goal.evidence.record`
9. close the fully evidenced goal with `goal.complete`
10. project the attempt and goal state through canonical events and session
   resources
11. generate a deterministic final summary when completion is admitted and no
    manual summary is supplied

**Gates:**

- work item must belong to the goal
- dependencies must be completed
- pending pause requirements must be resolved
- managed delegation must be linked to a verified, scope-matching, substantive
  runtime invocation
- completion requires expected evidence and residual-risk closeout where
  required
- goal completion requires an explicit structured record for every required
  goal-level evidence requirement

**State transitions:** work-item status, execution attempt history, goal
current phase, terminal goal status, final summary state, and session
work-item/goal resources.

**Fail-closed behavior:** missing dependencies, unresolved pause requirements,
missing or unverifiable managed invocation provenance, missing evidence, failed
verification gates, missing residual-risk closeout, or missing goal evidence
pauses or blocks execution instead of advancing the goal.

## Tool Execution

**Trigger:** model emits a tool-use block.

**Stages:**

1. authorization
2. rate-limit check
3. sandbox enforcement
4. execution
5. result sanitization
6. return to orchestrator

**Gates:**

- deny-by-default authorization
- rate-limit enforcement
- sandbox violation denial

## Recovery From Failure

**Trigger:** provider failure, tool failure, crash, or checkpoint recovery path.

**Stages:**

1. failure classification
2. retry if transient
3. fallback if provider path is exhausted
4. checkpoint resume where available
5. session rehydration
6. degraded-mode transition when necessary
7. recovery event emission

**Gates:**

- retry budget
- fallback exhaustion

## Adaptation And Learning Feedback

**Trigger:** completed turn, tool outcome, or safety event.

**Stages:**

1. outcome extraction
2. threshold update
3. allostatic load update
4. specialization update
5. event emission

**Gates:**

- adaptation enabled flag
- oscillation detection

## Flow Rules

- every flow must have explicit gates
- every correction path must emit evidence
- no flow may silently drop safety, context, or memory decisions
- no flow definition should exist only in implementation code
