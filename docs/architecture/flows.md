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

**Gates:**

- auth
- rate limit
- budget
- safety Tier 1

**State transitions:** authentication state, safety state, budget state.

**Fail-closed behavior:** safety Tier 1 blocks stop the request before routing.

## Context Assembly

**Trigger:** after routing, before model invocation.

**Stages:**

1. complexity scoring
2. attention budget allocation
3. Layer 0 recall
4. Layer 1 recall
5. Layer 2 recall
6. merge and ordering
7. truncation or summary if needed

**Gates:**

- token budget
- retrieval timeout handling

**Fail-closed behavior:** abnormal memory sparsity must be explicit, not silent.

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
2. context assembly
3. model invocation
4. tool loop with repeated safety and authorization checks
5. response assembly
6. session update
7. cost update

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
