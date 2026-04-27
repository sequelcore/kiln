# Flows

## Overview

Kiln defines a small set of canonical flows. These flows are the operational
paths that the control plane governs.

## Request Intake

**Trigger:** HTTP request, WebSocket frame, CLI input, webhook, or cron event.

**Stages:**

1. ingress and fast-path checks
2. salience classification
3. routing and target selection
4. operational mode check
5. request-contract validation for the selected surface

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
4. turn system-prompt assembly
5. runtime continuity presentation
6. model and tool orchestration
7. canonical turn-record application
8. session save and telemetry emission

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

**Gates:**

- token budget
- retrieval timeout handling
- governor audit requirement before prompt assembly

**Fail-closed behavior:** abnormal memory sparsity must be explicit, not silent.
Malformed coordination provider output or provider failure must not inject
fallback text into model context.

## Memory Write

**Trigger:** memory store call, session end, or skill capture.

**Stages:**

1. scope resolution
2. tenant isolation
3. reconsolidation check
4. insert or update
5. decay assignment
6. audit append
7. event emission

**Gates:**

- tenant isolation
- GDPR delete policy

## Memory Recall

**Trigger:** memory recall or context assembly retrieval.

**Stages:**

1. scope resolution
2. query expansion
3. relevance ranking
4. budget gating
5. sanitization
6. event emission

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
3. context assembly
4. model invocation
5. tool loop with repeated safety and authorization checks
6. response assembly
7. session update
8. cost update

**Subprocess runtime additions:**

- phase transitions
- checkpoint writes
- iteration limits

**Gates:**

- per-turn budget
- phase gates
- tool safety gates

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
